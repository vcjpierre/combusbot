import Database from 'better-sqlite3';
import * as path from 'path';
import { FuelStationData, ScrapedData } from './types';
import { getLogger } from './logger';

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    const dbPath = path.join(process.cwd(), 'output', 'history.db');
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        ultima_medicion TEXT,
        tipo_combustible TEXT,
        raw_json TEXT
      );
      CREATE TABLE IF NOT EXISTS stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL,
        station_name TEXT NOT NULL,
        station_id INTEGER,
        volumen_disponible INTEGER,
        tiempo_espera_minutos REAL,
        direccion TEXT,
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);
      CREATE INDEX IF NOT EXISTS idx_stations_snapshot ON stations(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_stations_name ON stations(station_name);
    `);
    getLogger().info({ path: dbPath }, 'Database initialized');
  }
  return _db;
}

export function saveSnapshot(data: ScrapedData): number {
  const db = getDb();
  const insertSnapshot = db.prepare(
    'INSERT INTO snapshots (timestamp, ultima_medicion, tipo_combustible, raw_json) VALUES (?, ?, ?, ?)',
  );
  const insertStation = db.prepare(
    'INSERT INTO stations (snapshot_id, station_name, station_id, volumen_disponible, tiempo_espera_minutos, direccion) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const result = db.transaction(() => {
    const snapResult = insertSnapshot.run(data.timestamp, data.ultima_medicion, data.tipo_combustible, JSON.stringify(data));
    const snapshotId = snapResult.lastInsertRowid as number;
    for (const s of data.estaciones) {
      insertStation.run(snapshotId, s.nombre_estacion, s.id, s.volumen_disponible, s.tiempo_espera_minutos, s.direccion);
    }
    return snapshotId;
  })();

  getLogger().debug({ snapshotId: result }, 'Snapshot saved to history');
  return result;
}

export interface StationTrend {
  station_name: string;
  timestamp: string;
  volumen_disponible: number;
  tiempo_espera_minutos: number;
}

export function getStationTrend(stationName: string, hours = 24): StationTrend[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.station_name, sn.timestamp, s.volumen_disponible, s.tiempo_espera_minutos
       FROM stations s
       JOIN snapshots sn ON s.snapshot_id = sn.id
       WHERE s.station_name = ? AND sn.timestamp >= datetime('now', ?)
       ORDER BY sn.timestamp ASC`,
    )
    .all(stationName, `-${hours} hours`) as StationTrend[];
  return rows;
}

export interface StationSummary {
  station_name: string;
  avg_volume: number;
  min_volume: number;
  max_volume: number;
  samples: number;
}

export function getStationSummary(stationName: string, hours = 24): StationSummary | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT station_name,
              AVG(volumen_disponible) as avg_volume,
              MIN(volumen_disponible) as min_volume,
              MAX(volumen_disponible) as max_volume,
              COUNT(*) as samples
       FROM stations s
       JOIN snapshots sn ON s.snapshot_id = sn.id
       WHERE s.station_name = ? AND sn.timestamp >= datetime('now', ?)`,
    )
    .get(stationName, `-${hours} hours`) as StationSummary | undefined;
  return row ?? null;
}

export function getRecentSnapshots(limit = 10): { timestamp: string; station_count: number }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT sn.timestamp, COUNT(s.id) as station_count
       FROM snapshots sn
       LEFT JOIN stations s ON s.snapshot_id = sn.id
       GROUP BY sn.id
       ORDER BY sn.timestamp DESC
       LIMIT ?`,
    )
    .all(limit) as { timestamp: string; station_count: number }[];
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
