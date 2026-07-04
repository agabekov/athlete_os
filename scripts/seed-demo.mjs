// Seeds data/whoop.db with ~400 days of plausible fake WHOOP data for visual work.
// Usage: node scripts/seed-demo.mjs   (delete data/whoop.db afterwards for a clean real sync)
import Database from 'better-sqlite3'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

fs.mkdirSync('data', { recursive: true })
// reuse the app's schema by running a tiny TS-free bootstrap: copy schema DDL from lib/db.ts
const ddl = fs.readFileSync('lib/db.ts', 'utf8').match(/const SCHEMA = `([\s\S]*?)`/)[1]
const db = new Database('data/whoop.db')
db.pragma('journal_mode = WAL')
db.exec(ddl)

const DAYS = 400
const SPORTS = ['running', 'weightlifting', 'cycling', 'boxing', 'swimming']
const now = Date.now()
const rand = (() => { let s = 42; return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) })()

db.prepare(`INSERT OR REPLACE INTO tokens (id, access_token, refresh_token, expires_at) VALUES (1,'demo','demo',?)`)
  .run(now + 86400000)
db.prepare(`INSERT OR REPLACE INTO profile (user_id, email, first_name, last_name) VALUES (1,'demo@demo.io','Demo','Athlete')`).run()
db.prepare(`INSERT OR REPLACE INTO body_measurement (id, height_meter, weight_kilogram, max_heart_rate) VALUES (1,1.80,75,190)`).run()
db.prepare(`INSERT OR REPLACE INTO sync_state (resource, last_synced_at) VALUES ('cycles',?)`).run(new Date(now).toISOString())

const insCycle = db.prepare(`INSERT OR REPLACE INTO cycles (id, start_time, end_time, timezone_offset, score_state, strain, kilojoule, avg_heart_rate, max_heart_rate, raw) VALUES (?,?,?,?,'SCORED',?,?,?,?,'{}')`)
const insRec = db.prepare(`INSERT OR REPLACE INTO recoveries (cycle_id, sleep_id, score_state, user_calibrating, recovery_score, resting_heart_rate, hrv_rmssd_milli, spo2_percentage, skin_temp_celsius, raw) VALUES (?,?,'SCORED',0,?,?,?,?,?,'{}')`)
const insSleep = db.prepare(`INSERT OR REPLACE INTO sleeps (id, start_time, end_time, timezone_offset, nap, score_state, performance_pct, consistency_pct, efficiency_pct, respiratory_rate, light_ms, sws_ms, rem_ms, awake_ms, in_bed_ms, disturbances, sleep_needed_ms, raw) VALUES (?,?,?,?,0,'SCORED',?,?,?,?,?,?,?,?,?,?,?,'{}')`)
const insWk = db.prepare(`INSERT OR REPLACE INTO workouts (id, start_time, end_time, timezone_offset, sport_name, score_state, strain, avg_heart_rate, max_heart_rate, kilojoule, distance_meter, altitude_gain_meter, zone_durations, raw) VALUES (?,?,?,?,?,'SCORED',?,?,?,?,?,?,?,'{}')`)

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
  insSleep.run(`sleep-${i}`, iso(sleepStart), iso(sleepStart + totalSleep + awake), '+00:00', Math.min(100, 70 + wave * 20 + rand() * 18), 60 + rand() * 30, 85 + rand() * 12, 13.5 + rand() * 2.5, light, sws, rem, awake, totalSleep + awake, Math.floor(rand() * 8), 27600000)
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

console.log('Seeded', DAYS + 1, 'days into data/whoop.db')
