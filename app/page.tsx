import { redirect } from 'next/navigation'
import { getDb, getTokens, getProfile, getLastSyncedAt } from '@/lib/db'
import {
  getDailySeries, averages, getToday, getRecords, getWeekdayPattern,
  getRecentSleeps, getSleepAverages, getSportBreakdown, getRecentWorkouts, getWorkoutTotals, getHeatmap,
} from '@/lib/stats'
import { Header } from '@/components/Header'
import { ConnectScreen } from '@/components/ConnectScreen'
import { EmptyState } from '@/components/EmptyState'
import { SectionTitle } from '@/components/SectionTitle'
import { HeroStats } from '@/components/HeroStats'
import { ChartsPanel } from '@/components/ChartsPanel'
import { SleepSection } from '@/components/SleepSection'
import { WorkoutsSection } from '@/components/WorkoutsSection'
import { RecordsWall } from '@/components/RecordsWall'
import { YearHeatmap } from '@/components/YearHeatmap'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) redirect('/setup')
  const db = getDb()
  const { error } = await searchParams
  if (!getTokens(db)) return <ConnectScreen error={error} />
  const series = getDailySeries(db)
  if (series.length === 0) return <EmptyState />

  const profile = getProfile(db)
  const today = getToday(db)!
  const avgs = averages(series, 30)

  return (
    <main className="reveal relative z-10 mx-auto max-w-7xl space-y-10 p-4 pb-20 sm:p-8 lg:p-10">
      <Header name={profile?.first_name ?? null} lastSynced={getLastSyncedAt(db)} />
      <HeroStats today={today} avgs={avgs} />
      <section>
        <SectionTitle index="01" title="Trends" />
        <ChartsPanel series={series} />
      </section>
      <section>
        <SectionTitle index="02" title="Sleep" />
        <SleepSection sleeps={getRecentSleeps(db)} averages={getSleepAverages(db)} weekdays={getWeekdayPattern(db)} />
      </section>
      <section>
        <SectionTitle index="03" title="Workouts" />
        <WorkoutsSection sports={getSportBreakdown(db)} recent={getRecentWorkouts(db, 10)} totals={getWorkoutTotals(db)} />
      </section>
      <section>
        <SectionTitle index="04" title="All-time records" />
        <RecordsWall records={getRecords(db)} />
      </section>
      <section>
        <SectionTitle index="05" title="The year in recovery" />
        <YearHeatmap data={getHeatmap(db)} />
      </section>
    </main>
  )
}
