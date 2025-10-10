import * as dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

// Cargar variables de entorno
dotenv.config();

async function checkBotInstances(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN no encontrado en .env');
    process.exit(1);
  }

  console.log('🔍 Verificando instancias del bot...');
  
  try {
    // Crear bot temporal para verificar el estado
    const bot = new TelegramBot(token, { polling: false });
    
    // Intentar obtener información del bot
    const botInfo = await bot.getMe();
    console.log(`✅ Bot encontrado: @${botInfo.username} (${botInfo.first_name})`);
    
    // Intentar obtener updates para verificar si hay conflicto
    try {
      const updates = await bot.getUpdates({ limit: 1 });
      console.log('✅ No hay conflictos de instancias múltiples');
      console.log(`📊 Updates disponibles: ${updates.length}`);
    } catch (error: any) {
      if (error.response?.statusCode === 409) {
        console.error('❌ CONFLICTO DETECTADO: Múltiples instancias del bot ejecutándose');
        console.error('💡 Solución: Detener todas las instancias y ejecutar solo una');
        console.error('🔧 Comando: taskkill /F /IM node.exe');
      } else {
        console.error('❌ Error verificando updates:', error.message);
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error conectando con el bot:', error.message);
    process.exit(1);
  }
}

// Ejecutar verificación
checkBotInstances().then(() => {
  console.log('🎉 Verificación completada');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Error en verificación:', error);
  process.exit(1);
});
