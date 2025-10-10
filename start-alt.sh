#!/bin/bash

# Script alternativo de inicio para Railway
echo "🚀 Iniciando Bot de Combustible (versión alternativa)..."

# Buscar node en diferentes ubicaciones
NODE_PATH=""
for path in "/usr/bin/node" "/usr/local/bin/node" "/opt/node/bin/node" "$(which node)"; do
    if [ -x "$path" ]; then
        NODE_PATH="$path"
        break
    fi
done

if [ -z "$NODE_PATH" ]; then
    echo "❌ Node.js no encontrado en el sistema"
    echo "🔍 Buscando en PATH: $PATH"
    exit 1
fi

echo "✅ Node.js encontrado en: $NODE_PATH"
echo "📋 Versión: $($NODE_PATH --version)"

# Buscar npm
NPM_PATH=""
for path in "/usr/bin/npm" "/usr/local/bin/npm" "/opt/node/bin/npm" "$(which npm)"; do
    if [ -x "$path" ]; then
        NPM_PATH="$path"
        break
    fi
done

if [ -z "$NPM_PATH" ]; then
    echo "❌ npm no encontrado en el sistema"
    echo "🔍 Buscando en PATH: $PATH"
    exit 1
fi

echo "✅ npm encontrado en: $NPM_PATH"
echo "📋 Versión: $($NPM_PATH --version)"

# Instalar dependencias
echo "📦 Instalando dependencias..."
$NPM_PATH ci

# Compilar TypeScript
echo "🔨 Compilando TypeScript..."
$NPM_PATH run build

# Verificar compilación
if [ ! -f "dist/production-bot.js" ]; then
    echo "❌ Error: No se pudo compilar el bot"
    echo "📁 Archivos en dist/:"
    ls -la dist/ || echo "Directorio dist/ no existe"
    exit 1
fi

echo "✅ Compilación exitosa"

# Iniciar bot
echo "🤖 Iniciando bot de producción..."
$NODE_PATH dist/production-bot.js
