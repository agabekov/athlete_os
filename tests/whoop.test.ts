import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDb, saveTokens, getTokens } from '../lib/db'
import { buildAuthUrl, WhoopClient, NotConnectedError, API_BASE, exchangeCode, getProfileForTokens, TokenEndpointError, WhoopApiError } from '../lib/whoop'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const cycle = (id: number) => ({ id, start: '2026-06-01T12:00:00Z', timezone_offset: '+00:00', score_state: 'SCORED', score: { strain: 10, kilojoule: 5000, average_heart_rate: 65, max_heart_rate: 120 } })

describe('buildAuthUrl', () => {
  it('contains client_id, redirect_uri, scopes, state', () => {
    process.env.WHOOP_CLIENT_ID = 'cid'
    process.env.WHOOP_REDIRECT_URI = 'http://localhost:3000/api/auth/callback'
    const url = new URL(buildAuthUrl('mystate123'))
    expect(url.origin + url.pathname).toBe('https://api.prod.whoop.com/oauth/oauth2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('mystate123')
    expect(url.searchParams.get('scope')).toContain('offline')
    expect(url.searchParams.get('scope')).toContain('read:recovery')
  })
})

describe('WhoopClient', () => {
  function freshDbWithTokens(expiresInMs = 3600_000) {
    const db = createDb(':memory:')
    saveTokens(db, { access_token: 'tok', refresh_token: 'ref', expires_at: Date.now() + expiresInMs })
    return db
  }

  it('GETs with bearer token', async () => {
    const db = freshDbWithTokens()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user_id: 1, email: 'test@example.com', first_name: 'Test', last_name: 'User' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async () => {})
    const out = await client.get('/user/profile/basic')
    expect(out.user_id).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${API_BASE}/user/profile/basic`)
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('refreshes when token is expired and persists rotated tokens', async () => {
    process.env.WHOOP_CLIENT_ID = 'cid'
    process.env.WHOOP_CLIENT_SECRET = 'sec'
    const db = freshDbWithTokens(-1000) // already expired
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new', refresh_token: 'newref', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async () => {})
    await client.get('/cycle')
    expect(getTokens(db)!.access_token).toBe('new')
    expect(getTokens(db)!.refresh_token).toBe('newref')
    const tokenCall = fetchMock.mock.calls[0]
    expect(String(tokenCall[0])).toBe('https://api.prod.whoop.com/oauth/oauth2/token')
    expect(String(tokenCall[1].body)).toContain('grant_type=refresh_token')
    expect(String(tokenCall[1].body)).toContain('scope=offline')
  })

  it('keeps the current refresh token when refresh does not rotate it', async () => {
    process.env.WHOOP_CLIENT_ID = 'cid'
    process.env.WHOOP_CLIENT_SECRET = 'sec'
    const db = freshDbWithTokens(-1000)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async () => {})
    await client.get('/cycle')
    expect(getTokens(db)).toMatchObject({ access_token: 'new', refresh_token: 'ref' })
  })

  it('waits for X-RateLimit-Reset and retries on 429', async () => {
    const db = freshDbWithTokens()
    const waits: number[] = []
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429, { 'x-ratelimit-reset': '7' }))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async (ms) => { waits.push(ms) })
    const out = await client.get('/recovery')
    expect(out.records).toEqual([])
    expect(waits).toEqual([7000])
  })

  it('falls back to Retry-After, then 60s, on 429', async () => {
    const db = freshDbWithTokens()
    const waits: number[] = []
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async (ms) => { waits.push(ms) })
    await client.get('/recovery')
    expect(waits).toEqual([3000, 60000])
  })

  it('clears tokens and throws NotConnectedError when the refresh token is rejected', async () => {
    process.env.WHOOP_CLIENT_ID = 'cid'
    process.env.WHOOP_CLIENT_SECRET = 'sec'
    const db = freshDbWithTokens(-1000) // expired → must refresh
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async () => {})
    await expect(client.get('/cycle')).rejects.toThrow(NotConnectedError)
    expect(getTokens(db)).toBeNull() // dead tokens removed → UI shows Connect screen
  })

  it('keeps tokens when refresh fails transiently (5xx)', async () => {
    process.env.WHOOP_CLIENT_ID = 'cid'
    process.env.WHOOP_CLIENT_SECRET = 'sec'
    const db = freshDbWithTokens(-1000)
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('oops', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async () => {})
    await expect(client.get('/cycle')).rejects.toThrow(/503/)
    expect(getTokens(db)).not.toBeNull()
  })

  it('paginates until next_token is absent', async () => {
    const db = freshDbWithTokens()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ records: [cycle(1)], next_token: 'abc' }))
      .mockResolvedValueOnce(jsonResponse({ records: [cycle(2)] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async () => {})
    const pages: unknown[][] = []
    for await (const page of client.paginate('/cycle', { start: '2020-01-01T00:00:00.000Z' })) pages.push(page)
    expect(pages).toEqual([[cycle(1)], [cycle(2)]])
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]))
    expect(secondUrl.searchParams.get('nextToken')).toBe('abc')
    expect(secondUrl.searchParams.get('limit')).toBe('25')
  })
})

function connectedDb(expired = false) {
  const db = createDb(':memory:')
  saveTokens(db, { access_token: 'old', refresh_token: 'old-refresh', expires_at: Date.now() + (expired ? -1000 : 3600_000) })
  return db
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('token coordination and safe errors', () => {
  it('shares a single rotating refresh between clients', async () => {
    const db = connectedDb(true)
    const refresh = deferred<Response>()
    const fetchMock = vi.fn((url: string) => String(url).includes('/oauth2/token') ? refresh.promise : Promise.resolve(jsonResponse({ records: [] })))
    vi.stubGlobal('fetch', fetchMock)
    const first = new WhoopClient(db).get('/cycle')
    const second = new WhoopClient(db).get('/recovery')
    refresh.resolve(jsonResponse({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }))
    await Promise.all([first, second])
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth2/token'))).toHaveLength(1)
    expect(getTokens(db)?.refresh_token).toBe('rotated')
  })

  it('coordinates different handles to the same SQLite file', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'athlete-token-test-'))
    const firstDb = createDb(path.join(directory, 'test.db'))
    const secondDb = createDb(path.join(directory, 'test.db'))
    try {
      saveTokens(firstDb, { access_token: 'old', refresh_token: 'old-refresh', expires_at: Date.now() - 1000 })
      const refresh = deferred<Response>()
      const fetchMock = vi.fn((url: string) => String(url).includes('/oauth2/token') ? refresh.promise : Promise.resolve(jsonResponse({ records: [] })))
      vi.stubGlobal('fetch', fetchMock)
      const first = new WhoopClient(firstDb).get('/cycle')
      const second = new WhoopClient(secondDb).get('/recovery')
      refresh.resolve(jsonResponse({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }))
      await Promise.all([first, second])
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth2/token'))).toHaveLength(1)
      expect(getTokens(secondDb)?.refresh_token).toBe('rotated')
    } finally {
      firstDb.close()
      secondDb.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([true, false])('does not replace or delete tokens saved during refresh (rejected=%s)', async (rejected) => {
    const db = connectedDb(true)
    const refresh = deferred<Response>()
    const fetchMock = vi.fn((url: string) => String(url).includes('/oauth2/token') ? refresh.promise : Promise.resolve(jsonResponse({ records: [] })))
    vi.stubGlobal('fetch', fetchMock)
    const pending = new WhoopClient(db).get('/cycle')
    const latest = { access_token: 'reconnected', refresh_token: 'latest', expires_at: Date.now() + 3600_000 }
    saveTokens(db, latest)
    refresh.resolve(rejected ? jsonResponse({ error: 'invalid_grant' }, 400) : jsonResponse({ access_token: 'obsolete', refresh_token: 'obsolete', expires_in: 3600 }))
    await pending
    expect(getTokens(db)).toEqual(latest)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${API_BASE}/cycle`)
  })

  it('keeps credentials when client configuration is invalid and hides response text', async () => {
    const db = connectedDb(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_client', error_description: 'secret: private-value' }, 401)))
    const error = await new WhoopClient(db).get('/cycle').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TokenEndpointError)
    expect(String(error)).toContain('invalid_client')
    expect(String(error)).not.toContain('private-value')
    expect(getTokens(db)).not.toBeNull()
  })

  it.each([
    { access_token: '', refresh_token: 'ref', expires_in: 3600 },
    { access_token: 'tok', refresh_token: 'ref', expires_in: '3600' },
    { access_token: 'tok', refresh_token: 'ref', expires_in: -1 },
    { access_token: 'tok', refresh_token: null, expires_in: 3600 },
  ])('rejects malformed token response without saving it: %j', async (body) => {
    const db = connectedDb(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)))
    await expect(new WhoopClient(db).get('/cycle')).rejects.toMatchObject({ code: 'invalid_response' })
    expect(getTokens(db)?.access_token).toBe('old')
  })

  it('validates exchanged tokens and profile without persisting unverified credentials', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'candidate', refresh_token: 'candidate-refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ user_id: 22, email: 'test@example.com', first_name: 'New', last_name: 'Owner' })))
    const tokens = await exchangeCode('code')
    expect(await getProfileForTokens(tokens)).toMatchObject({ user_id: 22 })
  })

  it('does not repeatedly rotate credentials after persistent resource 401s', async () => {
    const db = connectedDb()
    const fetchMock = vi.fn((url: string) => Promise.resolve(String(url).includes('/oauth2/token')
      ? jsonResponse({ access_token: 'new', refresh_token: 'new', expires_in: 3600 })
      : jsonResponse({ message: 'private-data' }, 401)))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new WhoopClient(db).get('/cycle')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getTokens(db)?.access_token).toBe('new')
  })
})

