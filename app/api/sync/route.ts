import { NextResponse } from 'next/server'
import { getDb, getTokens } from '@/lib/db'
import { NotConnectedError, WhoopClient } from '@/lib/whoop'
import { runSync } from '@/lib/sync'

export async function POST() {
  const db = getDb()
  if (!getTokens(db)) return NextResponse.json({ error: 'not_connected' }, { status: 401 })
  try {
    const result = await runSync(db, new WhoopClient(db))
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ error: 'not_connected' }, { status: 401 })
    console.error('Sync failed:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'sync_failed' }, { status: 500 })
  }
}
