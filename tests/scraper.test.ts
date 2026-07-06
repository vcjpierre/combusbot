import { describe, it, expect } from 'vitest';
import { extractDataFromHTML } from '../src/scraper';

const MOCK_HTML = `
<!DOCTYPE html>
<html>
<head><title>Saldos de GASOLINA ESPECIAL</title></head>
<body>
<h5>Saldos de GASOLINA ESPECIAL</h5>
<h5>Última medición: 2026-07-06 08:00</h5>

<div class="btn-bio-app">
  <div class="font-weight-bold">ALEMANA</div>
  <div>1500 Lts.</div>
  <div>5 minutos aprox.</div>
  <div class="alert-secondary"><div>AV. ALEMANA, ZONA 1</div></div>
</div>

<div class="btn-bio-app">
  <div class="font-weight-bold">BENI</div>
  <div>200 Lts.</div>
  <div>3 minutos aprox.</div>
  <div class="alert-secondary"><div>AV. BENI, ZONA 2</div></div>
</div>

<div class="btn-bio-app">
  <div class="font-weight-bold">CEDENO</div>
  <div>0 Lts.</div>
  <div>10 minutos aprox.</div>
  <div class="alert-secondary"><div>AV. CEDENO, ZONA 3</div></div>
</div>

</body>
</html>
`;

const EMPTY_HTML = `
<!DOCTYPE html>
<html>
<body>
<h5>Saldos de GASOLINA ESPECIAL</h5>
<h5>Última medición: 2026-07-06 08:00</h5>
</body>
</html>
`;

describe('extractDataFromHTML', () => {
  it('should extract stations from HTML', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    expect(data.estaciones.length).toBe(3);
  });

  it('should extract correct station names', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    const names = data.estaciones.map((s) => s.nombre_estacion);
    expect(names).toContain('ALEMANA');
    expect(names).toContain('BENI');
    expect(names).toContain('CEDENO');
  });

  it('should extract volumes correctly', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    const alemana = data.estaciones.find((s) => s.nombre_estacion === 'ALEMANA');
    expect(alemana?.volumen_disponible).toBe(1500);
  });

  it('should extract wait times correctly', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    const alemana = data.estaciones.find((s) => s.nombre_estacion === 'ALEMANA');
    expect(alemana?.tiempo_espera_minutos).toBe(5);
  });

  it('should extract addresses correctly', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    const alemana = data.estaciones.find((s) => s.nombre_estacion === 'ALEMANA');
    expect(alemana?.direccion).toBe('AV. ALEMANA, ZONA 1');
  });

  it('should extract fuel type from heading', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    expect(data.tipo_combustible).toBe('GASOLINA ESPECIAL');
  });

  it('should extract ultima medicion', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    expect(data.ultima_medicion).toContain('2026-07-06');
  });

  it('should assign metadata IDs from STATION_META', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    const alemana = data.estaciones.find((s) => s.nombre_estacion === 'ALEMANA');
    expect(alemana?.id).toBe(5850245);
  });

  it('should return empty stations for empty HTML', () => {
    const data = extractDataFromHTML(EMPTY_HTML);
    expect(data.estaciones.length).toBe(0);
  });

  it('should handle missing volume gracefully', () => {
    const html = `
      <body>
      <h5>Saldos de TEST</h5>
      <h5>Ultima medicion: 2026-07-06</h5>
      <div class="btn-bio-app">
        <div class="font-weight-bold">TEST</div>
        <div>5 minutos aprox.</div>
        <div class="alert-secondary"><div>Test addr</div></div>
      </div>
      </body>
    `;
    const data = extractDataFromHTML(html);
    expect(data.estaciones.length).toBe(1);
    expect(data.estaciones[0].volumen_disponible).toBe(0);
  });

  it('should produce valid ScrapedData structure', () => {
    const data = extractDataFromHTML(MOCK_HTML);
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('ultima_medicion');
    expect(data).toHaveProperty('tipo_combustible');
    expect(data).toHaveProperty('estaciones');
    expect(Array.isArray(data.estaciones)).toBe(true);
    data.estaciones.forEach((s) => {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('nombre_estacion');
      expect(s).toHaveProperty('volumen_disponible');
      expect(s).toHaveProperty('tiempo_espera_minutos');
      expect(s).toHaveProperty('direccion');
    });
  });
});
