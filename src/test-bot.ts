import * as dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

// Cargar variables de entorno
dotenv.config();

async function testBotConnection(): Promise<void> {
  console.log('🔍 Verificando configuración del bot...');
  
  // Verificar variables de entorno
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN no está configurado en el archivo .env');
    return;
  }
  
  if (!chatId) {
    console.error('❌ TELEGRAM_CHAT_ID no está configurado en el archivo .env');
    return;
  }
  
  console.log('✅ Variables de entorno configuradas');
  console.log(`📱 Token: ${token.substring(0, 10)}...`);
  console.log(`💬 Chat ID: ${chatId}`);
  
  try {
    // Crear bot sin polling
    const bot = new TelegramBot(token, { polling: false });
    
    console.log('🤖 Probando conexión con la API de Telegram...');
    
    // Probar conexión obteniendo información del bot
    const botInfo = await bot.getMe();
    console.log('✅ Conexión exitosa!');
    console.log(`🤖 Bot: @${botInfo.username} (${botInfo.first_name})`);
    
    // Probar envío de mensaje
    console.log('📤 Probando envío de mensaje...');
    const testMessage = `
🧪 *Prueba de Conexión*

¡Hola! Este es un mensaje de prueba para verificar que el bot funciona correctamente.

• Bot: @${botInfo.username}
• Timestamp: ${new Date().toLocaleString('es-ES')}
• Estado: ✅ Conectado

Si recibes este mensaje, la configuración es correcta! 🎉
    `;
    
    await bot.sendMessage(chatId, testMessage, { parse_mode: 'Markdown' });
    console.log('✅ Mensaje de prueba enviado exitosamente!');
    
    console.log('\n🎉 ¡Configuración del bot verificada correctamente!');
    console.log('Ahora puedes ejecutar: npm run bot-webhook');
    
  } catch (error: any) {
    console.error('❌ Error en la prueba:', error.message);
    
    if (error.code === 'ETELEGRAM') {
      console.error('💡 Posibles soluciones:');
      console.error('   • Verifica que el token del bot es correcto');
      console.error('   • Asegúrate de que el bot no está bloqueado');
      console.error('   • Verifica que has enviado /start al bot primero');
    } else if (error.code === 'EFATAL' || error.code === 'ENOTFOUND') {
      console.error('💡 Error de red:');
      console.error('   • Verifica tu conexión a internet');
      console.error('   • Intenta usar la versión webhook: npm run bot-webhook');
    }
  }
}

// Ejecutar prueba
if (require.main === module) {
  testBotConnection().catch(console.error);
}

export { testBotConnection };
