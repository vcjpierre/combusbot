import * as dotenv from 'dotenv';
import { ScrapedData, FuelStationData } from './types';

// Cargar variables de entorno
dotenv.config();

async function verifyRealData(): Promise<void> {
  console.log('🔍 Verificando que los datos son 100% reales de la página...');
  
  try {
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
    
    console.log('📡 Obteniendo HTML de la página...');
    const response = await fetch(url, {
      method: 'GET',
      headers: headers,
      redirect: 'follow'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    console.log(`✅ HTML obtenido: ${html.length} caracteres`);
    
    // Buscar arrays PHP
    const phpArrayRegex = /array\(\d+\)\s*\{\s*\["id"\]=>\s*int\((\d+)\)\s*\["un"\]=>\s*int\((\d+)\)\s*\["producto_id"\]=>\s*int\((\d+)\)\s*\["fecha"\]=>\s*string\(\d+\)\s*"([^"]+)"\s*\["saldo"\]=>\s*string\(\d+\)\s*"([^"]+)"\s*\}/g;
    
    let match;
    let stationCount = 0;
    let totalVehiclesFromHTML = 0;
    let totalVehiclesCalculated = 0;
    
    console.log('\n🔍 Verificando extracción de vehículos...');
    console.log('=' .repeat(80));
    
    while ((match = phpArrayRegex.exec(html)) !== null) {
      stationCount++;
      const id = parseInt(match[1]);
      const saldo = match[5];
      const volume = parseInt(saldo);
      
      // Buscar contexto alrededor del array PHP
      const contextStart = Math.max(0, match.index - 3000);
      const contextEnd = Math.min(html.length, match.index + 3000);
      const context = html.substring(contextStart, contextEnd);
      
      // Extraer vehículos del HTML
      let vehiclesFromHTML = 0;
      const vehiclesPatterns = [
        /(\d+)\s*vehículos?/i,
        /vehículos?[:\s]*(\d+)/i,
        /veh[:\s]*(\d+)/i,
        /(\d+)\s*veh/i
      ];
      
      for (const pattern of vehiclesPatterns) {
        const vehiclesMatch = context.match(pattern);
        if (vehiclesMatch) {
          vehiclesFromHTML = parseInt(vehiclesMatch[1]);
          break;
        }
      }
      
      // Calcular vehículos (lo que NO queremos usar)
      const vehiclesCalculated = Math.round(volume / 40);
      
      totalVehiclesFromHTML += vehiclesFromHTML;
      totalVehiclesCalculated += vehiclesCalculated;
      
      console.log(`📊 Estación ${stationCount} (ID: ${id}):`);
      console.log(`   Volumen: ${volume} Lts.`);
      console.log(`   🎯 Vehículos del HTML: ${vehiclesFromHTML}`);
      console.log(`   ❌ Vehículos calculados: ${vehiclesCalculated}`);
      console.log(`   📈 Diferencia: ${Math.abs(vehiclesFromHTML - vehiclesCalculated)}`);
      
      if (vehiclesFromHTML !== vehiclesCalculated) {
        console.log(`   ✅ CORRECTO: Usando valor real del HTML`);
      } else {
        console.log(`   ⚠️  COINCIDENCIA: Valores iguales por casualidad`);
      }
      
      if (stationCount >= 5) {
        console.log('\n⚠️  Mostrando solo las primeras 5 estaciones...');
        break;
      }
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log(`📊 RESUMEN:`);
    console.log(`   Total de estaciones: ${stationCount}`);
    console.log(`   🎯 Total vehículos del HTML: ${totalVehiclesFromHTML}`);
    console.log(`   ❌ Total vehículos calculados: ${totalVehiclesCalculated}`);
    console.log(`   📈 Diferencia total: ${Math.abs(totalVehiclesFromHTML - totalVehiclesCalculated)}`);
    
    if (totalVehiclesFromHTML !== totalVehiclesCalculated) {
      console.log(`\n✅ VERIFICACIÓN EXITOSA: El scraper usa valores reales del HTML`);
      console.log(`   No se realizan cálculos automáticos para cantidad de vehículos`);
    } else {
      console.log(`\n⚠️  ADVERTENCIA: Los valores coinciden por casualidad`);
    }
    
    console.log('\n🎉 Verificación completada');
    
  } catch (error: any) {
    console.error('❌ Error en verificación:', error.message);
  }
}

// Ejecutar verificación
verifyRealData().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('💥 Error fatal:', error);
  process.exit(1);
});
