// Seeds an isolated database with ~400 days of plausible fake WHOOP data.
// Usage: node scripts/seed-demo.mjs
// Preview: WHOOP_DB_PATH=data/whoop-demo.db npm run dev
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve(process.env.WHOOP_DB_PATH ?? 'data/whoop-demo.db')
const realDefault = path.resolve('data/whoop.db')
function canonical(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target)
  const parent = path.dirname(target)
  return parent === target ? target : path.join(canonical(parent), path.basename(target))
}
if (canonical(file) === canonical(realDefault)) {
  throw new Error('Refusing to seed the real default database. Use a separate demo database.')
}
if (['', '-wal', '-shm'].some((suffix) => fs.existsSync(`${file}${suffix}`) && fs.statSync(`${file}${suffix}`).size > 0)) {
  throw new Error('Refusing to seed an existing nonempty database. Choose a new demo path.')
}

fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
const fd = fs.openSync(file, fs.existsSync(file) ? 'r+' : 'wx', 0o600)
if (fs.fstatSync(fd).size > 0) {
  fs.closeSync(fd)
  throw new Error('Refusing to seed an existing nonempty database. Choose a new demo path.')
}
fs.closeSync(fd)
fs.chmodSync(file, 0o600)
// Keep the seed schema aligned with the application without transpiling TS.
const source = fs.readFileSync(new URL('../lib/db.ts', import.meta.url), 'utf8')
const ddl = source.match(/const SCHEMA = `([\s\S]*?)`/)?.[1]
if (!ddl) throw new Error('Could not read the application database schema.')
function secureFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.chmodSync(`${file}${suffix}`, 0o600) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
const db = new Database(file)
try {
  db.pragma('journal_mode = WAL')
  db.exec(ddl)
  secureFiles()

  const DAYS = 400
  const SPORTS = ['running', 'weightlifting', 'cycling', 'boxing', 'swimming']
  const now = Date.now()
  const rand = (() => { let s = 42; return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) })()

  db.prepare(`INSERT OR REPLACE INTO tokens (id, access_token, refresh_token, expires_at) VALUES (1,'demo','demo',?)`)
    .run(now + 86400000)
  db.prepare(`INSERT OR REPLACE INTO profile (user_id, email, first_name, last_name) VALUES (1,'demo@demo.io','Demo','Athlete')`).run()
  db.prepare(`INSERT OR REPLACE INTO body_measurement (id, height_meter, weight_kilogram, max_heart_rate) VALUES (1,1.80,75,190)`).run()
  db.prepare(`INSERT INTO account_owner (id, user_id) VALUES (1,1)`).run()
  db.prepare(`INSERT INTO sync_status (id, last_completed_at, incomplete) VALUES (1,?,0)`).run(new Date(now).toISOString())

  const insCycle = db.prepare(`INSERT OR REPLACE INTO cycles (id, start_time, end_time, timezone_offset, score_state, strain, kilojoule, avg_heart_rate, max_heart_rate, raw) VALUES (?,?,?,?,'SCORED',?,?,?,?,'{}')`)
  const insRec = db.prepare(`INSERT OR REPLACE INTO recoveries (cycle_id, sleep_id, score_state, user_calibrating, recovery_score, resting_heart_rate, hrv_rmssd_milli, spo2_percentage, skin_temp_celsius, raw) VALUES (?,?,'SCORED',0,?,?,?,?,?,'{}')`)
  const insSleep = db.prepare(`INSERT OR REPLACE INTO sleeps (id, cycle_id, start_time, end_time, timezone_offset, nap, score_state, performance_pct, consistency_pct, efficiency_pct, respiratory_rate, light_ms, sws_ms, rem_ms, awake_ms, in_bed_ms, disturbances, sleep_needed_ms, raw) VALUES (?,?,?,?,?,0,'SCORED',?,?,?,?,?,?,?,?,?,?,?,'{}')`)
  const insWk = db.prepare(`INSERT OR REPLACE INTO workouts (id, start_time, end_time, timezone_offset, sport_name, score_state, strain, avg_heart_rate, max_heart_rate, kilojoule, distance_meter, altitude_gain_meter, zone_durations, raw) VALUES (?,?,?,?,?,'SCORED',?,?,?,?,?,?,?,'{}')`)

  db.transaction(() => {
    for (let i = DAYS; i >= 0; i--) {
      const dayStart = now - i * 86400000
      const wave = Math.sin(i / 9) * 0.5 + Math.sin(i / 30) * 0.3
      const recovery = Math.max(15, Math.min(98, 62 + wave * 30 + (rand() - 0.5) * 24))
      const hrv = Math.max(40, 95 + wave * 25 + (rand() - 0.5) * 20)
      const rhr = Math.max(40, 52 - wave * 5 + (rand() - 0.5) * 6)
      const strain = Math.max(3, Math.min(19.5, 11 + wave * 5 + (rand() - 0.5) * 7))
      const sleepStart = dayStart - 6 * 3600000
      const totalSleep = (6.4 + wave + rand() * 1.6) * 3600000
      const sws = totalSleep * (0.2 + rand() * 0.06)
      const rem = totalSleep * (0.22 + rand() * 0.06)
      const light = totalSleep - sws - rem
      const awake = totalSleep * (0.06 + rand() * 0.05)
      const iso = (t) => new Date(t).toISOString()

      insCycle.run(1000 + i, iso(dayStart - 9 * 3600000), iso(dayStart + 15 * 3600000), '+00:00', strain, 7000 + strain * 350, 66 + strain, 120 + strain * 3)
      insSleep.run(`sleep-${i}`, 1000 + i, iso(sleepStart), iso(sleepStart + totalSleep + awake), '+00:00', Math.min(100, 70 + wave * 20 + rand() * 18), 60 + rand() * 30, 85 + rand() * 12, 13.5 + rand() * 2.5, light, sws, rem, awake, totalSleep + awake, Math.floor(rand() * 8), 27600000)
      insRec.run(1000 + i, `sleep-${i}`, recovery, rhr, hrv, 95.5 + rand() * 2.8, 32.8 + rand() * 1.4)

      if (rand() > 0.45) {
        const sport = SPORTS[Math.floor(rand() * SPORTS.length)]
        const wStrain = Math.max(4, strain * (0.55 + rand() * 0.4))
        const dur = (0.5 + rand() * 1.2) * 3600000
        const zones = JSON.stringify({
          zone_zero_milli: dur * 0.05, zone_one_milli: dur * 0.2, zone_two_milli: dur * 0.3,
          zone_three_milli: dur * 0.25, zone_four_milli: dur * 0.15, zone_five_milli: dur * 0.05,
        })
        insWk.run(`wk-${i}`, iso(dayStart + 10 * 3600000), iso(dayStart + 10 * 3600000 + dur), '+00:00', sport, wStrain, 130 + rand() * 30, 160 + rand() * 30, 1500 + rand() * 2000, sport === 'running' ? 5000 + rand() * 8000 : null, rand() * 120, zones)
      }
    }
  })()

  console.log('Seeded', DAYS + 1, 'days into', file)
  console.log('Preview with WHOOP_DB_PATH set to this demo path. Keep it separate from your account database.')
} finally {
  try { secureFiles() }
  finally { db.close() }
}
