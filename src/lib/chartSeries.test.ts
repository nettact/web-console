import { describe, expect, it } from 'vitest'

import { lineDataWithGaps } from './chartSeries'

const at = (seconds: number) => new Date(seconds * 1000).toISOString()
const samples = (...seconds: number[]) => seconds.map((second) => ({ ts: at(second), value: second }))

describe('lineDataWithGaps', () => {
  it('keeps regularly sampled data continuous', () => {
    expect(lineDataWithGaps(samples(0, 30, 60, 90))).toEqual([
      [0, 0],
      [30_000, 30],
      [60_000, 60],
      [90_000, 90],
    ])
  })

  it('inserts a null point when samples disappear beyond the normal cadence', () => {
    expect(lineDataWithGaps(samples(0, 30, 60, 300))).toEqual([
      [0, 0],
      [30_000, 30],
      [60_000, 60],
      [180_000, null],
      [300_000, 300],
    ])
  })

  it('adapts to low-frequency series instead of applying a fixed interval', () => {
    expect(lineDataWithGaps(samples(0, 1800, 3600, 5400))).toHaveLength(4)
    expect(lineDataWithGaps(samples(0, 1800, 3600, 10_800))).toContainEqual([7_200_000, null])
  })

  it('sorts timestamps before detecting gaps', () => {
    expect(lineDataWithGaps(samples(60, 0, 300, 30))).toEqual([
      [0, 0],
      [30_000, 30],
      [60_000, 60],
      [180_000, null],
      [300_000, 300],
    ])
  })

  it('does not invent a cadence from only two points', () => {
    expect(lineDataWithGaps(samples(0, 3600))).toEqual([
      [0, 0],
      [3_600_000, 3600],
    ])
  })
})
