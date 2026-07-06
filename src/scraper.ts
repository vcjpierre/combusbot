import { load } from 'cheerio';
import { FuelStationData, ScrapedData, ScrapedDataSchema } from './types';
import { STATION_META } from './config';
import { fetchHTML } from './utils';
import { getLogger } from './logger';
import { writeJsonAsync } from './utils';
import * as path from 'path';

export function extractDataFromHTML(html: string): ScrapedData {
  const $ = load(html);
  const stations: FuelStationData[] = [];

  const fuelTypeHeading = $('h5').filter((_, el) => $(el).text().includes('Saldos de')).first();
  const measurementHeading = $('h5').filter((_, el) => $(el).text().includes('Última medición')).first();
  const fuelType = fuelTypeHeading.length ? normalizeWhitespace(fuelTypeHeading.text().replace(/Saldos de/i, '')) : 'GASOLINA ESPECIAL';
  const ultimaMedicion = measurementHeading.length ? normalizeWhitespace(measurementHeading.text().replace(/Última medición/i, '')) : 'No disponible';

  let stationIndex = 0;

  $('.btn-bio-app').each((_, cardElement) => {
    const $card = $(cardElement);

    const nameText = normalizeWhitespace($card.find('.font-weight-bold').first().text());
    if (!nameText) return;

    const cardText = $card.text();

    const volumeMatch = cardText.match(/([\d,.]+)\s*Lts\.?/i);
    const volume = volumeMatch ? parseInt(volumeMatch[1].replace(/,/g, '')) : 0;

    const waitMatch = cardText.match(/(\d+(?:[.,]\d+)?)\s*minutos?\s*aprox\.?/i);
    const waitTime = waitMatch ? parseFloat(waitMatch[1].replace(',', '.')) : 2;

    const addressText = normalizeWhitespace($card.find('.alert-secondary div').first().text()) || 'Dirección no disponible';

    const meta = STATION_META[nameText] ?? { id: 9000 + stationIndex, un: 1, producto_id: 1 };
    const now = new Date();
    const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const mangueras = Math.max(1, Math.round(12 / waitTime));

    stations.push({
      id: meta.id,
      un: meta.un,
      producto_id: meta.producto_id,
      fecha,
      saldo: String(volume),
      nombre_estacion: nameText,
      volumen_disponible: volume,
      tiempo_espera_minutos: waitTime,
      direccion: addressText,
      tipo_combustible: 'G',
      tiempo_carga: 12,
      mangueras,
      carga_promedio: 40,
      tiempo_carga_por_manguera: waitTime,
    });

    stationIndex++;
  });

  const data: ScrapedData = {
    timestamp: new Date().toISOString(),
    ultima_medicion: ultimaMedicion,
    tipo_combustible: fuelType,
    estaciones: stations,
  };

  const result = ScrapedDataSchema.safeParse(data);
  if (!result.success) {
    getLogger().warn({ issues: result.error.issues }, 'Scraped data validation warnings');
  }

  return data;
}

export async function scrapeUrl(url: string): Promise<ScrapedData> {
  const logger = getLogger();
  logger.info({ url }, 'Fetching scraper data');
  const html = await fetchHTML(url);
  const data = extractDataFromHTML(html);
  logger.info({ stations: data.estaciones.length }, 'Scraping completed');
  return data;
}

export async function saveToFile(data: ScrapedData): Promise<string> {
  const outputDir = path.join(process.cwd(), 'output');
  const filename = `fuel-data-${new Date().toISOString().split('T')[0]}.json`;
  const filepath = path.join(outputDir, filename);
  await writeJsonAsync(filepath, data);
  getLogger().info({ path: filepath }, 'Data saved');
  return filepath;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
