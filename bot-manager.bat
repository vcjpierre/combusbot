@echo off
echo ========================================
echo    Bot Manager - Fuel Scraper Bot
echo ========================================
echo.

:menu
echo Selecciona una opcion:
echo 1. Verificar instancias del bot
echo 2. Detener todas las instancias
echo 3. Ejecutar bot de produccion
echo 4. Ejecutar bot webhook
echo 5. Probar configuracion del bot
echo 6. Salir
echo.
set /p choice="Ingresa tu opcion (1-6): "

if "%choice%"=="1" goto check
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto production
if "%choice%"=="4" goto webhook
if "%choice%"=="5" goto test
if "%choice%"=="6" goto exit
goto menu

:check
echo.
echo Verificando instancias del bot...
npm run check-instances
echo.
pause
goto menu

:stop
echo.
echo Deteniendo todas las instancias de Node.js...
taskkill /F /IM node.exe 2>nul
if %errorlevel%==0 (
    echo Instancias detenidas exitosamente.
) else (
    echo No se encontraron instancias de Node.js ejecutandose.
)
echo.
pause
goto menu

:production
echo.
echo Ejecutando bot de produccion...
echo Presiona Ctrl+C para detener el bot.
npm run bot-production
echo.
pause
goto menu

:webhook
echo.
echo Ejecutando bot webhook...
echo Presiona Ctrl+C para detener el bot.
npm run bot-webhook
echo.
pause
goto menu

:test
echo.
echo Probando configuracion del bot...
npm run test-bot
echo.
pause
goto menu

:exit
echo.
echo Saliendo del Bot Manager...
exit
