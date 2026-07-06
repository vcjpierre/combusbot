import TelegramBot from 'node-telegram-bot-api';
import * as cron from 'node-cron';
import * as dotenv from 'dotenv';
import { scrapeUrl as scrapeWithFetch, extractDataFromHTML } from './scraper';
import { load } from 'cheerio';
import { ScrapedData, FuelStationData, escapeMarkdown } from './types';
import * as fs from 'fs';
import * as path from 'path';

// Cargar variables de entorno
dotenv.config();

interface BotConfig {
  token: string;
  chatId: string;
  cronSchedule: string;
  notifyOnlyChanges: boolean;
  minVolumeThreshold: number;
}

class FuelScraperBotWebhook {
  private bot: TelegramBot;
  private config: BotConfig;
  private lastData: ScrapedData | null = null;
  private isRunning: boolean = false;
  private cronTask: cron.ScheduledTask | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.bot = new TelegramBot(this.config.token, { polling: false });
    this.setupBot();
  }

  private loadConfig(): BotConfig {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!token || !chatId) {
      throw new Error('TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID son requeridos en el archivo .env');
    }

    return {
      token,
      chatId,
      cronSchedule: process.env.CRON_SCHEDULE || '0 * * * *',
      notifyOnlyChanges: process.env.NOTIFY_ONLY_CHANGES === 'true',
      minVolumeThreshold: parseInt(process.env.MIN_VOLUME_THRESHOLD || '1000')
    };
  }

  private setupBot(): void {
    console.log('🤖 Iniciando bot de Telegram (modo webhook)...');

    // Comando /start
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const welcomeMessage = `
🚗 *Bot de Saldos de Combustible Biopetrol*

¡Hola! Soy tu bot personalizado para monitorear los saldos de combustible en tiempo real.

*Comandos disponibles:*
/start - Mostrar este mensaje
/status - Ver estado del bot
/scrape - Ejecutar scraping manual
/schedule - Ver configuración del scheduler
/stop - Detener el bot (deja de enviar notificaciones)
/start_bot - Iniciar el bot (reanuda las notificaciones)
/menu - Mostrar menú de opciones
/help - Mostrar ayuda

*Configuración actual:*
• Notificaciones: ${this.config.notifyOnlyChanges ? 'Solo cambios' : 'Cada hora'}
• Volumen mínimo: ${this.config.minVolumeThreshold} Lts.
• Horario: ${this.config.cronSchedule}
• Estado: ${this.isRunning ? '🟢 Activo' : '🔴 Detenido'}

El bot está configurado para enviar notificaciones automáticas. ¡Disfruta! 🎉
      `;
      
      const menuKeyboard = {
        inline_keyboard: [
          [{ text: '📋 Menú', callback_data: 'menu' }],
          [{ text: '📊 Estado', callback_data: 'status' }],
          [{ text: this.isRunning ? '⏸️ Detener Bot' : '▶️ Iniciar Bot', callback_data: this.isRunning ? 'stop' : 'start' }]
        ]
      };
      
      this.safeSendMessage(chatId, welcomeMessage, { 
        reply_markup: menuKeyboard
      });
    });

    // Comando /status
    this.bot.onText(/\/status/, (msg) => {
      const chatId = msg.chat.id;
      const statusMessage = `
📊 *Estado del Bot*

• Bot activo: ✅
• Scheduler: ${this.isRunning ? '🟢 Ejecutándose' : '🔴 Detenido'}
• Última ejecución: ${this.lastData ? new Date(this.lastData.timestamp).toLocaleString('es-ES') : 'Nunca'}
• Estaciones monitoreadas: ${this.lastData ? this.lastData.estaciones.length : 0}
• Próxima ejecución: ${this.getNextExecutionTime()}
      `;
      
      this.safeSendMessage(chatId, statusMessage);
    });

    // Comando /scrape
    this.bot.onText(/\/scrape/, async (msg) => {
      const chatId = msg.chat.id;
      this.safeSendMessage(chatId, '🔄 Ejecutando scraping manual...');
      
      try {
        await this.executeScraping();
        this.safeSendMessage(chatId, '✅ Scraping completado exitosamente!');
      } catch (error) {
        this.safeSendMessage(chatId, `❌ Error en scraping: ${escapeMarkdown(String(error))}`);
      }
    });

    // Comando /schedule
    this.bot.onText(/\/schedule/, (msg) => {
      this.showSchedule(msg.chat.id);
    });

    // Comando /menu
    this.bot.onText(/\/menu/, (msg) => {
      this.showMenu(msg.chat.id);
    });

    // Comando /stop
    this.bot.onText(/\/stop/, (msg) => {
      this.handleStop(msg.chat.id);
    });

    // Comando /start_bot
    this.bot.onText(/\/start_bot/, (msg) => {
      this.handleStart(msg.chat.id);
    });

    // Comando /help
    this.bot.onText(/\/help/, (msg) => {
      this.showHelp(msg.chat.id);
    });

    // Manejar callbacks de botones inline
    this.bot.on('callback_query', (query) => {
      const chatId = query.message?.chat.id;
      const data = query.data;

      if (!chatId) return;

      switch (data) {
        case 'menu':
          this.showMenu(chatId);
          this.bot.answerCallbackQuery(query.id);
          break;
        case 'status':
          this.bot.answerCallbackQuery(query.id);
          this.showStatus(chatId);
          break;
        case 'stop':
          this.handleStop(chatId);
          this.bot.answerCallbackQuery(query.id);
          break;
        case 'start':
          this.handleStart(chatId);
          this.bot.answerCallbackQuery(query.id);
          break;
        case 'scrape':
          this.bot.answerCallbackQuery(query.id, { text: 'Ejecutando scraping...' });
          this.executeScraping().then(() => {
            this.safeSendMessage(chatId, '✅ Scraping completado exitosamente!');
          }).catch((error) => {
            this.safeSendMessage(chatId, `❌ Error en scraping: ${escapeMarkdown(String(error))}`);
          });
          break;
        case 'schedule':
          this.bot.answerCallbackQuery(query.id);
          this.showSchedule(chatId);
          break;
        case 'help':
          this.bot.answerCallbackQuery(query.id);
          this.showHelp(chatId);
          break;
        default:
          this.bot.answerCallbackQuery(query.id);
      }
    });

    console.log('✅ Bot configurado correctamente (modo webhook)');
  }

  private async safeSendMessage(chatId: number | string, message: string, options: any = {}): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, message, { ...options, parse_mode: 'Markdown' });
    } catch (markdownError) {
      try {
        await this.bot.sendMessage(chatId, message, { ...options, parse_mode: undefined });
      } catch (plainError) {
        console.error('Error enviando mensaje:', plainError);
      }
    }
  }

  public startScheduler(): void {
    if (this.cronTask) {
      console.log('⚠️ El scheduler ya está iniciado');
      return;
    }

    console.log(`⏰ Iniciando scheduler con horario: ${this.config.cronSchedule}`);
    
    this.cronTask = cron.schedule(this.config.cronSchedule, async () => {
      if (!this.isRunning) {
        console.log('⏸️ Scheduler detenido, omitiendo ejecución...');
        return;
      }
      
      console.log('🔄 Ejecutando scraping programado...');
      try {
        await this.executeScraping();
      } catch (error) {
        console.error('Error en scraping programado:', error);
        try {
          await this.safeSendMessage(this.config.chatId, `❌ Error en scraping automático: ${escapeMarkdown(String(error))}`);
        } catch (botError) {
          console.error('Error enviando mensaje de error:', botError);
        }
      }
    }, {
      scheduled: true,
      timezone: "America/La_Paz"
    });

    this.isRunning = true;
    console.log('✅ Scheduler iniciado correctamente');
  }

  public stopScheduler(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    this.isRunning = false;
    console.log('🛑 Scheduler detenido');
  }

  private showMenu(chatId: number): void {
    const menuMessage = `
📋 *Menú del Bot*

Selecciona una opción:

*Estado:*
• Scheduler: ${this.isRunning ? '🟢 Activo' : '🔴 Detenido'}
• Última ejecución: ${this.lastData ? new Date(this.lastData.timestamp).toLocaleString('es-ES') : 'Nunca'}

*Opciones disponibles:*
    `;

    const menuKeyboard = {
      inline_keyboard: [
        [
          { text: '📊 Estado', callback_data: 'status' },
          { text: '🔄 Scraping Manual', callback_data: 'scrape' }
        ],
        [
          { text: '⏰ Horario', callback_data: 'schedule' },
          { text: '❓ Ayuda', callback_data: 'help' }
        ],
        [
          { text: this.isRunning ? '⏸️ Detener Bot' : '▶️ Iniciar Bot', callback_data: this.isRunning ? 'stop' : 'start' }
        ]
      ]
    };

    this.safeSendMessage(chatId, menuMessage, {
      reply_markup: menuKeyboard
    });
  }

  private showStatus(chatId: number): void {
    const statusMessage = `
📊 *Estado del Bot*

• Bot activo: ✅
• Scheduler: ${this.isRunning ? '🟢 Ejecutándose' : '🔴 Detenido'}
• Última ejecución: ${this.lastData ? new Date(this.lastData.timestamp).toLocaleString('es-ES') : 'Nunca'}
• Estaciones monitoreadas: ${this.lastData ? this.lastData.estaciones.length : 0}
• Próxima ejecución: ${this.getNextExecutionTime()}
    `;
    
    const menuKeyboard = {
      inline_keyboard: [
        [{ text: '📋 Menú', callback_data: 'menu' }],
        [{ text: this.isRunning ? '⏸️ Detener Bot' : '▶️ Iniciar Bot', callback_data: this.isRunning ? 'stop' : 'start' }]
      ]
    };
    
    this.safeSendMessage(chatId, statusMessage, { 
      reply_markup: menuKeyboard
    });
  }

  private showSchedule(chatId: number): void {
    const scheduleMessage = `
⏰ *Configuración del Scheduler*

• Horario: \`${this.config.cronSchedule}\`
• Descripción: ${this.getCronDescription()}
• Notificar solo cambios: ${this.config.notifyOnlyChanges ? 'Sí' : 'No'}
• Volumen mínimo: ${this.config.minVolumeThreshold} Lts.

*Formato cron:* minuto hora día mes día_semana
• \`0 * * * *\` = Cada hora
• \`0 */2 * * *\` = Cada 2 horas
• \`0 8,12,16,20 * * *\` = 8am, 12pm, 4pm, 8pm
    `;

    const menuKeyboard = {
      inline_keyboard: [
        [{ text: '📋 Menú', callback_data: 'menu' }]
      ]
    };
    
    this.safeSendMessage(chatId, scheduleMessage, { 
      reply_markup: menuKeyboard
    });
  }

  private showHelp(chatId: number): void {
    const helpMessage = `
❓ *Ayuda - Bot de Combustible*

*Comandos:*
/start - Mensaje de bienvenida
/menu - Mostrar menú de opciones
/status - Estado actual del bot
/stop - Detener el bot (deja de enviar notificaciones)
/start_bot - Iniciar el bot (reanuda las notificaciones)
/scrape - Ejecutar scraping manual
/schedule - Ver configuración del scheduler
/help - Esta ayuda

*Funcionalidades:*
• Monitoreo automático de saldos
• Notificaciones de cambios importantes
• Datos en tiempo real de estaciones Biopetrol
• Alertas de bajo inventario
• Control de inicio/detención del bot

*Contacto:* Si tienes problemas, contacta al administrador.
    `;
    
    const menuKeyboard = {
      inline_keyboard: [
        [{ text: '📋 Menú', callback_data: 'menu' }]
      ]
    };
    
    this.safeSendMessage(chatId, helpMessage, { 
      reply_markup: menuKeyboard
    });
  }

  private handleStop(chatId: number): void {
    if (!this.isRunning) {
      this.safeSendMessage(chatId, '⚠️ El bot ya está detenido.');
      return;
    }

    this.stopScheduler();
    const message = `
⏸️ *Bot Detenido*

El bot ha sido detenido exitosamente.

• Scheduler: 🔴 Detenido
• Notificaciones: ❌ Desactivadas

Las notificaciones automáticas ya no se enviarán hasta que inicies el bot nuevamente.

Usa /start_bot o el botón "Iniciar Bot" para reanudar.
    `;

    const menuKeyboard = {
      inline_keyboard: [
        [{ text: '▶️ Iniciar Bot', callback_data: 'start' }],
        [{ text: '📋 Menú', callback_data: 'menu' }]
      ]
    };

    this.safeSendMessage(chatId, message, {
      reply_markup: menuKeyboard
    });
  }

  private handleStart(chatId: number): void {
    if (this.isRunning) {
      this.safeSendMessage(chatId, '⚠️ El bot ya está en ejecución.');
      return;
    }

    this.startScheduler();
    const message = `
▶️ *Bot Iniciado*

El bot ha sido iniciado exitosamente.

• Scheduler: 🟢 Activo
• Notificaciones: ✅ Activadas

Las notificaciones automáticas se reanudarán según el horario configurado.

Usa /stop o el botón "Detener Bot" para detener el bot nuevamente.
    `;

    const menuKeyboard = {
      inline_keyboard: [
        [{ text: '⏸️ Detener Bot', callback_data: 'stop' }],
        [{ text: '📋 Menú', callback_data: 'menu' }]
      ]
    };

    this.safeSendMessage(chatId, message, {
      reply_markup: menuKeyboard
    });
  }

  private async executeScraping(): Promise<void> {
    try {
      // Ejecutar scraping
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
      
      const response = await fetch(url, {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const html = await response.text();
      const currentData = this.extractDataFromHTML(html);
      
      // Verificar si hay cambios significativos
      if (this.shouldNotify(currentData)) {
        await this.sendNotification(currentData);
      }
      
      // Guardar datos actuales
      this.lastData = currentData;
      await this.saveData(currentData);
      
    } catch (error) {
      console.error('Error en scraping:', error);
      throw error;
    }
  }

  private shouldNotify(currentData: ScrapedData): boolean {
    if (!this.config.notifyOnlyChanges || !this.lastData) {
      return true;
    }

    // Verificar cambios significativos
    for (const currentStation of currentData.estaciones) {
      const lastStation = this.lastData.estaciones.find(s => s.id === currentStation.id);
      
      if (!lastStation) {
        return true; // Nueva estación
      }
      
      // Cambio significativo en volumen (más del 20%)
      const volumeChange = Math.abs(currentStation.volumen_disponible - lastStation.volumen_disponible);
      const volumeChangePercent = (volumeChange / lastStation.volumen_disponible) * 100;
      
      if (volumeChangePercent > 20) {
        return true;
      }
      
      // Volumen muy bajo
      if (currentStation.volumen_disponible < this.config.minVolumeThreshold) {
        return true;
      }
    }

    return false;
  }

  private async sendNotification(data: ScrapedData): Promise<void> {
    const message = this.formatTelegramMessage(data);
    
    try {
      await this.safeSendMessage(this.config.chatId, message, { 
        disable_web_page_preview: true
      });
      console.log('📤 Notificación enviada exitosamente');
    } catch (error) {
      console.error('Error enviando notificación:', error);
    }
  }

  private formatTelegramMessage(data: ScrapedData): string {
    const timestamp = new Date(data.timestamp).toLocaleString('es-ES');
    
    let message = `🚗 *Saldos de Combustible Biopetrol*\n`;
    message += `🕐 ${escapeMarkdown(data.ultima_medicion)}\n`;
    message += `📅 ${timestamp}\n\n`;
    
    // Ordenar estaciones por volumen (mayor a menor)
    const sortedStations = data.estaciones.sort((a, b) => b.volumen_disponible - a.volumen_disponible);
    
    sortedStations.forEach((station, index) => {
      const volumeEmoji = station.volumen_disponible > 5000 ? '🟢' : 
                         station.volumen_disponible > 1000 ? '🟡' : '🔴';
      
      message += `${volumeEmoji} *${escapeMarkdown(station.nombre_estacion)}*\n`;
      message += `⛽ ${station.volumen_disponible.toLocaleString()} Lts.\n`;
      message += `⏱️ ${station.tiempo_espera_minutos} min. espera\n`;
      
      if (station.direccion !== 'Dirección no disponible') {
        message += `📍 ${escapeMarkdown(station.direccion)}\n`;
      }
      
      message += `\n`;
    });
    
    // Resumen
    const totalVolume = data.estaciones.reduce((sum, s) => sum + s.volumen_disponible, 0);
    const lowVolumeStations = data.estaciones.filter(s => s.volumen_disponible < this.config.minVolumeThreshold);
    
    message += `📊 *Resumen:*\n`;
    message += `• Total: ${totalVolume.toLocaleString()} Lts.\n`;
    message += `• Estaciones: ${data.estaciones.length}\n`;
    
    if (lowVolumeStations.length > 0) {
      message += `⚠️ *Bajo inventario:* ${lowVolumeStations.map(s => escapeMarkdown(s.nombre_estacion)).join(', ')}\n`;
    }
    
    return message;
  }

  private async saveData(data: ScrapedData): Promise<void> {
    const outputDir = path.join(process.cwd(), 'output');
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const filename = `fuel-data-${new Date().toISOString().split('T')[0]}.json`;
    const filepath = path.join(outputDir, filename);
    
    try {
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`💾 Datos guardados en: ${filepath}`);
    } catch (error) {
      console.error('Error guardando archivo:', error);
    }
  }

  private getCronDescription(): string {
    const schedule = this.config.cronSchedule;
    
    if (schedule === '0 * * * *') return 'Cada hora';
    if (schedule === '0 */2 * * *') return 'Cada 2 horas';
    if (schedule === '0 */6 * * *') return 'Cada 6 horas';
    if (schedule === '0 8,12,16,20 * * *') return '4 veces al día (8am, 12pm, 4pm, 8pm)';
    if (schedule === '0 0 * * *') return 'Una vez al día (medianoche)';
    
    return 'Horario personalizado';
  }

  private extractDataFromHTML(html: string): ScrapedData {
    const $ = load(html);
    const stations: FuelStationData[] = [];
    
    const fuelTypeHeading = $('h5').filter((_, el) => $(el).text().includes('Saldos de')).first();
    const measurementHeading = $('h5').filter((_, el) => $(el).text().includes('Última medición')).first();
    const fuelType = fuelTypeHeading.length ? fuelTypeHeading.text().replace(/Saldos de/i, '').trim() : 'GASOLINA ESPECIAL';
    const ultimaMedicion = measurementHeading.length ? measurementHeading.text().replace(/Última medición/i, '').trim() : 'No disponible';
    
    const stationMeta: { [name: string]: { id: number; un: number; producto_id: number } } = {
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
      
      const meta = stationMeta[nameText] ?? { id: 9000 + stationIndex, un: 1, producto_id: 1 };
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
        tiempo_carga_por_manguera: waitTime
      });
      
      stationIndex++;
    });
    
    return {
      timestamp: new Date().toISOString(),
      ultima_medicion: ultimaMedicion,
      tipo_combustible: fuelType,
      estaciones: stations
    };
  }

  private getNextExecutionTime(): string {
    return 'Próxima hora';
  }

  public stop(): void {
    this.stopScheduler();
    console.log('🛑 Bot detenido');
  }
}

// Función principal
function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Iniciando Bot de Saldos de Combustible (modo webhook)...');
    
    const bot = new FuelScraperBotWebhook();
    bot.startScheduler();
    
    // Enviar mensaje de inicio
    const startMessage = `
🤖 *Bot de Combustible Iniciado*

El bot está ahora activo y monitoreando los saldos de combustible.

• Scheduler: ✅ Activo
• Notificaciones: ${process.env.NOTIFY_ONLY_CHANGES === 'true' ? 'Solo cambios' : 'Cada hora'}
• Volumen mínimo: ${process.env.MIN_VOLUME_THRESHOLD || '1000'} Lts.

Usa /help para ver todos los comandos disponibles.
    `;
    
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (chatId) {
      try {
        await bot['safeSendMessage'](chatId, startMessage);
      } catch (error) {
        console.error('Error enviando mensaje de inicio:', error);
      }
    }
    
    // Manejar cierre graceful
    process.on('SIGINT', () => {
      console.log('\n🛑 Cerrando bot...');
      bot.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n🛑 Cerrando bot...');
      bot.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main();
}

export { FuelScraperBotWebhook };
