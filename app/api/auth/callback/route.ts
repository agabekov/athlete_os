import { type NextRequest, NextResponse } from 'next/server'
import { getDb, saveTokens } from '@/lib/db'
import { exchangeCode } from '@/lib/whoop'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expected = req.cookies.get('whoop_oauth_state')?.value
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL('/?error=oauth_state', req.url))
  }
  try {
    const tokens = await exchangeCode(code)
    saveTokens(getDb(), tokens)
  } catch (e) {
    console.error('WHOOP token exchange failed:', e)
    return NextResponse.redirect(new URL('/?error=token_exchange', req.url))
  }
  const res = NextResponse.redirect(new URL('/', req.url))
  res.cookies.delete('whoop_oauth_state')
  return res
}
