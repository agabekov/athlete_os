import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { serveStatic } from '@hono/node-server/serve-static'
import { type DB, getDb, getTokens, saveTokens, assertAccountOwner } from '../lib/db'
import { buildAuthUrl, exchangeCode, getProfileForTokens, redirectUri, WhoopClient, type WhoopApi } from '../lib/whoop'
import { isAllowedHost } from '../middleware'
import { dashboard } from './dashboard'
import { SyncJob, publicError } from './sync-job'

interface AppOptions {
  db?: DB
  api?: () => WhoopApi
  exchange?: typeof exchangeCode
  profileForTokens?: typeof getProfileForTokens
  staticRoot?: string
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono()
  // Lazy DB access keeps startup/setup independent of disk and credentials.
  const database = () => options.db ?? getDb()
  let job: SyncJob | undefined
  const syncJob = () => job ??= new SyncJob(database(), options.api ?? (() => new WhoopClient(database())))

  app.use('*', async (c, next) => {
    if (!isAllowedHost(c.req.header('host') ?? '')) return c.text('Forbidden', 403)
    await next()
  })
  app.use('*', secureHeaders())
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.onError(() => new Response(JSON.stringify({ error: 'Request failed. Please retry.' }), {
    status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  }))

  app.get('/api/dashboard', (c) => c.json(dashboard(database())))
  app.get('/api/sync', (c) => c.json(syncJob().getStatus()))
  app.post('/api/sync', (c) => {
    // Public deployments use the configured external origin, never arbitrary forwarded headers.
    const origin = c.req.header('origin')
    const expected = new URL(redirectUri()).origin
    if (c.req.header('sec-fetch-site') === 'cross-site' || (origin && origin !== expected && origin !== new URL(c.req.url).origin)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (!getTokens(database())) return c.json({ error: 'Reconnect your WHOOP account.', errorCode: 'not_connected' }, 401)
    return c.json(syncJob().start(), 202)
  })

  app.get('/api/auth/login', (c) => {
    if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) return c.redirect('/setup')
    if (getTokens(database())) return c.redirect('/')
    const state = crypto.randomBytes(32).toString('hex')
    setCookie(c, 'whoop_oauth_state', state, {
      httpOnly: true, sameSite: 'Lax', secure: redirectUri().startsWith('https:'), maxAge: 600, path: '/',
    })
    return c.redirect(buildAuthUrl(state))
  })
  app.get('/api/auth/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    const expected = getCookie(c, 'whoop_oauth_state')
    deleteCookie(c, 'whoop_oauth_state', { path: '/' })
    if (!code || !state || !expected || state !== expected) return c.redirect('/?error=oauth_state')
    try {
      const tokens = await (options.exchange ?? exchangeCode)(code)
      const profile = await (options.profileForTokens ?? getProfileForTokens)(tokens)
      assertAccountOwner(database(), profile.user_id)
      saveTokens(database(), tokens)
      return c.redirect('/')
    } catch (error) {
      return c.redirect('/?error=' + (publicError(error).errorCode === 'account_mismatch' ? 'account_mismatch' : 'token_exchange'))
    }
  })

  const root = options.staticRoot ?? fileURLToPath(new URL('../client', import.meta.url))
  app.get('/assets/*', serveStatic({ root, onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }))
  for (const path of ['/', '/setup']) {
    app.get(path, serveStatic({ path: `${root}/index.html`, onFound: (_path, c) => c.header('Cache-Control', 'no-cache') }))
  }
  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  return app
}
