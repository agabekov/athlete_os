import { NextResponse, type NextRequest } from 'next/server'

// This app has no user system of its own; treat reachability as authorization.
// Loopback is always allowed for local use. Public self-hosts must opt in with
// WHOOP_ALLOWED_HOSTS=whoop.example.com,www.whoop.example.com.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function normalizeHostname(host: string): string {
  const trimmed = host.trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).hostname.toLowerCase()
    } catch {
      return ''
    }
  }
  if (trimmed.startsWith('[')) return trimmed.replace(/:\d+$/, '')
  return trimmed.replace(/:\d+$/, '')
}

function configuredHosts(): Set<string> {
  const values = (process.env.WHOOP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(normalizeHostname)
    .filter(Boolean)
  return new Set(values)
}

export function isAllowedHost(hostHeader: string): boolean {
  const hostname = normalizeHostname(hostHeader)
  return LOOPBACK_HOSTNAMES.has(hostname) || configuredHosts().has(hostname)
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  if (!isAllowedHost(host)) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  return NextResponse.next()
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' }
