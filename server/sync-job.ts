import type { DB } from '../lib/db'
import { AccountMismatchError } from '../lib/db'
import { runSync } from '../lib/sync'
import { NotConnectedError, WhoopApiError, TokenEndpointError, type WhoopApi } from '../lib/whoop'
import type { SyncStatus } from '../lib/dashboard-types'

export function publicError(error: unknown): { error: string; errorCode: string } {
  if (error instanceof NotConnectedError) return { errorCode: 'not_connected', error: 'Reconnect your WHOOP account.' }
  if (error instanceof AccountMismatchError) return { errorCode: 'account_mismatch', error: 'This database belongs to another WHOOP account. Use a separate database to connect this account.' }
  if (error instanceof WhoopApiError) return { errorCode: error.code, error: error.message }
  if (error instanceof TokenEndpointError) return { errorCode: error.code, error: error.message }
  return { errorCode: 'sync_failed', error: 'Sync failed. Retry; your saved history is safe.' }
}

export class SyncJob {
  private status: SyncStatus = { state: 'idle' }
  private pending?: Promise<void>

  constructor(private db: DB, private api: () => WhoopApi) {}

  getStatus(): SyncStatus { return { ...this.status } }

  start(): SyncStatus {
    if (this.pending) return this.getStatus()
    this.status = { state: 'running' }
    this.pending = Promise.resolve().then(() => runSync(this.db, this.api())).then(
      () => { this.status = { state: 'succeeded' } },
      (error: unknown) => { this.status = { state: 'failed', ...publicError(error) } },
    ).finally(() => { this.pending = undefined })
    return this.getStatus()
  }

  async settled(): Promise<void> { await this.pending }
}
