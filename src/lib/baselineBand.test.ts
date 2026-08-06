import { describe, expect, it } from 'vitest'

import { baselineSpans, bucketOf } from './baselineBand'
import type { TargetBaseline } from '../api'

// Local time, deliberately: the corridor is drawn on a chart the user reads in
// their own timezone, and these tests build their moments the same way.
const at = (y: number, mo: number, d: number, h: number) => new Date(y, mo - 1, d, h, 0, 0, 0).getTime()

function baseline(over: Partial<TargetBaseline> = {}): TargetBaseline {
  return {
    target_id: 't1',
    agent_id: 'a1',
    metric_kind: 'probe.icmp.rtt_ms',
    learning: false,
    observed_days: 7,
    min_days: 3,
    bands: [
      { weekend: false, daypart: 0, p50: 10, p95: 20, days: 7, samples: 900 },
      { weekend: false, daypart: 1, p50: 30, p95: 50, days: 7, samples: 900 },
    ],
    ...over,
  }
}

describe('bucketOf', () => {
  it('splits the local day into four and marks weekends', () => {
    expect(bucketOf(at(2026, 3, 4, 2))).toEqual({ daypart: 0, weekend: false })
    expect(bucketOf(at(2026, 3, 4, 6))).toEqual({ daypart: 1, weekend: false })
    expect(bucketOf(at(2026, 3, 4, 17))).toEqual({ daypart: 2, weekend: false })
    expect(bucketOf(at(2026, 3, 4, 18))).toEqual({ daypart: 3, weekend: false })
    // 2026-03-07 is a Saturday.
    expect(bucketOf(at(2026, 3, 7, 12)).weekend).toBe(true)
  })
})

describe('baselineSpans', () => {
  it('clips the corridor to the requested window', () => {
    const from = at(2026, 3, 4, 1)
    const to = at(2026, 3, 4, 5)
    const spans = baselineSpans(baseline(), from, to)

    expect(spans).toEqual([{ from, to, lo: 10, hi: 20 }])
  })

  it('changes the corridor at a daypart boundary', () => {
    const from = at(2026, 3, 4, 4)
    const to = at(2026, 3, 4, 8)
    const spans = baselineSpans(baseline(), from, to)

    // 04:00–06:00 is the early band, 06:00–08:00 the morning one. A single flat
    // corridor across both would be an average of two different normals.
    expect(spans).toEqual([
      { from, to: at(2026, 3, 4, 6), lo: 10, hi: 20 },
      { from: at(2026, 3, 4, 6), to, lo: 30, hi: 50 },
    ])
  })

  it('leaves an unlearned daypart unshaded rather than borrowing a neighbour', () => {
    const from = at(2026, 3, 4, 4)
    const to = at(2026, 3, 4, 20)
    const spans = baselineSpans(baseline(), from, to)

    // Only dayparts 0 and 1 are learned; 12:00 onward is a gap, not a guess.
    expect(spans).toHaveLength(2)
    expect(spans[spans.length - 1].to).toBe(at(2026, 3, 4, 12))
  })

  it('merges consecutive spans that share a band', () => {
    const flat = baseline({
      bands: [0, 1, 2, 3].map((daypart) => ({
        weekend: false, daypart, p50: 10, p95: 20, days: 7, samples: 900,
      })),
    })
    const from = at(2026, 3, 4, 1)
    const to = at(2026, 3, 4, 23)

    expect(baselineSpans(flat, from, to)).toEqual([{ from, to, lo: 10, hi: 20 }])
  })

  it('draws nothing while the target is still learning', () => {
    const from = at(2026, 3, 4, 1)
    const to = at(2026, 3, 4, 5)

    expect(baselineSpans(baseline({ learning: true }), from, to)).toEqual([])
    expect(baselineSpans(baseline({ bands: [] }), from, to)).toEqual([])
    expect(baselineSpans(null, from, to)).toEqual([])
  })

  it('does not use a weekday band for a weekend window', () => {
    // 2026-03-07 is a Saturday and the fixture only learned weekdays.
    const from = at(2026, 3, 7, 1)
    const to = at(2026, 3, 7, 5)

    expect(baselineSpans(baseline(), from, to)).toEqual([])
  })
})
