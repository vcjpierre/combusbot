import * as dotenv from 'dotenv';
import { ScrapedData, FuelStationData } from './types';

// Cargar variables de entorno
dotenv.config();

async function debugScraping(): Promise<void> {
  console.log('🔍 Iniciando análisis de debugging...');
  
  try {
    const url = process.env.SCRAPER_URL || 'https://app9.biocloud.info/saldos/main/donde/134';
    
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
    
    console.log('📡 Obteniendo HTML de la página...');
    const response = await fetch(url, {
      method: 'GET',
      headers: headers,
      redirect: 'follow'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    console.log(`✅ HTML obtenido: ${html.length} caracteres`);
    
    // Buscar arrays PHP
    const phpArrayRegex = /array\(\d+\)\s*\{\s*\["id"\]=>\s*int\((\d+)\)\s*\["un"\]=>\s*int\((\d+)\)\s*\["producto_id"\]=>\s*int\((\d+)\)\s*\["fecha"\]=>\s*string\(\d+\)\s*"([^"]+)"\s*\["saldo"\]=>\s*string\(\d+\)\s*"([^"]+)"\s*\}/g;
    
    let match;
    let stationCount = 0;
    
    console.log('\n🔍 Analizando datos de estaciones...');
    console.log('=' .repeat(80));
    
    while ((match = phpArrayRegex.exec(html)) !== null) {
      stationCount++;
      const id = parseInt(match[1]);
      const un = parseInt(match[2]);
      const producto_id = parseInt(match[3]);
      const fecha = match[4];
      const saldo = match[5];
      
      console.log(`\n📊 Estación ${stationCount}:`);
      console.log(`   ID: ${id}`);
      console.log(`   Unidad: ${un}`);
      console.log(`   Saldo: ${saldo} Lts.`);
      console.log(`   Fecha: ${fecha}`);
      
      // Buscar contexto alrededor del array PHP
      const contextStart = Math.max(0, match.index - 3000);
      const contextEnd = Math.min(html.length, match.index + 3000);
      const context = html.substring(contextStart, contextEnd);
      
      console.log(`   Contexto: ${context.length} caracteres`);
      
      // Buscar patrones de vehículos en el contexto
      const vehiclesPatterns = [
        /(\d+)\s*vehículos?/i,
        /vehículos?[:\s]*(\d+)/i,
        /veh[:\s]*(\d+)/i,
        /(\d+)\s*veh/i,
        /vehiculos[:\s]*(\d+)/i,
        /(\d+)\s*vehiculos/i
      ];
      
      let vehiclesFound = false;
      for (let i = 0; i < vehiclesPatterns.length; i++) {
        const pattern = vehiclesPatterns[i];
        const vehiclesMatch = context.match(pattern);
        if (vehiclesMatch) {
          console.log(`   ✅ Vehículos encontrados: ${vehiclesMatch[1]} (patrón ${i + 1})`);
          vehiclesFound = true;
          break;
        }
      }
      
      if (!vehiclesFound) {
        console.log(`   ❌ No se encontraron vehículos en el contexto`);
        console.log(`   📝 Cálculo automático: ${Math.round(parseInt(saldo) / 40)} vehículos`);
      }
      
      // Buscar patrones de tiempo en el contexto
      const timePatterns = [
        /(\d+(?:\.\d+)?)\s*minutos?\s*aprox\.?/i,
        /tiempo[:\s]*(\d+(?:\.\d+)?)\s*min/i,
        /espera[:\s]*(\d+(?:\.\d+)?)\s*min/i,
        /(\d+(?:\.\d+)?)\s*min\s*espera/i,
        /minutos[:\s]*(\d+(?:\.\d+)?)/i
      ];
      
      let timeFound = false;
      for (let i = 0; i < timePatterns.length; i++) {
        const pattern = timePatterns[i];
        const timeMatch = context.match(pattern);
        if (timeMatch) {
          console.log(`   ✅ Tiempo encontrado: ${timeMatch[1]} min (patrón ${i + 1})`);
          timeFound = true;
          break;
        }
      }
      
      if (!timeFound) {
        console.log(`   ❌ No se encontró tiempo de espera en el contexto`);
        console.log(`   📝 Valor por defecto: 2 min`);
      }
      
      // Mostrar fragmento del contexto para análisis
      const contextPreview = context
        .replace(/\s+/g, ' ')
        .substring(0, 200)
        .trim();
      console.log(`   📄 Contexto preview: "${contextPreview}..."`);
      
      if (stationCount >= 5) {
        console.log('\n⚠️  Mostrando solo las primeras 5 estaciones para análisis...');
        break;
      }
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log(`📊 Total de estaciones encontradas: ${stationCount}`);
    console.log('✅ Análisis de debugging completado');
    
  } catch (error: any) {
    console.error('❌ Error en debugging:', error.message);
  }
}

// Ejecutar debugging
debugScraping().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('💥 Error fatal:', error);
  process.exit(1);
});
