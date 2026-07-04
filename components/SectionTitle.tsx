export function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="surface-inset flex h-8 min-w-8 items-center justify-center rounded-full font-mono text-xs text-rec-high tabular-nums">{index}</span>
      <h2 className="font-display text-xl font-semibold uppercase tracking-[0.15em] text-balance">{title}</h2>
      <div className="h-px flex-1 bg-gradient-to-r from-rec-high/35 via-line to-transparent" />
    </div>
  )
}
