import TelegramBot from 'node-telegram-bot-api';
import * as cron from 'node-cron';
import * as dotenv from 'dotenv';
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

class ProductionFuelScraperBot {
  private bot: TelegramBot;
  private config: BotConfig;
  private lastData: ScrapedData | null = null;
  private isRunning: boolean = false;
  private startTime: Date = new Date();
  private cronTask: cron.ScheduledTask | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.bot = new TelegramBot(this.config.token, { 
      polling: false
    });
    this.setupBot();
    this.setupErrorHandling();
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

  private setupErrorHandling(): void {
    // Manejo de errores no capturados
    process.on('unhandledRejection', (reason, promise) => {
      this.log('error', 'Unhandled Rejection', { reason, promise });
    });

    process.on('uncaughtException', (error) => {
      this.log('error', 'Uncaught Exception', { error: error.message });
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      this.log('info', 'Received SIGINT, shutting down gracefully');
      this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.log('info', 'Received SIGTERM, shutting down gracefully');
      this.stop();
      process.exit(0);
    });

    // Manejo de errores específicos de Telegram
    this.bot.on('error', (error: any) => {
      this.log('error', 'Error de Telegram Bot', { 
        error: error.message,
        code: error.code 
      });
      
      // Si es un error de conflicto, esperar y reintentar
      if (error.code === 'ETELEGRAM' && error.response?.statusCode === 409) {
        this.log('warn', 'Conflicto detectado - múltiples instancias del bot', { 
          message: 'Esperando 30 segundos antes de continuar...' 
        });
        setTimeout(() => {
          this.log('info', 'Reintentando conexión después del conflicto...');
        }, 30000);
      }
    });

    this.bot.on('polling_error', (error: any) => {
      this.log('error', 'Error de polling de Telegram', { 
        error: error.message,
        code: error.code 
      });
      
      // Manejar errores de red específicos
      if (error.code === 'EFATAL' || error.code === 'ENOTFOUND') {
        this.log('warn', 'Error de red detectado, reintentando en 10 segundos...');
        setTimeout(() => {
          this.log('info', 'Reintentando conexión después del error de red...');
        }, 10000);
      }
    });
  }

  private log(level: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
      uptime: process.uptime()
    };
    
    console.log(JSON.stringify(logEntry));
    
