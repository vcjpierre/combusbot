import TelegramBot from 'node-telegram-bot-api';
import * as cron from 'node-cron';
import { getConfig, STATION_META } from './config';
import { escapeMarkdown } from './types';
import { writeJsonAsync } from './utils';
import { scrapeUrl, saveToFile } from './scraper';
import { saveSnapshot, getRecentSnapshots, closeDb } from './history';
import { getLogger } from './logger';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

interface ScrapedStation {
  nombre_estacion: string;
  volumen_disponible: number;
  tiempo_espera_minutos: number;
  direccion: string;
  id: number;
  un: number;
  producto_id: number;
}

const MUTED_FILE = path.join(process.cwd(), 'output', 'muted-users.json');

export class FuelBot {
  private bot: TelegramBot;
  private cronTask: cron.ScheduledTask | null = null;
  private logger;
  private lastData: { stations: Map<string, ScrapedStation>; ultima_medicion: string } | null = null;
  private started = false;
  private mutedUsers = new Set<number>();
  private subscribedUsers = new Set<number>();

  constructor() {
    const config = getConfig();
    this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
    this.logger = getLogger();
    this.registerCommands();
  }

  private async safeSendMessage(chatId: number, text: string, options?: TelegramBot.SendMessageOptions): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
    } catch {
      try {
        await this.bot.sendMessage(chatId, text, options);
      } catch (err2) {
        this.logger.error({ chatId, error: (err2 as Error).message }, 'Failed to send message');
      }
    }
  }

  private async loadMutedUsers(): Promise<void> {
    try {
      if (existsSync(MUTED_FILE)) {
        const raw = await readFile(MUTED_FILE, 'utf-8');
        const ids: number[] = JSON.parse(raw);
        this.mutedUsers = new Set(ids);
        this.logger.info({ count: this.mutedUsers.size }, 'Loaded muted users');
      }
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Could not load muted users');
    }
  }

  private async saveMutedUsers(): Promise<void> {
    try {
      await mkdir(path.dirname(MUTED_FILE), { recursive: true });
      await writeFile(MUTED_FILE, JSON.stringify([...this.mutedUsers]), 'utf-8');
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Could not save muted users');
    }
  }

  private isMuted(chatId: number): boolean {
    return this.mutedUsers.has(chatId);
  }

  private async muteUser(chatId: number): Promise<void> {
    this.mutedUsers.add(chatId);
    await this.saveMutedUsers();
    this.logger.info({ chatId }, 'User muted');
  }

  private async unmuteUser(chatId: number): Promise<void> {
    this.mutedUsers.delete(chatId);
    await this.saveMutedUsers();
    this.logger.info({ chatId }, 'User unmuted');
  }

  private subscribeUser(chatId: number): void {
    this.subscribedUsers.add(chatId);
  }

  private registerCommands(): void {
    this.bot.onText(/\/start/, (msg) => {
      this.subscribeUser(msg.chat.id);
      this.unmuteUser(msg.chat.id);
      this.cmdStart(msg.chat.id);
    });

    this.bot.onText(/\/estado/, async (msg) => {
      await this.cmdEstado(msg.chat.id);
    });

    this.bot.onText(/\/estacion (.+)/, async (msg, match) => {
      await this.cmdEstacion(msg.chat.id, (match?.[1] ?? '').toUpperCase().trim());
    });

    this.bot.onText(/\/ultima/, async (msg) => {
      await this.cmdUltima(msg.chat.id);
    });

    this.bot.onText(/\/resumen/, async (msg) => {
      await this.cmdResumen(msg.chat.id);
    });

    this.bot.onText(/\/iniciar/, async (msg) => {
      await this.unmuteUser(msg.chat.id);
      this.subscribeUser(msg.chat.id);
      await this.safeSendMessage(msg.chat.id, '✅ *Notificaciones activadas.* Recibirás alertas en este chat.');
    });

    this.bot.onText(/\/detener/, async (msg) => {
      await this.muteUser(msg.chat.id);
      await this.safeSendMessage(msg.chat.id, '🔕 *Notificaciones desactivadas.* No recibirás alertas. Usa /iniciar para reactivar.');
    });

    this.bot.onText(/\/estatus/, async (msg) => {
      await this.cmdEstatus(msg.chat.id);
    });

    this.bot.onText(/\/menu/, async (msg) => {
      const muted = this.isMuted(msg.chat.id);
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Ver estado', callback_data: 'cmd_estado' }, { text: 'Última medición', callback_data: 'cmd_ultima' }],
            [{ text: 'Resumen 24h', callback_data: 'cmd_resumen' }, { text: 'Ayuda', callback_data: 'cmd_start' }],
            [
              { text: muted ? 'Activar notif.' : 'Desactivar notif.', callback_data: muted ? 'cmd_iniciar' : 'cmd_detener' },
            ],
            [{ text: 'Historial reciente', callback_data: 'cmd_historial' }],
          ],
        },
      };
      await this.bot.sendMessage(msg.chat.id, '*Menú rápido*', { parse_mode: 'Markdown', ...keyboard });
    });

    this.bot.onText(/\/stop/, async (msg) => {
      await this.muteUser(msg.chat.id);
      await this.safeSendMessage(msg.chat.id, '🛑 *Notificaciones detenidas para este chat.*\nUsa /start para reactivar.');
    });

    this.bot.on('callback_query', async (query) => {
      if (!query.data || !query.message) return;
      const chatId = query.message.chat.id;
      const cmd = query.data;

      if (cmd === 'cmd_estado') await this.cmdEstado(chatId);
      else if (cmd === 'cmd_ultima') await this.cmdUltima(chatId);
      else if (cmd === 'cmd_resumen') await this.cmdResumen(chatId);
      else if (cmd === 'cmd_start') { this.subscribeUser(chatId); await this.unmuteUser(chatId); this.cmdStart(chatId); }
      else if (cmd === 'cmd_iniciar') { await this.unmuteUser(chatId); this.subscribeUser(chatId); await this.safeSendMessage(chatId, '✅ *Notificaciones activadas.*'); }
      else if (cmd === 'cmd_detener') { await this.muteUser(chatId); await this.safeSendMessage(chatId, '🔕 *Notificaciones desactivadas.*'); }
      else if (cmd === 'cmd_historial') await this.cmdHistorial(chatId);

      try { await this.bot.answerCallbackQuery(query.id); } catch { /* ignore */ }
    });
  }

  private cmdStart(chatId: number): void {
    const muted = this.isMuted(chatId);
    const statusLine = muted ? '\nEstado actual: *Detenido* ⏸️ (usa /iniciar para activar)' : '\nEstado actual: *Activo* ✅';
    this.safeSendMessage(
      chatId,
      [
        '⛽ *CombustibleBot*',
        statusLine,
        '',
        '📋 *Comandos disponibles:*',
        '',
        '📊 /estado - Estado actual de todas las estaciones',
        '🔍 /estacion <nombre> - Detalle de una estación con historial',
        '🕐 /ultima - Última medición',
        '📈 /resumen - Resumen de las últimas 24h',
        '🔔 /iniciar - Activar notificaciones',
        '🔕 /detener - Desactivar notificaciones (solo para ti)',
        '⚙️ /estatus - Estado del bot (horario, cron, uptime)',
        '📑 /menu - Mostrar opciones rápidas',
        '🛑 /stop - Detener notificaciones (solo para ti)',
        '❓ /start - Mostrar esta ayuda',
      ].join('\n'),
    );
  }

  private async cmdEstado(chatId: number): Promise<void> {
    try {
      const data = await scrapeUrl(getConfig().SCRAPER_URL);
      if (data.estaciones.length === 0) {
        await this.safeSendMessage(chatId, '⚠️ *Sin datos* No se encontraron estaciones con datos.');
        return;
      }
      const header = `⛽ *${escapeMarkdown(data.tipo_combustible)}*\n📅 Medición: ${escapeMarkdown(data.ultima_medicion)}`;
      const sorted = [...data.estaciones].sort((a, b) => b.volumen_disponible - a.volumen_disponible);
      const lines = sorted.map((s, i) => {
        const meta = STATION_META[s.nombre_estacion];
        const idStr = meta ? ` (ID: ${meta.id})` : '';
        const volumeEmoji = s.volumen_disponible > 5000 ? '🟢' : s.volumen_disponible > 1000 ? '🟡' : '🔴';
        const rank = `${i + 1}.`;
        return `${rank} ${volumeEmoji} *${escapeMarkdown(s.nombre_estacion)}*${escapeMarkdown(idStr)}\n   ⛽ Vol: ${s.volumen_disponible.toLocaleString()} Lts | ⏱️ Espera: ${s.tiempo_espera_minutos} min\n   📍 Dir: ${escapeMarkdown(s.direccion)}`;
      });
      await this.safeSendMessage(chatId, `${header}\n\n${lines.join('\n\n')}`);
    } catch (err) {
      this.logger.error({ error: (err as Error).message }, 'Error fetching state');
      await this.safeSendMessage(chatId, '❌ *Error* No se pudieron obtener los datos. Intenta más tarde.');
    }
  }

  private async cmdEstacion(chatId: number, name: string): Promise<void> {
    try {
      const data = await scrapeUrl(getConfig().SCRAPER_URL);
      const station = data.estaciones.find((s) => s.nombre_estacion.toUpperCase() === name);
      if (!station) {
        await this.safeSendMessage(chatId, `❌ *No encontrada* No se encontró la estación "${escapeMarkdown(name)}".`);
        return;
      }
      const meta = STATION_META[name];
      const idStr = meta ? ` (ID: ${meta.id})` : '';
      const volumeEmoji = station.volumen_disponible > 5000 ? '🟢' : station.volumen_disponible > 1000 ? '🟡' : '🔴';
      await this.safeSendMessage(
        chatId,
        [
          `${volumeEmoji} *${escapeMarkdown(station.nombre_estacion)}*${escapeMarkdown(idStr)}`,
          '',
          `⛽ Volumen: ${station.volumen_disponible.toLocaleString()} Lts`,
          `⏱️ Tiempo espera: ${station.tiempo_espera_minutos} min`,
          `📍 Dirección: ${escapeMarkdown(station.direccion)}`,
        ].join('\n'),
      );
    } catch (err) {
      this.logger.error({ error: (err as Error).message }, 'Error fetching station');
      await this.safeSendMessage(chatId, '❌ *Error* No se pudieron obtener los datos.');
    }
  }

  private async cmdUltima(chatId: number): Promise<void> {
    try {
      const data = await scrapeUrl(getConfig().SCRAPER_URL);
      await this.safeSendMessage(chatId, `🕐 *Última medición:* ${escapeMarkdown(data.ultima_medicion)}\n📊 Estaciones: ${data.estaciones.length}`);
    } catch {
      await this.safeSendMessage(chatId, '❌ *Error* No se pudieron obtener los datos.');
    }
  }

  private async cmdResumen(chatId: number): Promise<void> {
    try {
      const data = await scrapeUrl(getConfig().SCRAPER_URL);
      const total = data.estaciones.length;
      const withData = data.estaciones.filter((s) => s.volumen_disponible > 0).length;
      const avgVol = total > 0 ? Math.round(data.estaciones.reduce((a, s) => a + s.volumen_disponible, 0) / total) : 0;
      const avgWait = total > 0 ? Math.round(data.estaciones.reduce((a, s) => a + s.tiempo_espera_minutos, 0) / total) : 0;
      const lowStock = data.estaciones.filter((s) => s.volumen_disponible < getConfig().MIN_VOLUME_THRESHOLD);
      const lines = [
        '📈 *Resumen 24h*',
        '',
        `🏢 Total estaciones: ${total}`,
        `✅ Con datos: ${withData}`,
        `⛽ Volumen promedio: ${avgVol.toLocaleString()} Lts`,
        `⏱️ Tiempo espera promedio: ${avgWait} min`,
      ];
      if (lowStock.length > 0) {
        lines.push('', `⚠️ *Bajo stock (< ${getConfig().MIN_VOLUME_THRESHOLD} Lts):*`);
        const lowStockSorted = [...lowStock].sort((a, b) => a.volumen_disponible - b.volumen_disponible);
        lowStockSorted.forEach((s) => {
          const emoji = s.volumen_disponible === 0 ? '🔴' : '🟡';
          lines.push(`${emoji} ${escapeMarkdown(s.nombre_estacion)}: ${s.volumen_disponible.toLocaleString()} Lts`);
        });
      }
      await this.safeSendMessage(chatId, lines.join('\n'));
    } catch {
      await this.safeSendMessage(chatId, '❌ *Error* No se pudieron obtener los datos.');
    }
  }

  private async cmdEstatus(chatId: number): Promise<void> {
    const config = getConfig();
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const muted = this.isMuted(chatId);
    await this.safeSendMessage(
      chatId,
      [
        '⚙️ *Estado del bot*',
        '',
        `🕐 Cron: ${config.CRON_SCHEDULE}`,
        `🔔 Tus notificaciones: ${muted ? '*Desactivadas* 🔕' : '*Activadas* 🔔'}`,
        `📝 Solo cambios: ${config.NOTIFY_ONLY_CHANGES ? 'Sí' : 'No'}`,
        `⛽ Vol. mínimo: ${config.MIN_VOLUME_THRESHOLD.toLocaleString()} Lts`,
        `⏱️ Uptime: ${h}h ${m}m`,
        `🌐 Modo: ${config.NODE_ENV}`,
      ].join('\n'),
    );
  }

  private async cmdHistorial(chatId: number): Promise<void> {
    const snapshots = getRecentSnapshots(5);
    if (snapshots.length === 0) {
      await this.safeSendMessage(chatId, '📂 *Historial* No hay datos guardados aún.');
    } else {
      const lines = snapshots.map((s) => `📅 ${escapeMarkdown(s.timestamp)} - 🏢 ${s.station_count} estaciones`);
      await this.safeSendMessage(chatId, `📋 *Últimos snapshots:*\n\n${lines.join('\n')}`);
    }
  }

  async sendNotifications(): Promise<void> {
    const config = getConfig();
    this.logger.info('Sending notifications');
    try {
      const data = await scrapeUrl(config.SCRAPER_URL);
      await saveToFile(data);

      const snapshotId = saveSnapshot(data);
      this.logger.debug({ snapshotId }, 'Snapshot saved');

      if (data.estaciones.length === 0) {
        this.logger.warn('No stations found');
        return;
      }

      const newStationMap = new Map<string, ScrapedStation>();
      data.estaciones.forEach((s) => newStationMap.set(s.nombre_estacion, s));

      const stationsToNotify: string[] = [];
      for (const [name, station] of newStationMap) {
        if (!station.volumen_disponible || station.volumen_disponible <= 0) continue;
        if (config.MIN_VOLUME_THRESHOLD && station.volumen_disponible < config.MIN_VOLUME_THRESHOLD) continue;

        if (config.NOTIFY_ONLY_CHANGES && this.lastData) {
          const prev = this.lastData.stations.get(name);
          if (prev && prev.volumen_disponible === station.volumen_disponible && prev.tiempo_espera_minutos === station.tiempo_espera_minutos) {
            continue;
          }
        }

        stationsToNotify.push(name);
      }

      if (stationsToNotify.length === 0) {
        this.logger.info('No stations to notify after filtering');
        this.lastData = { stations: newStationMap, ultima_medicion: data.ultima_medicion };
        return;
      }

      const sortedNotify = stationsToNotify.sort((a, b) => {
        const va = newStationMap.get(a)?.volumen_disponible ?? 0;
        const vb = newStationMap.get(b)?.volumen_disponible ?? 0;
        return vb - va;
      });
      const lines = sortedNotify.map((name) => {
        const station = newStationMap.get(name)!;
        const volumeEmoji = station.volumen_disponible > 5000 ? '🟢' : station.volumen_disponible > 1000 ? '🟡' : '🔴';
        const meta = STATION_META[name];
        const idStr = meta ? ` (ID: ${meta.id})` : '';
        return [
          `${volumeEmoji} *${escapeMarkdown(name)}*${escapeMarkdown(idStr)}`,
          `⛽ Volumen: ${station.volumen_disponible.toLocaleString()} Lts`,
          `⏱️ Tiempo espera: ${station.tiempo_espera_minutos} min`,
          `📍 Dirección: ${escapeMarkdown(station.direccion)}`,
        ].join('\n');
      });

      const header = `⛽ *${escapeMarkdown(data.tipo_combustible)}*\n📅 Medición: ${escapeMarkdown(data.ultima_medicion)}\n`;
      const fullMsg = `${header}\n${lines.join('\n\n')}`;

      const chatIds = this.subscribedUsers.size > 0
        ? [...this.subscribedUsers]
        : [Number(config.TELEGRAM_CHAT_ID)];

      for (const chatId of chatIds) {
        if (this.isMuted(chatId)) continue;
        await this.safeSendMessage(chatId, fullMsg);
      }

      this.lastData = { stations: newStationMap, ultima_medicion: data.ultima_medicion };
      this.logger.info({ stations: stationsToNotify.length, sentTo: chatIds.filter((id) => !this.isMuted(id)).length }, 'Notifications sent');
    } catch (err) {
      this.logger.error({ error: (err as Error).message }, 'Error sending notifications');
    }
  }

  startCron(): void {
    const config = getConfig();
    if (this.cronTask) this.stopCron();
    this.cronTask = cron.schedule(config.CRON_SCHEDULE, async () => {
      this.logger.info('Cron triggered');
      await this.sendNotifications();
    });
    this.logger.info({ schedule: config.CRON_SCHEDULE }, 'Cron started');
  }

  stopCron(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      this.logger.info('Cron stopped');
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const config = getConfig();
    this.logger.info('Starting bot');

    await this.loadMutedUsers();

    try {
      await this.safeSendMessage(
        Number(config.TELEGRAM_CHAT_ID),
        '🚀 *CombustibleBot iniciado*\nEscribe /start para ver los comandos.',
      );
      this.subscribeUser(Number(config.TELEGRAM_CHAT_ID));
    } catch (err) {
      this.logger.error({ error: (err as Error).message }, 'Failed to send startup message');
    }

    this.startCron();
    this.logger.info('Bot running');
  }

  stop(): void {
    this.stopCron();
    this.bot.stopPolling();
    closeDb();
    this.logger.info('Bot stopped');
  }
}
