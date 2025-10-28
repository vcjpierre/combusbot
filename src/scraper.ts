import * as fs from 'fs';
import * as path from 'path';
import { load, CheerioAPI } from 'cheerio';
import { FuelStationData, ScrapedData } from './types';

interface StationInfo {
  name: string;
  address: string;
  waitTimeMinutes?: number;
}

interface StationInfoMaps {
  byId: Map<number, StationInfo>;
  byUn: Map<number, StationInfo>;
}

async function scrapeWithFetch(): Promise<void> {
  try {
    console.log('Iniciando scraper con fetch...');
    
    const url = 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134';
    
    console.log('Obteniendo datos de la página...');
    
    // Configurar headers para simular un navegador real
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    
    const response = await fetch(url, {
      method: 'GET',
      headers: headers,
      redirect: 'follow'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    console.log('HTML obtenido exitosamente');
    
    // Extraer datos del HTML
    const scrapedData = extractDataFromHTML(html);
    
    // Mostrar resultados en consola
    displayResults(scrapedData);
    
    // Guardar en archivo JSON
    await saveToFile(scrapedData);
    
    console.log('Scraping completado exitosamente!');
    
  } catch (error) {
    console.error('Error durante el scraping:', error);
    throw error;
  }
}

/**
 * Extrae datos del HTML usando regex y parsing manual
 */
function extractDataFromHTML(html: string): ScrapedData {
  const $ = load(html);
  const stationInfoMaps = buildStationInfoMaps($);
  const stations: FuelStationData[] = [];
  
  const fuelTypeHeading = $('h5').filter((_, el) => $(el).text().includes('Saldos de')).first();
  const measurementHeading = $('h5').filter((_, el) => $(el).text().includes('Última medición')).first();
  const fuelType = fuelTypeHeading.length ? normalizeWhitespace(fuelTypeHeading.text().replace(/Saldos de/i, '')) : 'GASOLINA ESPECIAL';
  const ultimaMedicion = measurementHeading.length ? normalizeWhitespace(measurementHeading.text().replace(/Última medición/i, '')) : 'No disponible';
  
  // Buscar arrays PHP en el HTML
  const phpArrayRegex = /array\(\d+\)\s*\{\s*\["id"\]=>\s*int\((\d+)\)\s*\["un"\]=>\s*int\((\d+)\)\s*\["producto_id"\]=>\s*int\((\d+)\)\s*\["fecha"\]=>\s*string\(\d+\)\s*"([^"]+)"\s*\["saldo"\]=>\s*string\(\d+\)\s*"([^"]+)"\s*\}/g;
  
  let match;
  while ((match = phpArrayRegex.exec(html)) !== null) {
    const id = parseInt(match[1]);
    const un = parseInt(match[2]);
    const producto_id = parseInt(match[3]);
    const fecha = match[4];
    const saldo = match[5];
    
    // Buscar información adicional alrededor del array PHP
    const contextStart = Math.max(0, match.index - 3000);
    const contextEnd = Math.min(html.length, match.index + 3000);
    const context = html.substring(contextStart, contextEnd);
    
    // Usar mapeo conocido o extraer del contexto
    const stationInfo = stationInfoMaps.byId.get(id) ?? stationInfoMaps.byUn.get(un);
    let stationName = stationInfo?.name ?? `Estación ${id}`;
    let address = stationInfo?.address ?? 'Dirección no disponible';
    
    // Extraer volumen disponible - buscar en el contexto más amplio
    const volumeMatch = context.match(/(\d{1,3}(?:,\d{3})*)\s*Lts?\.?/i);
    const volume = volumeMatch ? parseInt(volumeMatch[1].replace(/,/g, '')) : parseInt(saldo);
    
    // Extraer tiempo de espera - buscar patrones más específicos
    let waitTime = stationInfo?.waitTimeMinutes ?? 2;

    if (!stationInfo?.waitTimeMinutes) {
      const timePatterns = [
        /(\d+(?:[.,]\d+)?)\s*minutos?\s*aprox\.?/i,
        /tiempo[:\s]*(\d+(?:[.,]\d+)?)\s*min/i,
        /espera[:\s]*(\d+(?:[.,]\d+)?)\s*min/i,
        /(\d+(?:[.,]\d+)?)\s*min\s*espera/i
      ];

      for (const pattern of timePatterns) {
        const timeMatch = context.match(pattern);
        if (timeMatch) {
          waitTime = parseFloat(timeMatch[1].replace(',', '.'));
          break;
        }
      }
    }
    
    // Calcular mangueras basado en el tiempo de espera
    const mangueras = Math.max(1, Math.round(12 / waitTime));
    
    stations.push({
      id,
      un,
      producto_id,
      fecha,
      saldo,
      nombre_estacion: stationName,
      volumen_disponible: volume,
      tiempo_espera_minutos: waitTime,
      direccion: address,
      tipo_combustible: 'G',
      tiempo_carga: 12,
      mangueras,
      carga_promedio: 40,
      tiempo_carga_por_manguera: waitTime
    });
  }
  
  return {
    timestamp: new Date().toISOString(),
    ultima_medicion: ultimaMedicion,
    tipo_combustible: fuelType,
    estaciones: stations
  };
}

function buildStationInfoMaps($: CheerioAPI): StationInfoMaps {
  const byId = new Map<number, StationInfo>();
  const byUn = new Map<number, StationInfo>();

  $('.detalle').each((_, detailElement) => {
    const detailText = $(detailElement).text();
    const idMatch = detailText.match(/\["id"\]=>\s*int\((\d+)\)/);
    if (!idMatch) {
      return;
    }

    const unMatch = detailText.match(/\["un"\]=>\s*int\((\d+)\)/);
    const id = parseInt(idMatch[1], 10);
    const un = unMatch ? parseInt(unMatch[1], 10) : undefined;

    const cardElement = $(detailElement).nextAll('.btn-bio-app').first();
    const nameText = normalizeWhitespace(cardElement.find('.font-weight-bold').first().text());
    const addressText = normalizeWhitespace(cardElement.find('.alert-secondary div').first().text());
    const waitInfoText = normalizeWhitespace(cardElement.find('.fa-stopwatch').parent().next().text());

    let waitTimeMinutes: number | undefined;
    const waitMatch = waitInfoText.match(/(\d+(?:[.,]\d+)?)\s*min/i);
    if (waitMatch) {
      waitTimeMinutes = parseFloat(waitMatch[1].replace(',', '.'));
    }

    const info: StationInfo = {
      name: nameText || `Estación ${id}`,
      address: addressText || 'Dirección no disponible',
      waitTimeMinutes
    };

    byId.set(id, info);
    if (typeof un === 'number' && !Number.isNaN(un)) {
      byUn.set(un, info);
    }
  });

  return { byId, byUn };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Muestra los resultados en la consola
 */
function displayResults(data: ScrapedData): void {
  console.log('\n' + '='.repeat(80));
  console.log(`${data.tipo_combustible}`);
  console.log(`Última medición: ${data.ultima_medicion}`);
  console.log(`Timestamp: ${data.timestamp}`);
  console.log('='.repeat(80));
  
  if (data.estaciones.length === 0) {
    console.log('No se encontraron estaciones con datos válidos');
    return;
  }
  
  data.estaciones.forEach((station, index) => {
    console.log(`\n${index + 1}. ${station.nombre_estacion}`);
    console.log(`   📍 ID: ${station.id} | Unidad: ${station.un}`);
    console.log(`   ⛽ Volumen: ${station.volumen_disponible.toLocaleString()} Lts.`);
    console.log(`   ⏱️  Tiempo espera: ${station.tiempo_espera_minutos} min.`);
    console.log(`   📍 Dirección: ${station.direccion}`);
    console.log(`   📅 Fecha: ${station.fecha}`);
    console.log(`   🔢 Saldo: ${station.saldo}`);
  });
  
  console.log('\n' + '='.repeat(80));
  console.log(`Total de estaciones encontradas: ${data.estaciones.length}`);
  console.log('='.repeat(80));
}

/**
 * Guarda los datos en un archivo JSON
 */
async function saveToFile(data: ScrapedData): Promise<void> {
  const outputDir = path.join(process.cwd(), 'output');
  
  // Crear directorio si no existe
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const filename = `fuel-data-${new Date().toISOString().split('T')[0]}.json`;
  const filepath = path.join(outputDir, filename);
  
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Datos guardados en: ${filepath}`);
  } catch (error) {
    console.error('Error guardando archivo:', error);
    throw error;
  }
}

/**
 * Función principal de ejecución
 */
async function main(): Promise<void> {
  try {
    await scrapeWithFetch();
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main();
}

export { scrapeWithFetch, extractDataFromHTML, displayResults, saveToFile };
