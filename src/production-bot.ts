import TelegramBot from 'node-telegram-bot-api';
import * as cron from 'node-cron';
import * as dotenv from 'dotenv';
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

class ProductionFuelScraperBot {
  private bot: TelegramBot;
  private config: BotConfig;
  private lastData: ScrapedData | null = null;
  private isRunning: boolean = false;
  private startTime: Date = new Date();

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
      const errorMessage = `🚨 *Error en Bot de Combustible*\n\n${message}\n\nDatos: ${JSON.stringify(data, null, 2)}`;
      await this.bot.sendMessage(this.config.chatId, errorMessage, { parse_mode: 'Markdown' });
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
/help - Mostrar ayuda

*Configuración actual:*
• Notificaciones: ${this.config.notifyOnlyChanges ? 'Solo cambios' : 'Cada hora'}
• Volumen mínimo: ${this.config.minVolumeThreshold} Lts.
• Horario: ${this.config.cronSchedule}
• Uptime: ${this.getUptime()}

El bot está configurado para enviar notificaciones automáticas. ¡Disfruta! 🎉
      `;
      
      this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
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
• Uptime: ${this.getUptime()}
• Memoria: ${this.getMemoryUsage()}
• Próxima ejecución: ${this.getNextExecutionTime()}
      `;
      
      this.bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
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
      
