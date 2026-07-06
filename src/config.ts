import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),
  SCRAPER_URL: z.string().url().default('https://app9.biocloud.info/saldos/main/donde/134'),
  CRON_SCHEDULE: z.string().default('0 * * * *'),
  NOTIFY_ONLY_CHANGES: z.coerce.boolean().default(false),
  MIN_VOLUME_THRESHOLD: z.coerce.number().int().default(1000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

let _config: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (!_config) {
    _config = EnvSchema.parse(process.env);
  }
  return _config;
}

export const HTTP_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

export interface StationMeta {
  id: number;
  un: number;
  producto_id: number;
}

export const STATION_META: Record<string, StationMeta> = {
  'ALEMANA':     { id: 5850245, un: 1, producto_id: 1 },
  'BENI':        { id: 5850275, un: 1, producto_id: 1 },
  'BEREA':       { id: 5850306, un: 1, producto_id: 1 },
  'CABEZAS':     { id: 5850299, un: 1, producto_id: 1 },
  'CEDENO':      { id: 5850330, un: 1, producto_id: 1 },
  'EQUIPETROL':  { id: 5850256, un: 1, producto_id: 1 },
  'GASCO':       { id: 5850311, un: 1, producto_id: 1 },
  'LA TECA':     { id: 5850287, un: 1, producto_id: 1 },
  'LUCYFER':     { id: 5849989, un: 1, producto_id: 1 },
  'MONTECRISTO': { id: 5850268, un: 1, producto_id: 1 },
  'PARAPETI':    { id: 5850303, un: 1, producto_id: 1 },
  'PIRAI':       { id: 5850296, un: 1, producto_id: 1 },
  'ROYAL':       { id: 5850253, un: 1, producto_id: 1 },
  'SUR CENTRAL': { id: 5850272, un: 1, producto_id: 1 },
  'VIRU VIRU':   { id: 5850283, un: 1, producto_id: 1 },
};
