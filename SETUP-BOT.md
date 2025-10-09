# 🤖 Configuración del Bot de Telegram

## Paso 1: Crear el Bot

1. Abre Telegram y busca [@BotFather](https://t.me/botfather)
2. Envía el comando `/newbot`
3. Sigue las instrucciones:
   - Nombre del bot: `Fuel Scraper Bot`
   - Username del bot: `tu_fuel_scraper_bot` (debe terminar en 'bot')

4. BotFather te dará un **TOKEN** como este:
   ```
   1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

## Paso 2: Obtener tu Chat ID

1. Busca [@userinfobot](https://t.me/userinfobot) en Telegram
2. Envía cualquier mensaje al bot
3. Te responderá con tu **Chat ID** (un número como `123456789`)

## Paso 3: Configurar el Proyecto

1. Copia el archivo de ejemplo:
   ```bash
   cp env.example .env
   ```

2. Edita el archivo `.env` con tus datos:
   ```env
   TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   TELEGRAM_CHAT_ID=123456789
   ```

## Paso 4: Ejecutar el Bot

```bash
npm run bot
```

## Comandos del Bot

Una vez ejecutándose, puedes usar estos comandos en Telegram:

- `/start` - Mensaje de bienvenida
- `/status` - Ver estado del bot
- `/scrape` - Ejecutar scraping manual
- `/schedule` - Ver configuración del scheduler
- `/help` - Mostrar ayuda

## Configuración Avanzada

### Cambiar frecuencia de notificaciones

Edita el archivo `.env`:

```env
# Cada hora (por defecto)
CRON_SCHEDULE=0 * * * *

# Cada 2 horas
CRON_SCHEDULE=0 */2 * * *

# Cada 6 horas
CRON_SCHEDULE=0 */6 * * *

# 4 veces al día (8am, 12pm, 4pm, 8pm)
CRON_SCHEDULE=0 8,12,16,20 * * *
```

### Configurar notificaciones

```env
# Solo notificar cuando hay cambios significativos
NOTIFY_ONLY_CHANGES=true

# Notificar siempre (cada hora)
NOTIFY_ONLY_CHANGES=false

# Volumen mínimo para alertas (en litros)
MIN_VOLUME_THRESHOLD=1000
```

## Solución de Problemas

### Error: "TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID son requeridos"
- Verifica que el archivo `.env` existe y tiene los valores correctos
- Asegúrate de que no hay espacios extra en los valores

### El bot no responde
- Verifica que el token del bot es correcto
- Asegúrate de que has enviado `/start` al bot primero
- Verifica que el Chat ID es correcto

### No recibo notificaciones
- Verifica la configuración de `CRON_SCHEDULE`
- Revisa los logs del bot para errores
- Usa `/scrape` para probar manualmente

## Ejemplo de Notificación

El bot enviará mensajes como este:

```
🚗 Saldos de Combustible Biopetrol
🕐 2025-10-09 14:16
📅 9/10/2025, 18:30:00

🟢 LUCYFER
⛽ 21,320 Lts.
🚗 533 vehículos
⏱️ 3 min. espera
📍 ORURO - CIRCUNVALACION CALLE A NUM 80, ZONA NORESTE

🟡 LA TECA
⛽ 4,505 Lts.
🚗 113 vehículos
⏱️ 2 min. espera
📍 CARRETERA A COTOCA, ANTES DE LA TRANCA

📊 Resumen:
• Total: 39,281 Lts.
• Estaciones: 4
```

¡Listo! Tu bot está configurado y funcionando. 🎉
