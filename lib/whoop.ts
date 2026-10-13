import path from 'node:path'
import { type DB, getTokens, type TokenRow } from './db'
import { parseWhoopResponse, WhoopValidationError, type CollectionPath, type WhoopCollectionMap, type WhoopProfile, type WhoopResponseMap } from './whoop-types'

export const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth'
export const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
export const API_BASE = 'https://api.prod.whoop.com/developer/v2'
export const SCOPES = 'read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout offline'
export const DEFAULT_REDIRECT_URI = 'http://localhost:3000/api/auth/callback'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_BUDGET_MS = 15 * 60_000
const MAX_ATTEMPTS = 6

export function redirectUri(): string { return process.env.WHOOP_REDIRECT_URI ?? DEFAULT_REDIRECT_URI }
export function buildAuthUrl(state: string): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', process.env.WHOOP_CLIENT_ID ?? '')
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  return url.toString()
}

export class WhoopApiError extends Error {
  constructor(public status: number | null, public code: 'timeout' | 'budget_exceeded' | 'network_error' | 'http_error' | 'unauthorized' | 'retry_exhausted' | 'invalid_response' | 'invalid_pagination') {
    super(`WHOOP request failed (${code}${status === null ? '' : `, HTTP ${status}`}).`)
    this.name = 'WhoopApiError'
  }
}
const oauthCodes = new Set(['invalid_grant', 'invalid_client', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'server_error', 'temporarily_unavailable'])
export class TokenEndpointError extends Error {
  constructor(public status: number, public code = 'token_endpoint_error') {
    // Error descriptions and raw bodies can contain credentials or user data.
    const safeCode = oauthCodes.has(code) ? code : 'token_endpoint_error'
    super(`WHOOP token exchange failed (${safeCode}, HTTP ${status}).`)
    this.code = safeCode
    this.name = 'TokenEndpointError'
  }
}
export class NotConnectedError extends Error {
  constructor() { super('No WHOOP tokens stored — connect your account first.'); this.name = 'NotConnectedError' }
}

async function bounded<T>(work: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  if (timeoutMs <= 0) throw new WhoopApiError(null, 'budget_exceeded')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(new WhoopApiError(null, 'timeout')) }, timeoutMs)
  })
  try { return await Promise.race([work, timeout]) }
  finally { clearTimeout(timer) }
}

async function request(url: string, init: RequestInit, timeoutMs: number, readErrorBody = false): Promise<{ response: Response; data: unknown }> {
  const controller = new AbortController()
  try {
    return await bounded((async () => {
      const response = await fetch(url, { ...init, signal: controller.signal })
      let data: unknown = undefined
      if (response.ok || readErrorBody) {
        try { data = await response.json() }
        catch (error) {
          if (response.ok) {
            if (error instanceof SyntaxError) throw new WhoopApiError(response.status, 'invalid_response')
            throw error
          }
        }
      } else {
        // Release the response stream before retrying, without exposing its body.
        await response.body?.cancel()
      }
      return { response, data }
    })(), timeoutMs, () => controller.abort())
  } catch (error) {
    if (error instanceof WhoopApiError) throw error
    throw new WhoopApiError(null, 'network_error')
  }
}

async function requestTokens(body: Record<string, string>, fallbackRefreshToken?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TokenRow> {
  const { response, data } = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: process.env.WHOOP_CLIENT_ID ?? '', client_secret: process.env.WHOOP_CLIENT_SECRET ?? '' }),
  }, timeoutMs, true)
  if (!response.ok) {
    const code = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : undefined
    throw new TokenEndpointError(response.status, code)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WhoopApiError(response.status, 'invalid_response')
  const t = data as Record<string, unknown>
  const refreshToken = t.refresh_token === undefined ? fallbackRefreshToken : t.refresh_token
  if (typeof t.access_token !== 'string' || t.access_token.length === 0 || typeof refreshToken !== 'string' || refreshToken.length === 0 || typeof t.expires_in !== 'number' || !Number.isFinite(t.expires_in) || t.expires_in <= 0 || !Number.isSafeInteger(Date.now() + t.expires_in * 1000)) {
    throw new WhoopApiError(response.status, 'invalid_response')
  }
  return { access_token: t.access_token, refresh_token: refreshToken, expires_at: Date.now() + t.expires_in * 1000 }
}
export function exchangeCode(code: string): Promise<TokenRow> {
  return requestTokens({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() })
}
export function refreshTokens(refreshToken: string): Promise<TokenRow> {
  return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'offline' }, refreshToken)
}
export async function getProfileForTokens(tokens: TokenRow): Promise<WhoopProfile> {
  const { response, data } = await request(`${API_BASE}/user/profile/basic`, { headers: { Authorization: `Bearer ${tokens.access_token}` } }, DEFAULT_TIMEOUT_MS)
  if (!response.ok) throw new WhoopApiError(response.status, 'http_error')
  try { return parseWhoopResponse('/user/profile/basic', data) }
  catch (error) { if (error instanceof WhoopValidationError) throw new WhoopApiError(response.status, 'invalid_response'); throw error }
}

