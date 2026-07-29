// Trend-line data preparation shared by every MetricChart consumer.
//
// ECharts connects adjacent points by default, even when the agent produced no
// samples for a long period. Insert a null point inside a materially large gap
// so the missing interval is visible instead of being presented as a continuous
// measurement.

const MIN_BREAK_GAP_MS = 90_000
const BREAK_GAP_FACTOR = 3

type TimedValue = { ts: string; value: number }
export type LineDatum = [number, number | null]

function typicalGapMs(points: LineDatum[]): number | null {
  const gaps: number[] = []
  for (let i = 1; i < points.length; i++) {
    const gap = points[i][0] - points[i - 1][0]
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length < 2) return null

  gaps.sort((a, b) => a - b)
  // Use the lower median. With a short series containing one ordinary interval
  // and one outage, the outage must not redefine itself as the normal cadence.
  return gaps[Math.floor((gaps.length - 1) / 2)]
}

export function lineDataWithGaps(samples: TimedValue[]): LineDatum[] {
  const points: LineDatum[] = samples
    .map((sample) => [new Date(sample.ts).getTime(), sample.value] as LineDatum)
    .filter(([ts]) => Number.isFinite(ts))
    .sort((a, b) => a[0] - b[0])

  const typical = typicalGapMs(points)
  if (typical === null) return points

  const breakGap = Math.max(MIN_BREAK_GAP_MS, typical * BREAK_GAP_FACTOR)
  const data: LineDatum[] = []
  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    const previous = points[i - 1]
    if (previous && point[0] - previous[0] > breakGap) {
      data.push([previous[0] + (point[0] - previous[0]) / 2, null])
    }
    data.push(point)
  }
  return data
}
