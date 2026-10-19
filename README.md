# Fuel Scraper Bot

Web scraper con bot de Telegram para extraer información de saldos de combustible de estaciones de servicio Biopetrol y enviar notificaciones automáticas.

## 🚀 Características

- 🤖 **Bot de Telegram** con notificaciones automáticas
- ⏰ **Scheduler** configurable (cada hora, cada 2 horas, etc.)
- 📊 Extrae datos de saldos de combustible en tiempo real
- 🏪 Soporte para múltiples estaciones de servicio
- 📱 Notificaciones inteligentes (solo cambios significativos)
- 💾 Exporta datos en formato JSON
- 🎯 Alertas de bajo inventario
- ⚙️ Configuración TypeScript para mejor desarrollo

## 📋 Requisitos

- Node.js 16+ 
- npm o yarn

## 🛠️ Instalación

1. Clona o descarga el proyecto
2. Instala las dependencias:

```bash
npm install
```

3. Configura el bot de Telegram:
   - Crea un bot con [@BotFather](https://t.me/botfather)
   - Obtén tu token del bot
   - Obtén tu Chat ID (envía un mensaje a [@userinfobot](https://t.me/userinfobot))

4. Configura las variables de entorno:
   ```bash
   cp env.example .env
   ```
   
   Edita el archivo `.env` con tus datos:
   ```env
   TELEGRAM_BOT_TOKEN=tu_bot_token_aqui
   TELEGRAM_CHAT_ID=tu_chat_id_aqui
   ```

## 🎯 Uso

### Bot de Telegram (Recomendado)
```bash
npm run bot
```

### Scraper Manual
```bash
npm run scrape
```

### Desarrollo
```bash
npm run dev-bot      # Bot en modo desarrollo
npm run dev          # Scraper en modo desarrollo
```

### Compilar TypeScript
```bash
npm run build
```

## 🤖 Comandos del Bot

Una vez que el bot esté ejecutándose, puedes usar estos comandos en Telegram:

- `/start` - Mensaje de bienvenida y configuración
- `/status` - Ver estado actual del bot
- `/scrape` - Ejecutar scraping manual
- `/schedule` - Ver configuración del scheduler
- `/help` - Mostrar ayuda

## 📊 Datos Extraídos

El scraper extrae la siguiente información de cada estación:

- **Información básica**: ID, nombre, unidad, producto_id
- **Saldos**: Volumen disponible en litros, fecha de medición
- **Capacidad**: Cantidad de vehículos que puede atender
- **Tiempos**: Tiempo de espera aproximado por vehículo
- **Ubicación**: Dirección completa de la estación
- **Configuración**: Mangueras, tiempo de carga, carga promedio

## 📁 Estructura del Proyecto

```
fuel-scraper/
├── src/
│   ├── scraper.ts        # Scraper principal con fetch
│   ├── telegram-bot.ts   # Bot de Telegram con scheduler
│   └── types.ts          # Interfaces TypeScript
├── output/               # Archivos JSON generados
├── dist/                 # Código compilado (generado)
├── .env                  # Variables de entorno (crear desde env.example)
├── env.example           # Ejemplo de configuración
├── package.json
├── tsconfig.json
└── README.md
```

## 📄 Formato de Salida

Los datos se guardan en `output/fuel-data-YYYY-MM-DD.json` con la siguiente estructura:

```json
{
  "timestamp": "2025-01-09T14:03:00.000Z",
  "ultima_medicion": "2025-10-09 13:46",
  "tipo_combustible": "GASOLINA ESPECIAL",
  "estaciones": [
    {
      "id": 5849980,
      "un": 115,
      "producto_id": 134,
      "fecha": "2025-10-09 13:46:00",
      "saldo": "1018",
      "nombre_estacion": "EQUIPETROL",
      "volumen_disponible": 1018,
      "cantidad_vehiculos": 25,
      "tiempo_espera_minutos": 2,
      "direccion": "V. EQUIPETROL, 4TO ANILLO AL FRENTE DE EX - BUFALO PARK",
      "tipo_combustible": "G",
      "tiempo_carga": 12,
      "mangueras": 8,
      "carga_promedio": 40,
      "tiempo_carga_por_manguera": 1.5
    }
  ]
}
```

## ⚙️ Configuración

### Variables de Entorno (.env)

```env
# Bot de Telegram
TELEGRAM_BOT_TOKEN=tu_bot_token_aqui
TELEGRAM_CHAT_ID=tu_chat_id_aqui

# Configuración del Scraper
SCRAPER_URL=https://app9.biocloud.info/saldos/main/donde/G
CRON_SCHEDULE=0 * * * *

# Configuración de Notificaciones
NOTIFY_ONLY_CHANGES=true
MIN_VOLUME_THRESHOLD=1000
```

### Horarios de Scheduler (CRON_SCHEDULE)

- `0 * * * *` - Cada hora
- `0 */2 * * *` - Cada 2 horas  
- `0 */6 * * *` - Cada 6 horas
- `0 8,12,16,20 * * *` - 4 veces al día (8am, 12pm, 4pm, 8pm)
- `0 0 * * *` - Una vez al día (medianoche)

## 🐛 Solución de Problemas

### Error de timeout
- Aumenta el valor de `timeout` en la configuración
- Verifica tu conexión a internet

### No se encuentran estaciones
- La página puede haber cambiado su estructura
- Verifica que la URL sea correcta
- Ejecuta con `headless: false` para debug visual

### Error de Puppeteer
- Asegúrate de tener Node.js 16+
- Reinstala dependencias: `rm -rf node_modules && npm install`

## 📝 Scripts Disponibles

- `npm run bot` - Ejecuta el bot de Telegram con scheduler
- `npm run scrape` - Ejecuta el scraper manual
- `npm run dev-bot` - Ejecuta el bot en modo desarrollo
- `npm run dev` - Ejecuta el scraper en modo desarrollo
- `npm run build` - Compila TypeScript
- `npm run clean` - Limpia archivos compilados

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -m 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

MIT License - ver archivo LICENSE para más detalles.

## ⚠️ Disclaimer

Este scraper es para uso educativo y de investigación. Asegúrate de respetar los términos de servicio del sitio web objetivo y las leyes locales sobre web scraping.
