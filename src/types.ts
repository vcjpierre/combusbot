import { z } from 'zod';

export const FuelStationDataSchema = z.object({
  id: z.number().int(),
  un: z.number().int(),
  producto_id: z.number().int(),
  fecha: z.string(),
  saldo: z.string(),
  nombre_estacion: z.string().min(1),
  volumen_disponible: z.number().int().min(0),
  tiempo_espera_minutos: z.number().min(0),
  direccion: z.string(),
  tipo_combustible: z.string(),
  tiempo_carga: z.number().int(),
  mangueras: z.number().int(),
  carga_promedio: z.number().int(),
  tiempo_carga_por_manguera: z.number(),
});

export const ScrapedDataSchema = z.object({
  timestamp: z.string().datetime(),
  ultima_medicion: z.string(),
  tipo_combustible: z.string(),
  estaciones: z.array(FuelStationDataSchema),
});

export type FuelStationData = z.infer<typeof FuelStationDataSchema>;
export type ScrapedData = z.infer<typeof ScrapedDataSchema>;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
}
