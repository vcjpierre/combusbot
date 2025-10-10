#!/bin/bash

# Script optimizado para Railway
echo "🚀 Iniciando Bot de Combustible en Railway..."

# Verificar entorno
echo "🔍 Verificando entorno..."
echo "PATH: $PATH"
echo "PWD: $PWD"
echo "NODE_ENV: $NODE_ENV"

# Buscar node
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js disponible: $(node --version)"
else
    echo "❌ Node.js no disponible"
    exit 1
fi

# Buscar npm
if command -v npm >/dev/null 2>&1; then
    echo "✅ npm disponible: $(npm --version)"
else
    echo "❌ npm no disponible"
    exit 1
fi

# Instalar dependencias
echo "📦 Instalando dependencias..."
npm install --production

# Compilar TypeScript
echo "🔨 Compilando TypeScript..."
npx tsc

# Verificar compilación
if [ -f "dist/production-bot.js" ]; then
    echo "✅ Compilación exitosa"
else
    echo "❌ Error en compilación"
    ls -la dist/ 2>/dev/null || echo "Directorio dist/ no existe"
    exit 1
fi

# Iniciar bot
echo "🤖 Iniciando bot de producción..."
exec node dist/production-bot.js
