import { type DB, clearTokens, getTokens, saveTokens, type TokenRow } from './db'

export const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth'
export const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
export const API_BASE = 'https://api.prod.whoop.com/developer/v2'
export const SCOPES =
  'read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout offline'
export const DEFAULT_REDIRECT_URI = 'http://localhost:3000/api/auth/callback'

export function redirectUri(): string {
  return process.env.WHOOP_REDIRECT_URI ?? DEFAULT_REDIRECT_URI
}

export function buildAuthUrl(state: string): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', process.env.WHOOP_CLIENT_ID ?? '')
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  return url.toString()
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

export class TokenEndpointError extends Error {
  constructor(public status: number, body: string) {
    super(`WHOOP token endpoint ${status}: ${body}`)
  }
}

async function requestTokens(body: Record<string, string>, fallbackRefreshToken?: string): Promise<TokenRow> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...body,
      client_id: process.env.WHOOP_CLIENT_ID ?? '',
      client_secret: process.env.WHOOP_CLIENT_SECRET ?? '',
    }),
  })
  if (!res.ok) throw new TokenEndpointError(res.status, await res.text())
  const t = (await res.json()) as TokenResponse
  const refreshToken = t.refresh_token ?? fallbackRefreshToken
  if (!refreshToken) throw new Error('WHOOP token endpoint did not return a refresh token')
  return {
    access_token: t.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + t.expires_in * 1000,
  }
}

export function exchangeCode(code: string): Promise<TokenRow> {
  return requestTokens({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() })
}

export function refreshTokens(refreshToken: string): Promise<TokenRow> {
  return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'offline' }, refreshToken)
}

export class NotConnectedError extends Error {
  constructor() { super('No WHOOP tokens stored — connect your account first.') }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface WhoopApi {
  get(path: string, params?: Record<string, string>): Promise<any>
  paginate(path: string, params?: Record<string, string>): AsyncGenerator<any[]>
}

export class WhoopClient implements WhoopApi {
  private forceRefresh = false

  constructor(private db: DB, private sleep: (ms: number) => Promise<void> = defaultSleep) {}

  private async accessToken(): Promise<string> {
    const row = getTokens(this.db)
    if (!row) throw new NotConnectedError()
    if (this.forceRefresh || row.expires_at < Date.now() + 60_000) {
      let fresh: TokenRow
      try {
        fresh = await refreshTokens(row.refresh_token)
      } catch (e) {
        // 400/401 = refresh token revoked or rotated away — only re-auth can recover.
        // Transient 5xx/network errors must NOT clear tokens.
        if (e instanceof TokenEndpointError && (e.status === 400 || e.status === 401)) {
          clearTokens(this.db)
          throw new NotConnectedError()
        }
        throw e
      }
      saveTokens(this.db, fresh) // refresh tokens rotate — persist immediately
      this.forceRefresh = false
      return fresh.access_token
    }
    return row.access_token
  }

  async get(path: string, params: Record<string, string> = {}): Promise<any> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const token = await this.accessToken()
      const url = new URL(API_BASE + path)
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 429) {
        // WHOOP documents X-RateLimit-Reset (seconds until the window resets)
        const reset = Number(res.headers.get('x-ratelimit-reset') ?? res.headers.get('retry-after'))
        await this.sleep((Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000)
        continue
      }
      if (res.status === 401) {
        this.forceRefresh = true
        continue
      }
      if (!res.ok) throw new Error(`WHOOP API ${res.status} on ${path}: ${await res.text()}`)
      return res.json()
    }
    throw new Error(`WHOOP API: too many retries on ${path}`)
  }

  async *paginate(path: string, params: Record<string, string> = {}): AsyncGenerator<any[]> {
    let nextToken: string | undefined
    do {
      const page = await this.get(path, {
        ...params,
        limit: '25',
        ...(nextToken ? { nextToken } : {}),
      })
      yield page.records ?? []
      nextToken = page.next_token ?? undefined
    } while (nextToken)
  }
}