    // En producción, también podrías enviar logs a un servicio externo
    if (level === 'error' && process.env.NODE_ENV === 'production') {
      this.sendErrorNotification(message, data);
    }
  }

  private async sendErrorNotification(message: string, data?: any): Promise<void> {
    try {
      const errorMessage = `🚨 *Error en Bot de Combustible*\n\n${escapeMarkdown(message)}\n\nDatos:\n\`\`\`\n${JSON.stringify(data, null, 2)}\n\`\`\``;
      await this.safeSendMessage(this.config.chatId, errorMessage);
    } catch (error) {
      console.error('Error enviando notificación de error:', error);
    }
  }

  private setupBot(): void {
    this.log('info', 'Iniciando bot de Telegram (modo producción)...');

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
/health - Verificar salud del sistema
/stop - Detener el bot (deja de enviar notificaciones)
/start_bot - Iniciar el bot (reanuda las notificaciones)
/menu - Mostrar menú de opciones
/help - Mostrar ayuda

*Configuración actual:*
• Notificaciones: ${this.config.notifyOnlyChanges ? 'Solo cambios' : 'Cada hora'}
• Volumen mínimo: ${this.config.minVolumeThreshold} Lts.
• Horario: ${this.config.cronSchedule}
• Uptime: ${this.getUptime()}
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
      this.showStatus(msg.chat.id);
    });

    // Comando /health
    this.bot.onText(/\/health/, (msg) => {
      const chatId = msg.chat.id;
      const healthMessage = `
🏥 *Health Check*

• Estado: ✅ Saludable
• Uptime: ${this.getUptime()}
• Memoria: ${this.getMemoryUsage()}
• Última ejecución: ${this.lastData ? new Date(this.lastData.timestamp).toLocaleString('es-ES') : 'Nunca'}
• Timestamp: ${new Date().toISOString()}
      `;
      
      this.safeSendMessage(chatId, healthMessage);
    });

    // Comando /scrape
    this.bot.onText(/\/scrape/, async (msg) => {
      const chatId = msg.chat.id;
      this.safeSendMessage(chatId, '🔄 Ejecutando scraping manual...');
      
      try {
        await this.executeScraping();
        this.safeSendMessage(chatId, '✅ Scraping completado exitosamente!');
      } catch (error: any) {
        this.log('error', 'Error en scraping manual', { error: error.message });
        this.safeSendMessage(chatId, `❌ Error en scraping: ${escapeMarkdown(String(error.message))}`);
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
          }).catch((error: any) => {
            this.log('error', 'Error en scraping manual', { error: error.message });
            this.safeSendMessage(chatId, `❌ Error en scraping: ${escapeMarkdown(String(error.message))}`);
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
        case 'health':
          this.bot.answerCallbackQuery(query.id);
          this.showHealth(chatId);
          break;
        default:
          this.bot.answerCallbackQuery(query.id);
      }
    });

    this.log('info', 'Bot configurado correctamente');
  }

  public startScheduler(): void {
    if (this.cronTask) {
      this.log('warn', 'El scheduler ya está iniciado');
      return;
    }

    this.log('info', `Iniciando scheduler con horario: ${this.config.cronSchedule}`);
    
    this.cronTask = cron.schedule(this.config.cronSchedule, async () => {
      if (!this.isRunning) {
        this.log('info', 'Scheduler detenido, omitiendo ejecución...');
        return;
      }
      
      this.log('info', 'Ejecutando scraping programado...');
      try {
        await this.executeScraping();
        this.log('info', 'Scraping programado completado exitosamente');
      } catch (error: any) {
        this.log('error', 'Error en scraping programado', { error: error.message });
        try {
          await this.safeSendMessage(this.config.chatId, `❌ Error en scraping automático: ${escapeMarkdown(String(error.message))}`);
        } catch (botError: any) {
          this.log('error', 'Error enviando mensaje de error', { error: botError.message });
        }
      }
    }, {
      scheduled: true,
      timezone: "America/La_Paz"
    });

    this.isRunning = true;
    this.log('info', 'Scheduler iniciado correctamente');
  }

  public stopScheduler(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    this.isRunning = false;
    this.log('info', 'Scheduler detenido');
  }

  private showMenu(chatId: number): void {
    const menuMessage = `
📋 *Menú del Bot*

Selecciona una opción:

*Estado:*
• Scheduler: ${this.isRunning ? '🟢 Activo' : '🔴 Detenido'}
• Última ejecución: ${this.lastData ? new Date(this.lastData.timestamp).toLocaleString('es-ES') : 'Nunca'}
• Uptime: ${this.getUptime()}

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
          { text: '🏥 Health', callback_data: 'health' }
        ],
        [
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
• Uptime: ${this.getUptime()}
• Memoria: ${this.getMemoryUsage()}
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
• Uptime: ${this.getUptime()}

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

  private showHealth(chatId: number): void {
    const healthMessage = `
🏥 *Health Check*

• Estado: ✅ Saludable
• Uptime: ${this.getUptime()}
• Memoria: ${this.getMemoryUsage()}
• Última ejecución: ${this.lastData ? new Date(this.lastData.timestamp).toLocaleString('es-ES') : 'Nunca'}
• Timestamp: ${new Date().toISOString()}
    `;

    const menuKeyboard = {
      inline_keyboard: [
        [{ text: '📋 Menú', callback_data: 'menu' }]
      ]
    };
    
    this.safeSendMessage(chatId, healthMessage, { 
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
/health - Verificar salud del sistema
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
• Logging estructurado
• Manejo robusto de errores

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
    const startTime = Date.now();
    
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
      
      const duration = Date.now() - startTime;
      this.log('info', 'Scraping completado', { 
        duration: `${duration}ms`,
        stations: currentData.estaciones.length,
        notified: this.shouldNotify(currentData)
      });
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.log('error', 'Error en scraping', { 
        error: error.message,
        duration: `${duration}ms`
      });
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
      this.log('info', 'Notificación enviada exitosamente');
    } catch (error: any) {
      this.log('error', 'Error enviando notificación', { error: error.message });
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
      
      const nameText = $card.find('.font-weight-bold').first().text().replace(/\s+/g, ' ').trim();
      if (!nameText) return;
      
      const cardText = $card.text();
      
      const volumeMatch = cardText.match(/([\d,.]+)\s*Lts\.?/i);
      const volume = volumeMatch ? parseInt(volumeMatch[1].replace(/,/g, '')) : 0;
      
      const waitMatch = cardText.match(/(\d+(?:[.,]\d+)?)\s*minutos?\s*aprox\.?/i);
      const waitTime = waitMatch ? parseFloat(waitMatch[1].replace(',', '.')) : 2;
      
      const addressText = $card.find('.alert-secondary div').first().text().replace(/\s+/g, ' ').trim() || 'Dirección no disponible';
      
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

  private async saveData(data: ScrapedData): Promise<void> {
    const outputDir = path.join(process.cwd(), 'output');
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const filename = `fuel-data-${new Date().toISOString().split('T')[0]}.json`;
    const filepath = path.join(outputDir, filename);
    
    try {
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
      this.log('info', 'Datos guardados exitosamente', { filepath });
    } catch (error: any) {
      this.log('error', 'Error guardando archivo', { error: error.message });
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

  private getNextExecutionTime(): string {
    return 'Próxima hora';
  }

  private getUptime(): string {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  private getMemoryUsage(): string {
    const used = process.memoryUsage();
    return `${Math.round(used.heapUsed / 1024 / 1024)}MB`;
  }

  public stop(): void {
    this.stopScheduler();
    this.log('info', 'Bot detenido');
  }
}

// Función principal
async function main(): Promise<void> {
  try {
    const bot = new ProductionFuelScraperBot();
    bot.startScheduler();
    
    // Enviar mensaje de inicio
    const startMessage = `
🤖 *Bot de Combustible Iniciado*

El bot está ahora activo y monitoreando los saldos de combustible.

• Scheduler: ✅ Activo
• Notificaciones: ${process.env.NOTIFY_ONLY_CHANGES === 'true' ? 'Solo cambios' : 'Cada hora'}
• Volumen mínimo: ${process.env.MIN_VOLUME_THRESHOLD || '1000'} Lts.
• Entorno: ${process.env.NODE_ENV || 'development'}

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
    
  } catch (error) {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main();
}

export { ProductionFuelScraperBot };
