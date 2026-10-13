import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const script = fileURLToPath(new URL('../scripts/seed-demo.mjs', import.meta.url))
const tempDirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whoop-seed-test-'))
  tempDirs.push(dir)
  return dir
}
function runSeed(cwd: string, dbPath?: string): string {
  const env = { ...process.env }
  delete env.WHOOP_DB_PATH
  if (dbPath !== undefined) env.WHOOP_DB_PATH = dbPath
  return execFileSync(process.execPath, [script], { cwd, env, encoding: 'utf8', stdio: 'pipe' })
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('demo seed', () => {
  it('uses a separate default demo database and refuses to overwrite it', () => {
    const dir = tempDir()
    expect(runSeed(dir)).toContain(path.join(dir, 'data', 'whoop-demo.db'))
    expect(fs.existsSync(path.join(dir, 'data', 'whoop.db'))).toBe(false)
    const file = path.join(dir, 'data', 'whoop-demo.db')
    const before = fs.readFileSync(file)
    expect(() => runSeed(dir)).toThrow()
    expect(fs.readFileSync(file)).toEqual(before)
    const db = new Database(file, { readonly: true })
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM cycles').get()).toEqual({ n: 401 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM sleeps WHERE cycle_id IS NOT NULL').get()).toEqual({ n: 401 })
      expect(db.prepare('SELECT incomplete FROM sync_status').get()).toEqual({ incomplete: 0 })
    } finally { db.close() }
  })

  it('refuses the real default path even when the file does not exist', () => {
    const dir = tempDir()
    expect(() => runSeed(dir, 'data/whoop.db')).toThrow()
    expect(fs.existsSync(path.join(dir, 'data', 'whoop.db'))).toBe(false)
  })

  it('refuses a directory symlink pointing at the real default path', () => {
    const dir = tempDir()
    fs.mkdirSync(path.join(dir, 'data'))
    fs.symlinkSync(path.join(dir, 'data'), path.join(dir, 'alias'))
    expect(() => runSeed(dir, 'alias/whoop.db')).toThrow()
    expect(fs.existsSync(path.join(dir, 'data', 'whoop.db'))).toBe(false)
  })

  it('refuses an existing custom database without modifying its data', () => {
    const dir = tempDir()
    const file = path.join(dir, 'existing.db')
    const db = new Database(file)
    db.exec('CREATE TABLE preserved (value TEXT NOT NULL)')
    db.prepare('INSERT INTO preserved VALUES (?)').run('keep this account history')
    db.close()
    const before = fs.readFileSync(file)
    expect(() => runSeed(dir, file)).toThrow()
    expect(fs.readFileSync(file)).toEqual(before)
  })

  it('supports a new custom demo path without touching the default database', () => {
    const dir = tempDir()
    const custom = path.join(dir, 'preview', 'demo.db')
    expect(runSeed(dir, custom)).toContain(custom)
    expect(fs.existsSync(custom)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'data', 'whoop.db'))).toBe(false)
  })
})
