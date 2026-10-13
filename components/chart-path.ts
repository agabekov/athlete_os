export interface Pt { x: number; y: number }

/** Keep unknown measurements as breaks instead of interpolating across them. */
export function splitPointSegments(points: (Pt | null)[]): Pt[][] {
  const segments: Pt[][] = []
  let current: Pt[] = []
  for (const point of points) {
    if (point) current.push(point)
    else if (current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

export function buildLinePath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2
    const my = (pts[i - 1].y + pts[i].y) / 2
    d += ` Q ${pts[i - 1].x} ${pts[i - 1].y} ${mx} ${my}`
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`
  return d
}

export function buildAreaPath(pts: Pt[], height: number): string {
  if (pts.length < 2) return ''
  return `${buildLinePath(pts)} L ${pts[pts.length - 1].x} ${height} L ${pts[0].x} ${height} Z`
}
