import TelegramBot from 'node-telegram-bot-api';
import * as cron from 'node-cron';
import * as dotenv from 'dotenv';
import { scrapeWithFetch, extractDataFromHTML } from './scraper';
import { ScrapedData, FuelStationData } from './types';
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

class FuelScraperBot {
  private bot: TelegramBot;
  private config: BotConfig;
  private lastData: ScrapedData | null = null;
  private isRunning: boolean = false;
  private cronTask: cron.ScheduledTask | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.bot = new TelegramBot(this.config.token, { 
      polling: {
        interval: 300,
        autoStart: true,
        params: {
          timeout: 10
        }
      }
    });
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
      cronSchedule: process.env.CRON_SCHEDULE || '0 * * * *', // Cada hora
      notifyOnlyChanges: process.env.NOTIFY_ONLY_CHANGES === 'true',
      minVolumeThreshold: parseInt(process.env.MIN_VOLUME_THRESHOLD || '1000')
    };
  }

  private setupBot(): void {
    console.log('🤖 Iniciando bot de Telegram...');

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
      
      this.bot.sendMessage(chatId, welcomeMessage, { 
        parse_mode: 'Markdown',
        reply_markup: menuKeyboard
      });
    });

    // Comando /status
    this.bot.onText(/\/status/, (msg) => {
      this.showStatus(msg.chat.id);
    });

    // Comando /scrape
    this.bot.onText(/\/scrape/, async (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId, '🔄 Ejecutando scraping manual...');
      
      try {
        await this.executeScraping();
        this.bot.sendMessage(chatId, '✅ Scraping completado exitosamente!');
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Error en scraping: ${error}`);
      }
    });

    // Comando /schedule
    this.bot.onText(/\/schedule/, async (msg) => {
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
            this.bot.sendMessage(chatId, '✅ Scraping completado exitosamente!');
          }).catch((error) => {
            this.bot.sendMessage(chatId, `❌ Error en scraping: ${error}`);
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

    // Manejar errores
    this.bot.on('error', (error) => {
      console.error('Error del bot:', error);
      // Intentar reconectar después de 5 segundos
      setTimeout(() => {
        console.log('🔄 Intentando reconectar...');
        this.bot.startPolling();
      }, 5000);
    });

    this.bot.on('polling_error', (error: any) => {
      console.error('Error de polling:', error);
      // Si es un error de red, intentar reconectar
      if (error.code === 'EFATAL' || error.code === 'ENOTFOUND') {
        console.log('🔄 Error de red detectado, intentando reconectar en 10 segundos...');
        setTimeout(() => {
          this.bot.stopPolling();
          this.bot.startPolling();
        }, 10000);
      }
    });

    console.log('✅ Bot configurado correctamente');
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
        this.bot.sendMessage(this.config.chatId, `❌ Error en scraping automático: ${error}`);
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

    this.bot.sendMessage(chatId, menuMessage, {
      parse_mode: 'Markdown',
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
    
    this.bot.sendMessage(chatId, statusMessage, { 
      parse_mode: 'Markdown',
      reply_markup: menuKeyboard
    });
  }

  private async showSchedule(chatId: number): Promise<void> {
    const scheduleMessage = `
⏰ *Configuración del Scheduler*

• Horario: \`${this.config.cronSchedule}\`
• Descripción: ${this.getCronDescription()}
• Notificar solo cambios: ${this.config.notifyOnlyChanges ? 'Sí' : 'No'}
• Volumen mínimo: ${this.config.minVolumeThreshold} Lts.

*Formato cron:* minuto hora día mes día de la semana
• \`0 * * * *\` = Cada hora
• \`0 */2 * * *\` = Cada 2 horas
• \`0 8,12,16,20 * * *\` = 8am, 12pm, 4pm, 8pm
    `;

    const menuKeyboard = {
      inline_keyboard: [
        [{ text: '📋 Menú', callback_data: 'menu' }]
      ]
    };

    try {
      await this.bot.sendMessage(chatId, scheduleMessage, { 
        parse_mode: 'Markdown',
        reply_markup: menuKeyboard
      });
    } catch (error) {
      console.error('Error enviando configuración del scheduler:', error);
    }
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
    
    this.bot.sendMessage(chatId, helpMessage, { 
      parse_mode: 'Markdown',
      reply_markup: menuKeyboard
    });
  }

  private handleStop(chatId: number): void {
    if (!this.isRunning) {
      this.bot.sendMessage(chatId, '⚠️ El bot ya está detenido.');
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

    this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: menuKeyboard
    });
  }

  private handleStart(chatId: number): void {
    if (this.isRunning) {
      this.bot.sendMessage(chatId, '⚠️ El bot ya está en ejecución.');
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

    this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: menuKeyboard
    });
  }

  private async executeScraping(): Promise<void> {
    try {
      // Ejecutar scraping
      const url = process.env.SCRAPER_URL || 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134';
      
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
      const currentData = extractDataFromHTML(html);
      
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
    // Si el bot está detenido, no enviar notificaciones
    if (!this.isRunning) {
      return false;
    }

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
      await this.bot.sendMessage(this.config.chatId, message, { 
        parse_mode: 'Markdown',
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
    message += `🕐 ${data.ultima_medicion}\n`;
    message += `📅 ${timestamp}\n\n`;
    
    // Ordenar estaciones por volumen (mayor a menor)
    const sortedStations = data.estaciones.sort((a, b) => b.volumen_disponible - a.volumen_disponible);
    
    sortedStations.forEach((station, index) => {
      const volumeEmoji = station.volumen_disponible > 5000 ? '🟢' : 
                         station.volumen_disponible > 1000 ? '🟡' : '🔴';
      
      message += `${volumeEmoji} *${station.nombre_estacion}*\n`;
      message += `⛽ ${station.volumen_disponible.toLocaleString()} Lts.\n`;
      message += `⏱️ ${station.tiempo_espera_minutos} min. espera\n`;
      
      if (station.direccion !== 'Dirección no disponible') {
        message += `📍 ${station.direccion}\n`;
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
      message += `⚠️ *Bajo inventario:* ${lowVolumeStations.map(s => s.nombre_estacion).join(', ')}\n`;
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

  private getNextExecutionTime(): string {
    // Esta es una implementación simplificada
    // En producción, podrías usar una librería como 'cron-parser'
    return 'Próxima hora';
  }

  public stop(): void {
    this.stopScheduler();
    this.bot.stopPolling();
    console.log('🛑 Bot detenido');
  }
}

// Función principal
async function main(): Promise<void> {
  try {
    console.log('🚀 Iniciando Bot de Saldos de Combustible...');
    
    const bot = new FuelScraperBot();
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
      bot['bot'].sendMessage(chatId, startMessage, { parse_mode: 'Markdown' });
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

export { FuelScraperBot };
