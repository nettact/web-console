export interface ChartWindow {
  startMs: number
  endMs: number
}

export interface ChartCoverage {
  pointCount: number
  firstObservedMs: number | null
  lastObservedMs: number | null
  spanMs: number
  spanRatio: number
  startRatio: number
}

function isValidWindow(value: ChartWindow | undefined): value is ChartWindow {
  return !!value
    && Number.isFinite(value.startMs)
    && Number.isFinite(value.endMs)
    && value.endMs > value.startMs
}

export function makeChartWindow(rangeSec: number, endMs = Date.now()): ChartWindow {
  const safeEnd = Number.isFinite(endMs) ? endMs : Date.now()
  const safeRange = Number.isFinite(rangeSec) && rangeSec > 0 ? rangeSec * 1000 : 3_600_000
  return { startMs: safeEnd - safeRange, endMs: safeEnd }
}

// The modern time-window prop is authoritative. xMin/xMax remain as a
// compatibility pair for the game views that already align several charts.
export function resolveChartWindow(
  timeWindow?: ChartWindow,
  xMin?: number,
  xMax?: number,
): ChartWindow | null {
  if (isValidWindow(timeWindow)) return timeWindow
  const legacy = xMin === undefined || xMax === undefined ? undefined : { startMs: xMin, endMs: xMax }
  return isValidWindow(legacy) ? legacy : null
}

export function chartCoverage(
  sampleGroups: ReadonlyArray<ReadonlyArray<{ ts: string }>>,
  timeWindow: ChartWindow,
): ChartCoverage {
  const times = sampleGroups
    .flatMap((samples) => samples.map((sample) => new Date(sample.ts).getTime()))
    .filter((time) => Number.isFinite(time) && time >= timeWindow.startMs && time <= timeWindow.endMs)
    .sort((a, b) => a - b)

  if (!times.length) {
    return {
      pointCount: 0,
      firstObservedMs: null,
      lastObservedMs: null,
      spanMs: 0,
      spanRatio: 0,
      startRatio: 0,
    }
  }

  const firstObservedMs = times[0]
  const lastObservedMs = times[times.length - 1]
  const windowSpan = timeWindow.endMs - timeWindow.startMs
  const spanMs = Math.max(0, lastObservedMs - firstObservedMs)
  return {
    pointCount: times.length,
    firstObservedMs,
    lastObservedMs,
    spanMs,
    spanRatio: Math.min(spanMs / windowSpan, 1),
    startRatio: Math.min(Math.max((firstObservedMs - timeWindow.startMs) / windowSpan, 0), 1),
  }
}
