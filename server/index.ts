import { createServer } from 'node:http'
import { loadEnvFile } from 'node:process'
import { existsSync } from 'node:fs'
import { getRequestListener } from '@hono/node-server'
import { createApp } from './app'
import { isAllowedHost } from '../middleware'

// Production gets its environment from the process/container; local files are development-only.
const production = import.meta.url.includes('/dist/server/')
if (!production) {
  for (const path of ['.env.local', '.env']) if (existsSync(path)) loadEnvFile(path)
}
const port = Number(process.env.PORT ?? 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535')
const hostname = process.env.HOST ?? '127.0.0.1'
const app = createApp()
const apiListener = getRequestListener(app.fetch)
const vite = production ? undefined : await (await import('vite')).createServer({ server: { middlewareMode: true }, appType: 'spa' })
const server = createServer((req, res) => {
  if (!isAllowedHost(req.headers.host ?? '')) { res.writeHead(403); res.end('Forbidden'); return }
  if (vite && !req.url?.startsWith('/api/')) {
    vite.middlewares(req, res, () => { res.writeHead(404); res.end('Not found') })
  } else {
    void apiListener(req, res)
  }
})
server.listen(port, hostname, () => console.log(`Athlete OS listening on http://${hostname}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => { void vite?.close().then(() => process.exit(0)); if (!vite) process.exit(0) })
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
