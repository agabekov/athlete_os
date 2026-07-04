import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDb, saveTokens, getTokens } from '../lib/db'
import { buildAuthUrl, WhoopClient, NotConnectedError, API_BASE } from '../lib/whoop'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

afterEach(() => vi.unstubAllGlobals())

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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user_id: 1 }))
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
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async (ms) => { waits.push(ms) })
    const out = await client.get('/recovery')
    expect(out.ok).toBe(true)
    expect(waits).toEqual([7000])
  })

  it('falls back to Retry-After, then 60s, on 429', async () => {
    const db = freshDbWithTokens()
    const waits: number[] = []
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
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
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: 1 }], next_token: 'abc' }))
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: 2 }] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WhoopClient(db, async () => {})
    const pages: any[][] = []
    for await (const page of client.paginate('/cycle', { start: '2020-01-01T00:00:00.000Z' })) pages.push(page)
    expect(pages).toEqual([[{ id: 1 }], [{ id: 2 }]])
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]))
    expect(secondUrl.searchParams.get('nextToken')).toBe('abc')
    expect(secondUrl.searchParams.get('limit')).toBe('25')
  })
})
