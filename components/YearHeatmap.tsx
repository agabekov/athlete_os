export function YearHeatmap({ data }: { data: { date: string; recovery: number | null }[] }) {
  // pad so the grid starts on Monday
  const first = new Date(data[0].date + 'T00:00:00Z')
  const padding = (first.getUTCDay() + 6) % 7
  const cells: ({ date: string; recovery: number | null } | null)[] = [
    ...Array(padding).fill(null), ...data,
  ]
  return (
    <div className="surface p-6">
      <div className="grid grid-flow-col grid-rows-7 gap-[3px] overflow-x-auto">
        {cells.map((c, i) =>
          c === null ? (
            <span key={i} className="h-2.5 w-2.5" />
          ) : (
            <span
              key={c.date}
              title={`${c.date}: ${c.recovery != null ? Math.round(c.recovery) + '%' : 'no data'}`}
              className="h-2.5 w-2.5 rounded-[3px] transition-[scale,box-shadow] duration-150 hover:scale-[1.35] hover:shadow-[0_0_12px_rgba(46,232,108,0.3)]"
              style={{
                background: c.recovery == null
                  ? 'rgba(255,255,255,0.04)'
                  : `rgba(46,232,108,${0.12 + 0.88 * (c.recovery / 100)})`,
              }}
            />
          ),
        )}
      </div>
      <div className="mt-4 flex items-center gap-2 font-mono text-[10px] text-muted">
        <span>low</span>
        {[0.12, 0.34, 0.56, 0.78, 1].map((a) => (
          <span key={a} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `rgba(46,232,108,${a})` }} />
        ))}
        <span>high recovery</span>
      </div>
    </div>
  )
}
