import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export type DB = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profile (
  user_id INTEGER PRIMARY KEY,
  email TEXT, first_name TEXT, last_name TEXT
);
CREATE TABLE IF NOT EXISTS body_measurement (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  height_meter REAL, weight_kilogram REAL, max_heart_rate INTEGER
);
CREATE TABLE IF NOT EXISTS cycles (
  id INTEGER PRIMARY KEY,
  start_time TEXT NOT NULL, end_time TEXT, timezone_offset TEXT,
  score_state TEXT, strain REAL, kilojoule REAL,
  avg_heart_rate INTEGER, max_heart_rate INTEGER, raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recoveries (
  cycle_id INTEGER PRIMARY KEY,
  sleep_id TEXT, score_state TEXT, user_calibrating INTEGER,
  recovery_score REAL, resting_heart_rate REAL, hrv_rmssd_milli REAL,
  spo2_percentage REAL, skin_temp_celsius REAL, raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sleeps (
  id TEXT PRIMARY KEY, cycle_id INTEGER,
  start_time TEXT NOT NULL, end_time TEXT, timezone_offset TEXT, nap INTEGER,
  score_state TEXT, performance_pct REAL, consistency_pct REAL, efficiency_pct REAL,
  respiratory_rate REAL, light_ms INTEGER, sws_ms INTEGER, rem_ms INTEGER,
  awake_ms INTEGER, in_bed_ms INTEGER, disturbances INTEGER, sleep_needed_ms INTEGER,
  raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  start_time TEXT NOT NULL, end_time TEXT, timezone_offset TEXT, sport_name TEXT,
  score_state TEXT, strain REAL, avg_heart_rate INTEGER, max_heart_rate INTEGER,
  kilojoule REAL, distance_meter REAL, altitude_gain_meter REAL,
  zone_durations TEXT, raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  resource TEXT PRIMARY KEY,
  last_synced_at TEXT NOT NULL
);
`

function chmodIfExists(file: string, mode: number): void {
  try {
    fs.chmodSync(file, mode)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

function prepareDbPath(file: string): void {
  const dir = path.dirname(file)
  if (dir !== '.') {
    const resolvedDir = path.resolve(dir)
    const existed = fs.existsSync(resolvedDir)
    fs.mkdirSync(resolvedDir, { recursive: true, mode: 0o700 })
    if (!existed || resolvedDir === path.join(process.cwd(), 'data')) chmodIfExists(resolvedDir, 0o700)
  }
  const fd = fs.openSync(file, 'a', 0o600)
  fs.closeSync(fd)
  secureDbFiles(file)
}

function secureDbFiles(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) chmodIfExists(`${file}${suffix}`, 0o600)
}

export function createDb(file: string): DB {
  if (file !== ':memory:') prepareDbPath(file)
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  if (file !== ':memory:') secureDbFiles(file)
  db.exec(SCHEMA)
  // migration for DBs created before sleeps.cycle_id existed
  const sleepCols = db.prepare(`SELECT name FROM pragma_table_info('sleeps')`).all() as { name: string }[]
  if (!sleepCols.some((c) => c.name === 'cycle_id')) {
    db.exec(`ALTER TABLE sleeps ADD COLUMN cycle_id INTEGER`)
    db.exec(`UPDATE sleeps SET cycle_id = json_extract(raw, '$.cycle_id')`)
  }
  if (file !== ':memory:') secureDbFiles(file)
  return db
}

// Survive Next.js dev hot-reload without leaking connections.
const g = globalThis as unknown as { __whoopDb?: DB }

export function getDb(): DB {
  if (!g.__whoopDb) {
    g.__whoopDb = createDb(process.env.WHOOP_DB_PATH ?? path.join(process.cwd(), 'data', 'whoop.db'))
  }
  return g.__whoopDb
}

export interface TokenRow {
  access_token: string
  refresh_token: string
  expires_at: number // ms epoch
}

export function getTokens(db: DB): TokenRow | null {
  const row = db.prepare('SELECT access_token, refresh_token, expires_at FROM tokens WHERE id = 1').get()
  return (row as TokenRow) ?? null
}

export function saveTokens(db: DB, t: TokenRow): void {
  db.prepare(`INSERT INTO tokens (id, access_token, refresh_token, expires_at)
    VALUES (1, @access_token, @refresh_token, @expires_at)
    ON CONFLICT(id) DO UPDATE SET access_token=@access_token, refresh_token=@refresh_token, expires_at=@expires_at`).run(t)
}

export function clearTokens(db: DB): void {
  db.prepare('DELETE FROM tokens').run()
}

export function saveProfile(db: DB, p: any): void {
  db.prepare(`INSERT INTO profile (user_id, email, first_name, last_name)
    VALUES (@user_id, @email, @first_name, @last_name)
    ON CONFLICT(user_id) DO UPDATE SET email=@email, first_name=@first_name, last_name=@last_name`)
    .run({ user_id: p.user_id, email: p.email ?? null, first_name: p.first_name ?? null, last_name: p.last_name ?? null })
}

export function getProfile(db: DB): { user_id: number; email: string | null; first_name: string | null; last_name: string | null } | null {
  return (db.prepare('SELECT * FROM profile LIMIT 1').get() as any) ?? null
}

export function saveBodyMeasurement(db: DB, b: any): void {
  db.prepare(`INSERT INTO body_measurement (id, height_meter, weight_kilogram, max_heart_rate)
    VALUES (1, @h, @w, @m)
    ON CONFLICT(id) DO UPDATE SET height_meter=@h, weight_kilogram=@w, max_heart_rate=@m`)
    .run({ h: b.height_meter ?? null, w: b.weight_kilogram ?? null, m: b.max_heart_rate ?? null })
}

export function upsertCycle(db: DB, rec: any): void {
  const s = rec.score_state === 'SCORED' ? rec.score : null
  db.prepare(`INSERT INTO cycles (id, start_time, end_time, timezone_offset, score_state, strain, kilojoule, avg_heart_rate, max_heart_rate, raw)
    VALUES (@id, @st, @et, @tz, @state, @strain, @kj, @ahr, @mhr, @raw)
    ON CONFLICT(id) DO UPDATE SET start_time=@st, end_time=@et, timezone_offset=@tz, score_state=@state,
      strain=@strain, kilojoule=@kj, avg_heart_rate=@ahr, max_heart_rate=@mhr, raw=@raw`)
    .run({
      id: rec.id, st: rec.start, et: rec.end ?? null, tz: rec.timezone_offset ?? null,
      state: rec.score_state ?? null, strain: s?.strain ?? null, kj: s?.kilojoule ?? null,
      ahr: s?.average_heart_rate ?? null, mhr: s?.max_heart_rate ?? null, raw: JSON.stringify(rec),
    })
}

export function upsertRecovery(db: DB, rec: any): void {
  const s = rec.score_state === 'SCORED' ? rec.score : null
  db.prepare(`INSERT INTO recoveries (cycle_id, sleep_id, score_state, user_calibrating, recovery_score, resting_heart_rate, hrv_rmssd_milli, spo2_percentage, skin_temp_celsius, raw)
    VALUES (@cid, @sid, @state, @cal, @score, @rhr, @hrv, @spo2, @temp, @raw)
    ON CONFLICT(cycle_id) DO UPDATE SET sleep_id=@sid, score_state=@state, user_calibrating=@cal,
      recovery_score=@score, resting_heart_rate=@rhr, hrv_rmssd_milli=@hrv, spo2_percentage=@spo2, skin_temp_celsius=@temp, raw=@raw`)
    .run({
      cid: rec.cycle_id, sid: rec.sleep_id ?? null, state: rec.score_state ?? null,
      cal: s?.user_calibrating ? 1 : 0, score: s?.recovery_score ?? null,
      rhr: s?.resting_heart_rate ?? null, hrv: s?.hrv_rmssd_milli ?? null,
      spo2: s?.spo2_percentage ?? null, temp: s?.skin_temp_celsius ?? null, raw: JSON.stringify(rec),
    })
}

export function upsertSleep(db: DB, rec: any): void {
  const s = rec.score_state === 'SCORED' ? rec.score : null
  const st = s?.stage_summary
  const need = s?.sleep_needed
  const needed = need
    ? (need.baseline_milli ?? 0) + (need.need_from_sleep_debt_milli ?? 0) +
      (need.need_from_recent_strain_milli ?? 0) + (need.need_from_recent_nap_milli ?? 0)
    : null
  db.prepare(`INSERT INTO sleeps (id, cycle_id, start_time, end_time, timezone_offset, nap, score_state, performance_pct, consistency_pct, efficiency_pct, respiratory_rate, light_ms, sws_ms, rem_ms, awake_ms, in_bed_ms, disturbances, sleep_needed_ms, raw)
    VALUES (@id, @cid, @st, @et, @tz, @nap, @state, @perf, @cons, @eff, @rr, @light, @sws, @rem, @awake, @inbed, @dist, @need, @raw)
    ON CONFLICT(id) DO UPDATE SET cycle_id=@cid, start_time=@st, end_time=@et, timezone_offset=@tz, nap=@nap, score_state=@state,
      performance_pct=@perf, consistency_pct=@cons, efficiency_pct=@eff, respiratory_rate=@rr,
      light_ms=@light, sws_ms=@sws, rem_ms=@rem, awake_ms=@awake, in_bed_ms=@inbed, disturbances=@dist, sleep_needed_ms=@need, raw=@raw`)
    .run({
      id: rec.id, cid: rec.cycle_id ?? null, st: rec.start, et: rec.end ?? null, tz: rec.timezone_offset ?? null,
      nap: rec.nap ? 1 : 0, state: rec.score_state ?? null,
      perf: s?.sleep_performance_percentage ?? null, cons: s?.sleep_consistency_percentage ?? null,
      eff: s?.sleep_efficiency_percentage ?? null, rr: s?.respiratory_rate ?? null,
      light: st?.total_light_sleep_time_milli ?? null, sws: st?.total_slow_wave_sleep_time_milli ?? null,
      rem: st?.total_rem_sleep_time_milli ?? null, awake: st?.total_awake_time_milli ?? null,
      inbed: st?.total_in_bed_time_milli ?? null, dist: st?.disturbance_count ?? null,
      need: needed, raw: JSON.stringify(rec),
    })
}

export function upsertWorkout(db: DB, rec: any): void {
  const s = rec.score_state === 'SCORED' ? rec.score : null
  db.prepare(`INSERT INTO workouts (id, start_time, end_time, timezone_offset, sport_name, score_state, strain, avg_heart_rate, max_heart_rate, kilojoule, distance_meter, altitude_gain_meter, zone_durations, raw)
    VALUES (@id, @st, @et, @tz, @sport, @state, @strain, @ahr, @mhr, @kj, @dist, @alt, @zones, @raw)
    ON CONFLICT(id) DO UPDATE SET start_time=@st, end_time=@et, timezone_offset=@tz, sport_name=@sport, score_state=@state,
      strain=@strain, avg_heart_rate=@ahr, max_heart_rate=@mhr, kilojoule=@kj, distance_meter=@dist, altitude_gain_meter=@alt, zone_durations=@zones, raw=@raw`)
    .run({
      id: rec.id, st: rec.start, et: rec.end ?? null, tz: rec.timezone_offset ?? null,
      sport: rec.sport_name ?? null, state: rec.score_state ?? null,
      strain: s?.strain ?? null, ahr: s?.average_heart_rate ?? null, mhr: s?.max_heart_rate ?? null,
      kj: s?.kilojoule ?? null, dist: s?.distance_meter ?? null, alt: s?.altitude_gain_meter ?? null,
      zones: s?.zone_durations ? JSON.stringify(s.zone_durations) : null, raw: JSON.stringify(rec),
    })
}

export function setSyncState(db: DB, resource: string, at: string): void {
  db.prepare(`INSERT INTO sync_state (resource, last_synced_at) VALUES (@resource, @at)
    ON CONFLICT(resource) DO UPDATE SET last_synced_at=@at`).run({ resource, at })
}

export function getLastSyncedAt(db: DB): string | null {
  const row = db.prepare('SELECT MAX(last_synced_at) AS m FROM sync_state').get() as { m: string | null }
  return row.m
}
