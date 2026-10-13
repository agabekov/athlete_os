import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardResponse, DashboardData } from '../lib/dashboard-types'
import { Header } from '../components/Header'
import { ConnectScreen } from '../components/ConnectScreen'
import { EmptyState } from '../components/EmptyState'
import { SectionTitle } from '../components/SectionTitle'
import { HeroStats } from '../components/HeroStats'
import { ChartsPanel } from '../components/ChartsPanel'
import { SleepSection } from '../components/SleepSection'
import { WorkoutsSection } from '../components/WorkoutsSection'
import { RecordsWall } from '../components/RecordsWall'
import { YearHeatmap } from '../components/YearHeatmap'
import { SetupScreen } from './SetupScreen'
import { SyncProvider } from './SyncContext'

function Dashboard({ data }: { data: DashboardData }) {
  return <main className="reveal relative z-10 mx-auto max-w-7xl space-y-10 p-4 pb-20 sm:p-8 lg:p-10">
    <Header name={data.name} lastSynced={data.lastSynced} snapshotDate={data.snapshot.date} syncIncomplete={data.syncIncomplete} />
    <HeroStats today={data.snapshot} avgs={data.averages} />
    <section><SectionTitle index="01" title="Trends" /><ChartsPanel series={data.series} /></section>
    <section><SectionTitle index="02" title="Sleep" /><SleepSection sleeps={data.sleeps} averages={data.sleepAverages} weekdays={data.weekdays} /></section>
    <section><SectionTitle index="03" title="Workouts" /><WorkoutsSection sports={data.sports} recent={data.workouts} totals={data.workoutTotals} /></section>
    <section><SectionTitle index="04" title="All-time records" /><RecordsWall records={data.records} /></section>
    <section><SectionTitle index="05" title="The year in recovery" /><YearHeatmap data={data.heatmap} /></section>
  </main>
}

export function App() {
  const [response, setResponse] = useState<DashboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const current = ++generation.current
    try {
      const result = await fetch('/api/dashboard', { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      if (!result.ok) throw new Error('Could not load your dashboard. Please retry.')
      const next = await result.json() as DashboardResponse
      if (current !== generation.current) return
      setResponse(next)
      setError(null)
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not load your dashboard.')
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  const connectionError = new URLSearchParams(window.location.search).get('error') ?? undefined
  return <SyncProvider onComplete={reload}>
    {error && <div role="alert" className="surface-inset relative z-10 mx-auto mt-4 max-w-3xl p-4 font-mono text-sm text-rec-low">
      {error} <button className="pressable ml-3 underline" onClick={() => void reload()}>Retry</button>
    </div>}
    {!response && !error && <main className="relative z-10 mx-auto max-w-7xl p-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="surface min-h-32 p-6 font-mono text-sm text-muted">Loading your dashboard…</div>
    </main>}
    {response?.state === 'setup' && <SetupScreen redirectUri={response.redirectUri} />}
    {response?.state === 'disconnected' && <ConnectScreen error={connectionError} />}
    {response?.state === 'empty' && <EmptyState />}
    {response?.state === 'ready' && <Dashboard data={response.data} />}
  </SyncProvider>
}
