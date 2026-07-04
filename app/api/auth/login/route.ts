import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getDb, getTokens } from '@/lib/db'
import { buildAuthUrl } from '@/lib/whoop'

export async function GET(req: NextRequest) {
  if (getTokens(getDb())) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  const state = crypto.randomBytes(16).toString('hex')
  const res = NextResponse.redirect(buildAuthUrl(state))
  res.cookies.set('whoop_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
