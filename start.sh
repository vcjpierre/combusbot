#!/bin/bash

# Script de inicio para Railway
echo "🚀 Iniciando Bot de Combustible..."

# Verificar que node está disponible
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no está disponible"
    exit 1
fi

# Verificar que npm está disponible
if ! command -v npm &> /dev/null; then
    echo "❌ npm no está disponible"
    exit 1
fi

# Mostrar versiones
echo "📋 Node.js version: $(node --version)"
echo "📋 npm version: $(npm --version)"

# Instalar dependencias
echo "📦 Instalando dependencias..."
npm ci --only=production

# Compilar TypeScript
echo "🔨 Compilando TypeScript..."
npx tsc

# Verificar que el archivo compilado existe
if [ ! -f "dist/production-bot.js" ]; then
    echo "❌ Error: No se pudo compilar el bot de producción"
    exit 1
fi

# Iniciar el bot de producción
echo "🤖 Iniciando bot de producción..."
node dist/production-bot.js
