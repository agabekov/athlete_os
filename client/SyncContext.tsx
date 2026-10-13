import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SyncStatus } from '../lib/dashboard-types'

interface SyncControl { busy: boolean; error: string | null; start: () => Promise<void> }
const SyncContext = createContext<SyncControl | null>(null)

async function syncRequest(method: 'GET' | 'POST', signal?: AbortSignal): Promise<SyncStatus> {
  const timeout = AbortSignal.timeout(20_000)
  const response = await fetch('/api/sync', { method, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: 'no-store' })
  const status = await response.json() as SyncStatus
  if (!response.ok) throw new Error(status.error ?? 'Could not start sync. Please retry.')
  return status
}

export function SyncProvider({ onComplete, children }: { onComplete: () => Promise<void>; children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>({ state: 'idle' })
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const abort = new AbortController()
    const current = generation.current
    void syncRequest('GET', abort.signal).then(async next => {
      if (abort.signal.aborted || current !== generation.current) return
      setStatus(next)
      setError(next.state === 'failed' ? next.error ?? 'Sync failed. Please retry.' : null)
      if (next.state === 'succeeded' || next.state === 'failed') await onComplete()
    }).catch(() => {})
    return () => abort.abort()
  }, [onComplete])

  useEffect(() => {
    if (status.state !== 'running') return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await syncRequest('GET', abort.signal)
        if (abort.signal.aborted) return
        setStatus(next)
        if (next.state === 'running') { timer = setTimeout(() => void poll(), 1000); return }
        setError(next.state === 'failed' ? next.error ?? 'Sync failed. Please retry.' : null)
        if (next.state === 'idle') setError('No sync is running. Run sync again to continue.')
        await onComplete()
      } catch {
        if (!abort.signal.aborted) {
          setError('Connection interrupted. Checking sync status…')
          timer = setTimeout(() => void poll(), 3000)
        }
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => { abort.abort(); clearTimeout(timer) }
  }, [status.state, onComplete])

  const start = useCallback(async () => {
    if (starting || status.state === 'running') return
    generation.current++
    setStarting(true)
    setError(null)
    try { setStatus(await syncRequest('POST')) }
    catch (error) {
      setError(error instanceof Error ? error.message : 'Could not confirm sync. Checking status…')
      // The server may have accepted the job before its response was lost.
      // Resume status polling rather than assuming the operation did not start.
      setStatus({ state: 'running' })
      await onComplete()
    }
    finally { setStarting(false) }
  }, [starting, status.state, onComplete])

  return <SyncContext.Provider value={{ busy: starting || status.state === 'running', error, start }}>{children}</SyncContext.Provider>
}

export function useSync() {
  const value = useContext(SyncContext)
  if (!value) throw new Error('SyncButton requires SyncProvider')
  return value
}
