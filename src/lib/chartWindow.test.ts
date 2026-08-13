import { describe, expect, it } from 'vitest'
import { chartCoverage, makeChartWindow, resolveChartWindow } from './chartWindow'

const sample = (ms: number) => ({ ts: new Date(ms).toISOString() })

describe('chart windows', () => {
  it('builds the exact selected range around one shared end time', () => {
    expect(makeChartWindow(7 * 86400, 1_000_000_000)).toEqual({
      startMs: 395_200_000,
      endMs: 1_000_000_000,
    })
  })

  it('prefers a valid shared window and otherwise accepts the legacy pair', () => {
    const shared = { startMs: 100, endMs: 200 }
    expect(resolveChartWindow(shared, 1, 2)).toEqual(shared)
    expect(resolveChartWindow(undefined, 1, 2)).toEqual({ startMs: 1, endMs: 2 })
    expect(resolveChartWindow(undefined, 2, 1)).toBeNull()
    expect(resolveChartWindow({ startMs: Number.NaN, endMs: 2 }, 1, 3)).toEqual({ startMs: 1, endMs: 3 })
  })
})

describe('chart coverage', () => {
  const timeWindow = { startMs: 0, endMs: 1_000 }

  it('keeps a short data history positioned inside the selected window', () => {
    expect(chartCoverage([[sample(800), sample(900)]], timeWindow)).toEqual({
      pointCount: 2,
      firstObservedMs: 800,
      lastObservedMs: 900,
      spanMs: 100,
      spanRatio: 0.1,
      startRatio: 0.8,
    })
  })

  it('reports a single point without inflating it into a time span', () => {
    expect(chartCoverage([[sample(800)]], timeWindow)).toEqual({
      pointCount: 1,
      firstObservedMs: 800,
      lastObservedMs: 800,
      spanMs: 0,
      spanRatio: 0,
      startRatio: 0.8,
    })
  })

  it('ignores invalid and out-of-window samples', () => {
    expect(chartCoverage([[{ ts: 'invalid' }, sample(-1), sample(1_001)]], timeWindow).pointCount).toBe(0)
  })
})
