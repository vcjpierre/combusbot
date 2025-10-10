#!/bin/bash

# Script de inicio para Railway
echo "🚀 Iniciando Bot de Combustible..."

# Instalar dependencias si es necesario
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias..."
    npm install
fi

# Compilar TypeScript
echo "🔨 Compilando TypeScript..."
npm run build

# Iniciar el bot de producción
echo "🤖 Iniciando bot de producción..."
npm run bot-production