// Same-file DB handles share refresh work; in-memory DBs must remain independent.
const memoryRefreshes = new WeakMap<DB, Promise<TokenRow>>()
const fileRefreshes = new Map<string, Promise<TokenRow>>()
interface RefreshRegistry {
  get(): Promise<TokenRow> | undefined
  set(promise: Promise<TokenRow>): void
  clear(promise: Promise<TokenRow>): void
}
function registryEntry<K>(registry: {
  get(key: K): Promise<TokenRow> | undefined
  set(key: K, value: Promise<TokenRow>): unknown
  delete(key: K): boolean
}, key: K): RefreshRegistry {
  return {
    get: () => registry.get(key),
    set: (promise) => { registry.set(key, promise) },
    clear: (promise) => { if (registry.get(key) === promise) registry.delete(key) },
  }
}
function refreshRegistry(db: DB): RefreshRegistry {
  return db.name === ':memory:' ? registryEntry(memoryRefreshes, db) : registryEntry(fileRefreshes, path.resolve(db.name))
}
function replaceCurrentTokens(db: DB, previous: TokenRow, fresh: TokenRow): boolean {
  return db.prepare(`UPDATE tokens SET access_token=@new_access, refresh_token=@new_refresh, expires_at=@new_expiry
    WHERE id=1 AND access_token=@access_token AND refresh_token=@refresh_token AND expires_at=@expires_at`)
    .run({ ...previous, new_access: fresh.access_token, new_refresh: fresh.refresh_token, new_expiry: fresh.expires_at }).changes === 1
}
function clearCurrentTokens(db: DB, previous: TokenRow): boolean {
  return db.prepare('DELETE FROM tokens WHERE id=1 AND access_token=@access_token AND refresh_token=@refresh_token AND expires_at=@expires_at').run(previous).changes === 1
}
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
export interface WhoopApi {
  get<P extends keyof WhoopResponseMap>(path: P, params?: Record<string, string>): Promise<WhoopResponseMap[P]>
  paginate<P extends CollectionPath>(path: P, params?: Record<string, string>): AsyncGenerator<WhoopCollectionMap[P][]>
}
export interface WhoopClientOptions { requestTimeoutMs?: number; budgetMs?: number }
export class WhoopClient implements WhoopApi {
  private deadline: number
  private timeoutMs: number
  constructor(private db: DB, private sleep: (ms: number) => Promise<void> = defaultSleep, options: WhoopClientOptions = {}) {
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
    const budget = options.budgetMs ?? DEFAULT_BUDGET_MS
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || !Number.isFinite(budget) || budget <= 0) throw new Error('WHOOP time limits must be positive finite numbers.')
    this.deadline = Date.now() + budget
  }
  private remaining(): number {
    const ms = this.deadline - Date.now()
    if (ms <= 0) throw new WhoopApiError(null, 'budget_exceeded')
    return ms
  }
  private async wait(ms: number): Promise<void> {
    const remaining = this.remaining()
    if (ms >= remaining) throw new WhoopApiError(null, 'budget_exceeded')
    await bounded(this.sleep(ms), remaining)
  }
  private async accessToken(rejectedToken?: string): Promise<string> {
    const row = getTokens(this.db)
    if (!row) throw new NotConnectedError()
    if (row.expires_at >= Date.now() + 60_000 && row.access_token !== rejectedToken) return row.access_token
    const registry = refreshRegistry(this.db)
    let refreshing = registry.get()
    if (!refreshing) {
      refreshing = (async () => {
        let fresh: TokenRow
        try {
          // A refresh can rotate credentials before a network failure. Never
          // blindly retry this POST, unlike idempotent resource GET requests.
          fresh = await requestTokens({ grant_type: 'refresh_token', refresh_token: row.refresh_token, scope: 'offline' }, row.refresh_token, Math.min(this.timeoutMs, this.remaining()))
        } catch (error) {
          const current = getTokens(this.db)
          if (current && (current.access_token !== row.access_token || current.refresh_token !== row.refresh_token || current.expires_at !== row.expires_at)) return current
          if (error instanceof TokenEndpointError && error.code === 'invalid_grant' && (error.status === 400 || error.status === 401) && clearCurrentTokens(this.db, row)) throw new NotConnectedError()
          throw error
        }
        if (replaceCurrentTokens(this.db, row, fresh)) return fresh
        const current = getTokens(this.db)
        if (!current) throw new NotConnectedError()
        return current
      })()
      registry.set(refreshing)
      const pending = refreshing
      // Attach both branches so cleanup itself never produces an unhandled rejection.
      void pending.then(() => registry.clear(pending), () => registry.clear(pending))
    }
    return (await bounded(refreshing, this.remaining())).access_token
  }
  async get<P extends keyof WhoopResponseMap>(path: P, params: Record<string, string> = {}): Promise<WhoopResponseMap[P]> {
    let rejectedToken: string | undefined
    let lastStatus: number | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const token = await this.accessToken(rejectedToken)
      const url = new URL(API_BASE + path)
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
      let result: { response: Response; data: unknown }
      try {
        result = await request(url.toString(), { headers: { Authorization: `Bearer ${token}` } }, Math.min(this.timeoutMs, this.remaining()))
      } catch (error) {
        if (!(error instanceof WhoopApiError) || !['timeout', 'network_error'].includes(error.code) || attempt === MAX_ATTEMPTS - 1) throw error
        await this.wait(Math.min(1000 * 2 ** attempt, 30_000))
        continue
      }
      const { response, data } = result
      lastStatus = response.status
      if (response.status === 401) {
        if (rejectedToken !== undefined) throw new WhoopApiError(401, 'unauthorized')
        rejectedToken = token
        continue
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === MAX_ATTEMPTS - 1) break
        let delay = Math.min(1000 * 2 ** attempt, 30_000)
        if (response.status === 429) {
          const reset = Number(response.headers.get('x-ratelimit-reset'))
          const retry = response.headers.get('retry-after')
          const seconds = retry === null ? 0 : Number(retry)
          const retryDate = retry === null || Number.isFinite(seconds) ? 0 : Date.parse(retry) - Date.now()
          delay = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : retryDate > 0 ? retryDate : 60_000
        }
        await this.wait(delay)
        continue
      }
      if (!response.ok) throw new WhoopApiError(response.status, 'http_error')
      try { return parseWhoopResponse(path, data) }
      catch (error) { if (error instanceof WhoopValidationError) throw new WhoopApiError(response.status, 'invalid_response'); throw error }
    }
    throw new WhoopApiError(lastStatus, 'retry_exhausted')
  }
  async *paginate<P extends CollectionPath>(path: P, params: Record<string, string> = {}): AsyncGenerator<WhoopCollectionMap[P][]> {
    let nextToken: string | undefined
    const seen = new Set<string>()
    do {
      const page = await this.get(path, { ...params, limit: '25', ...(nextToken ? { nextToken } : {}) })
      // TS cannot express this mapping over a generic key; get validates each
      // page with the parser associated with precisely the same path.
      yield page.records as WhoopCollectionMap[P][]
      nextToken = page.next_token ?? undefined
      if (nextToken && seen.has(nextToken)) throw new WhoopApiError(null, 'invalid_pagination')
      if (nextToken) seen.add(nextToken)
    } while (nextToken)
  }
}