describe('bounded resource requests', () => {
  it('retries network and 5xx failures with bounded backoff', async () => {
    const waits: number[] = []
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('private network error'))
      .mockResolvedValueOnce(jsonResponse({ message: 'private-body' }, 503))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await new WhoopClient(connectedDb(), async (ms) => { waits.push(ms) }).get('/cycle')).toEqual({ records: [] })
    expect(waits).toEqual([1000, 2000])
  })

  it('stops after the retry limit and keeps raw server bodies private', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ secret: 'private-body' }, 503)))
    vi.stubGlobal('fetch', fetchMock)
    const error = await new WhoopClient(connectedDb(), async () => {}).get('/cycle').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WhoopApiError)
    expect(error).toMatchObject({ status: 503, code: 'retry_exhausted' })
    expect(String(error)).not.toContain('private-body')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('rejects a rate-limit delay beyond the client lifetime budget', async () => {
    const sleep = vi.fn(async () => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429, { 'retry-after': '5000' })))
    await expect(new WhoopClient(connectedDb(), sleep, { budgetMs: 1000 }).get('/cycle')).rejects.toMatchObject({ code: 'budget_exceeded' })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('applies the same lifetime budget across pagination requests', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ records: [], next_token: 'next' })))
    const iterator = new WhoopClient(connectedDb(), async () => {}, { budgetMs: 50 }).paginate('/cycle')
    expect(await iterator.next()).toMatchObject({ done: false, value: [] })
    await vi.advanceTimersByTimeAsync(60)
    await expect(iterator.next()).rejects.toMatchObject({ code: 'budget_exceeded' })
  })

  it('aborts a hanging request, retries and eventually reports timeout', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = new WhoopClient(connectedDb(), async () => {}, { requestTimeoutMs: 20 }).get('/cycle').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(200)
    expect(await result).toMatchObject({ code: 'timeout' })
    expect(signals).toHaveLength(6)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('also times out a stalled JSON response body', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve({
      ok: true, status: 200, json: () => new Promise<unknown>(() => {}),
    })))
    const result = new WhoopClient(connectedDb(), async () => {}, { requestTimeoutMs: 20 }).get('/cycle').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(200)
    expect(await result).toMatchObject({ code: 'timeout' })
  })

  it.each([
    { records: {} },
    { records: [{ ...cycle(1), score: null }] },
    { records: [{ ...cycle(1), score: { strain: '10' } }] },
    { records: [{ ...cycle(1), start: 'yesterday' }] },
    { records: [{ ...cycle(1), score_state: 'unknown' }] },
    { records: [], next_token: 123 },
  ])('rejects malformed pages before they reach persistence: %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)))
    await expect(new WhoopClient(connectedDb()).get('/cycle')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('accepts explicitly unscored resources', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ records: [{ id: 1, start: '2026-06-01T12:00:00Z', timezone_offset: '+00:00', score_state: 'PENDING_SCORE', score: null }] })))
    expect((await new WhoopClient(connectedDb()).get('/cycle')).records[0]?.score_state).toBe('PENDING_SCORE')
  })

  it('stops repeated pagination tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ records: [], next_token: 'same' }))))
    await expect((async () => { const pages = new WhoopClient(connectedDb()).paginate('/cycle'); await pages.next(); await pages.next(); await pages.next() })()).rejects.toMatchObject({ code: 'invalid_pagination' })
  })
})
