/**
 * Interfaces para los datos extraídos del scraper de combustible
 */

export interface FuelStationData {
  id: number;
  un: number;
  producto_id: number;
  fecha: string;
  saldo: string;
  nombre_estacion: string;
  volumen_disponible: number;
  tiempo_espera_minutos: number;
  direccion: string;
  tipo_combustible: string;
  tiempo_carga: number;
  mangueras: number;
  carga_promedio: number;
  tiempo_carga_por_manguera: number;
}

export interface ScrapedData {
  timestamp: string;
  ultima_medicion: string;
  tipo_combustible: string;
  estaciones: FuelStationData[];
}

export interface ScraperConfig {
  url: string;
  headless: boolean;
  timeout: number;
  waitForSelector: string;
}
