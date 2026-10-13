import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../server/app'
import { createDb, saveProfile, saveTokens, getTokens, getProfile } from '../lib/db'
import type { WhoopApi } from '../lib/whoop'
import { TokenEndpointError } from '../lib/whoop'
import { SyncJob, publicError } from '../server/sync-job'

afterEach(() => vi.unstubAllEnvs())
function credentials() {
  vi.stubEnv('WHOOP_CLIENT_ID', 'test-id')
  vi.stubEnv('WHOOP_CLIENT_SECRET', 'test-secret')
  vi.stubEnv('WHOOP_REDIRECT_URI', 'http://localhost:3000/api/auth/callback')
}
const token = { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_at: Date.now() + 3600000 }
const headers = { host: 'localhost:3000' }

describe('Hono HTTP boundaries', () => {
  it('handles an API factory failure without leaving an orphaned running job', async () => {
    const job = new SyncJob(createDb(':memory:'), () => { throw new Error('private') })
    expect(job.start().state).toBe('running')
    await job.settled()
    expect(job.getStatus()).toMatchObject({ state: 'failed', errorCode: 'sync_failed' })
  })

  it('preserves safe OAuth configuration error classification', () => {
    expect(publicError(new TokenEndpointError(401, 'invalid_client'))).toMatchObject({ errorCode: 'invalid_client' })
  })
  it('blocks unconfigured hosts before accessing the database', async () => {
    vi.stubEnv('WHOOP_ALLOWED_HOSTS', '')
    const app = createApp({ db: createDb(':memory:') })
    const response = await app.request('http://unconfigured.test/api/dashboard', { headers: { host: 'unconfigured.test' } })
    expect(response.status).toBe(403)
  })

  it('returns setup and disconnected states without exposing credentials or tokens', async () => {
    const db = createDb(':memory:')
    const app = createApp({ db })
    vi.stubEnv('WHOOP_CLIENT_ID', '')
    vi.stubEnv('WHOOP_CLIENT_SECRET', '')
    const setup = await app.request('/api/dashboard', { headers })
    expect((await setup.json()).state).toBe('setup')
    expect(setup.headers.get('cache-control')).toBe('no-store')
    credentials()
    const disconnected = await app.request('/api/dashboard', { headers })
    expect(await disconnected.json()).toEqual({ state: 'disconnected' })
    saveTokens(db, token)
    const connected = await app.request('/api/dashboard', { headers })
    expect(await connected.json()).toEqual({ state: 'empty' })
  })

  it('rejects cross-origin mutation even for an allowed Host', async () => {
    credentials()
    const db = createDb(':memory:')
    saveTokens(db, token)
    const app = createApp({ db })
    const response = await app.request('/api/sync', { method: 'POST', headers: { ...headers, origin: 'https://other.test' } })
    expect(response.status).toBe(403)
  })

  it('returns promptly and coalesces concurrent background sync requests', async () => {
    credentials()
    const db = createDb(':memory:')
    saveTokens(db, token)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const get = vi.fn(async (path: string) => {
      if (path.includes('profile')) { await gate; return { user_id: 1 } }
      return { height_meter: 1.8, weight_kilogram: 75, max_heart_rate: 190 }
    }) as unknown as WhoopApi['get']
    const api: WhoopApi = { get, async *paginate() { yield [] } }
    const app = createApp({ db, api: () => api })
    for (let i = 0; i < 2; i++) {
      const response = await app.request('/api/sync', { method: 'POST', headers })
      expect(response.status).toBe(202)
      expect(await response.json()).toEqual({ state: 'running' })
    }
    expect(get).toHaveBeenCalledTimes(1)
    release()
    await vi.waitFor(async () => {
      const status = await app.request('/api/sync', { headers })
      expect((await status.json()).state).toBe('succeeded')
    })
  })

  it('checks OAuth state before exchanging a code and uses Secure cookies on HTTPS', async () => {
    credentials()
    vi.stubEnv('WHOOP_REDIRECT_URI', 'https://whoop.example.com/api/auth/callback')
    const exchange = vi.fn()
    const app = createApp({ db: createDb(':memory:'), exchange })
    const login = await app.request('/api/auth/login', { headers })
    expect(login.headers.get('set-cookie')).toContain('HttpOnly')
    expect(login.headers.get('set-cookie')).toContain('Secure')
    const bad = await app.request('/api/auth/callback?code=fake&state=wrong', { headers })
    expect(bad.headers.get('location')).toBe('/?error=oauth_state')
    expect(exchange).not.toHaveBeenCalled()
  })

  it('rejects another account before replacing tokens or the previous profile', async () => {
    credentials()
    const db = createDb(':memory:')
    saveProfile(db, { user_id: 1, first_name: 'Original' })
    const app = createApp({ db, exchange: async () => token, profileForTokens: async () => ({ user_id: 2 }) })
    const response = await app.request('/api/auth/callback?code=fake&state=valid', {
      headers: { ...headers, cookie: 'whoop_oauth_state=valid' },
    })
    expect(response.headers.get('location')).toBe('/?error=account_mismatch')
    expect(getTokens(db)).toBeNull()
    expect(getProfile(db)?.first_name).toBe('Original')
  })

  it('does not expose raw errors in failed sync status', async () => {
    credentials()
    const db = createDb(':memory:')
    saveTokens(db, token)
    const api: WhoopApi = {
      get: async () => { throw new Error('private-response-body') },
      async *paginate() { yield [] },
    }
    const app = createApp({ db, api: () => api })
    await app.request('/api/sync', { method: 'POST', headers })
    await vi.waitFor(async () => {
      const response = await app.request('/api/sync', { headers })
      const body = await response.text()
      expect(body).toContain('failed')
      expect(body).not.toContain('private-response-body')
    })
  })
})