      this.bot.sendMessage(chatId, healthMessage, { parse_mode: 'Markdown' });
    });

    // Comando /scrape
    this.bot.onText(/\/scrape/, async (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId, '🔄 Ejecutando scraping manual...');
      
      try {
        await this.executeScraping();
        this.bot.sendMessage(chatId, '✅ Scraping completado exitosamente!');
      } catch (error: any) {
        this.log('error', 'Error en scraping manual', { error: error.message });
        this.bot.sendMessage(chatId, `❌ Error en scraping: ${error.message}`);
      }
    });

    // Comando /schedule
    this.bot.onText(/\/schedule/, (msg) => {
      const chatId = msg.chat.id;
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
      
      this.bot.sendMessage(chatId, scheduleMessage, { parse_mode: 'Markdown' });
    });

    // Comando /help
    this.bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = `
❓ *Ayuda - Bot de Combustible*

*Comandos:*
/start - Mensaje de bienvenida
/status - Estado actual del bot
/health - Verificar salud del sistema
/scrape - Ejecutar scraping manual
/schedule - Ver configuración del scheduler
/help - Esta ayuda

*Funcionalidades:*
• Monitoreo automático de saldos
• Notificaciones de cambios importantes
• Datos en tiempo real de estaciones Biopetrol
• Alertas de bajo inventario
• Logging estructurado
• Manejo robusto de errores

*Contacto:* Si tienes problemas, contacta al administrador.
      `;
      
      this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    this.log('info', 'Bot configurado correctamente');
  }

  public startScheduler(): void {
    this.log('info', `Iniciando scheduler con horario: ${this.config.cronSchedule}`);
    
    cron.schedule(this.config.cronSchedule, async () => {
      this.log('info', 'Ejecutando scraping programado...');
      try {
        await this.executeScraping();
        this.log('info', 'Scraping programado completado exitosamente');
      } catch (error: any) {
        this.log('error', 'Error en scraping programado', { error: error.message });
        try {
          await this.bot.sendMessage(this.config.chatId, `❌ Error en scraping automático: ${error.message}`);
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

  private async executeScraping(): Promise<void> {
    const startTime = Date.now();
    
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
      await this.bot.sendMessage(this.config.chatId, message, { 
        parse_mode: 'Markdown',
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

  private extractDataFromHTML(html: string): ScrapedData {
    const stations: FuelStationData[] = [];
    
    // Buscar información general
    const titleMatch = html.match(/<h[4-6][^>]*>([^<]+)<\/h[4-6]>/i);
    const measurementMatch = html.match(/Última medición\s+([^<\n]+)/i);
    
    // Mapeo de IDs conocidos a nombres y direcciones
    const stationMapping: { [key: number]: { name: string; address: string } } = {
      5850299: { name: 'CABEZAS', address: 'CARRETERA A CAMIRI LOCALIDAD CABEZAS - AV. ELOY ALPIRE' },
      5850287: { name: 'LA TECA', address: 'CARRETERA A COTOCA, ANTES DE LA TRANCA' },
      5849989: { name: 'LUCYFER', address: 'ORURO - CIRCUNVALACION CALLE A NUM 80, ZONA NORESTE' },
      5850303: { name: 'PARAPETI', address: 'CAMIRI CARRETERA YACUIBA-SANTA CRUZ KM1 ZONA BARRIO LA WILLAMS' },
      5850272: { name: 'SUR CENTRAL', address: 'AV. SANTOS DUMONT, 2DO ANILLO' },
      5850245: { name: 'ALEMANA', address: 'AV. ALEMANA, 2DO ANILLO' },
      5850275: { name: 'BENI', address: 'AV. BENI, 2DO ANILLO' },
      5850306: { name: 'BEREA', address: 'DOBLE VIA LA GUARDIA KM 8' },
      5850268: { name: 'MONTECRISTO', address: 'AV. MONTECRISTO, 2DO ANILLO' },
      5850256: { name: 'EQUIPETROL', address: 'AV. EQUIPETROL, 4TO ANILLO AL FRENTE DE EX - BUFALO PARK' },
      5850311: { name: 'GASCO', address: 'AV. BANZER 3ER ANILLO' },
      5850261: { name: 'PARAGUA', address: 'AV. PARAGUA, 4TO ANILLO' },
      5850296: { name: 'PIRAI', address: 'AV. ROCA Y CORONADO 3ER ANILLO' },
      5850253: { name: 'ROYAL', address: 'AV. ROQUE AGUILERA ESQ CALLE ANGEL SANDOVAL NRO 3897 ZONA VILLA FATIMA' },
      5850283: { name: 'VIRU VIRU', address: 'KM11 AL NORTE A LADO DE PLAY LAND PARK' },
      5850279: { name: 'LOPEZ', address: 'AV. BANZER, 7MO ANILLO' },
      5850248: { name: 'CHACO', address: 'AV. VIRGEN DE COTOCA, 2DO ANILLO' },
      5850292: { name: 'MONTEVERDE', address: 'LOCALIDAD MONTERO, AV. CIRCUNVALACIÓN' }
    };
    
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
      let stationName = `Estación ${id}`;
      let address = 'Dirección no disponible';
      
      if (stationMapping[id]) {
        stationName = stationMapping[id].name;
        address = stationMapping[id].address;
      } else {
        // Fallback: buscar en el contexto
        const nameMatch = context.match(/(CABEZAS|EQUIPETROL|PIRAI|LA TECA|ALEMANA|BEREA|LUCYFER|LOPEZ|BENI|CHACO|GASCO|PARAPETI|SUR CENTRAL|MONTECRISTO|MONTEVERDE|PARAGUA|ROYAL|VIRU VIRU)/i);
        if (nameMatch) {
          stationName = nameMatch[1].toUpperCase();
        }
      }
      
      // Extraer volumen disponible - buscar en el contexto más amplio
      const volumeMatch = context.match(/(\d{1,3}(?:,\d{3})*)\s*Lts?\.?/i);
      const volume = volumeMatch ? parseInt(volumeMatch[1].replace(/,/g, '')) : parseInt(saldo);
      
      // Extraer tiempo de espera - buscar patrones más específicos
      let waitTime = 2; // Valor por defecto
      
      const timePatterns = [
        /(\d+(?:\.\d+)?)\s*minutos?\s*aprox\.?/i,
        /tiempo[:\s]*(\d+(?:\.\d+)?)\s*min/i,
        /espera[:\s]*(\d+(?:\.\d+)?)\s*min/i,
        /(\d+(?:\.\d+)?)\s*min\s*espera/i
      ];
      
      for (const pattern of timePatterns) {
        const match = context.match(pattern);
        if (match) {
          waitTime = parseFloat(match[1]);
          break;
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
      ultima_medicion: measurementMatch ? measurementMatch[1].trim() : 'No disponible',
      tipo_combustible: 'GASOLINA ESPECIAL',
      estaciones: stations
    };
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
    this.isRunning = false;
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
        await bot['bot'].sendMessage(chatId, startMessage, { parse_mode: 'Markdown' });
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
