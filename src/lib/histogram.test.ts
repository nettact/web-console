import { describe, it, expect } from 'vitest'
import {
  HIST_BINS,
  HIST_EDGES_LOG24_V1,
  HIST_LAYOUT_LOG24_V1,
  HIST_MIDPOINTS_LOG24_V1,
  histAdd,
  histLowFPS,
  histMeanFPS,
  histTotal,
  sumHistograms,
} from './histogram'
import golden from './histogram.golden.json'

// The whole risk in this file is that a TypeScript copy of arithmetic that lives
// in Go drifts from it. The fixture below is generated FROM the Go
// implementation and is read by both suites — protocol/gamesense's
// histogram_golden_test.go asserts Go against it, and this asserts the port. Go
// going red means Go moved; this going red means the port moved. Neither can
// move silently.

interface GoldenCase {
  name: string
  counts: number[]
  mean_fps: number | null
  low_1pct_fps: number | null
  low_0_1pct_fps: number | null
}

describe('the port matches the Go implementation', () => {
  it('has cases to check', () => {
    expect((golden as GoldenCase[]).length).toBeGreaterThan(5)
  })

  for (const c of golden as GoldenCase[]) {
    it(`agrees on ${c.name}`, () => {
      expect(histMeanFPS(c.counts)).toEqual(c.mean_fps)
      expect(histLowFPS(c.counts, 0.01)).toEqual(c.low_1pct_fps)
      expect(histLowFPS(c.counts, 0.001)).toEqual(c.low_0_1pct_fps)
    })
  }
})

// A structural check on the table, so a mistyped digit fails even with no
// fixture. Eight bins per decade means each edge is 10^(1/8) times the last.
describe('the frozen edge table', () => {
  it('has one more edge than it has bins', () => {
    expect(HIST_EDGES_LOG24_V1).toHaveLength(HIST_BINS + 1)
    expect(HIST_MIDPOINTS_LOG24_V1).toHaveLength(HIST_BINS)
  })

  it('is log-spaced at eight bins per decade', () => {
    const ratio = Math.pow(10, 1 / 8)
    for (let i = 0; i + 1 < HIST_EDGES_LOG24_V1.length; i++) {
      const got = HIST_EDGES_LOG24_V1[i + 1] / HIST_EDGES_LOG24_V1[i]
      expect(Math.abs(got - ratio), `edge ${i}→${i + 1}`).toBeLessThan(1e-12)
    }
  })

  it('spans the range the layout name promises', () => {
    expect(HIST_EDGES_LOG24_V1[0]).toBe(0.5)
    expect(HIST_EDGES_LOG24_V1[HIST_BINS]).toBe(500)
  })

  // Geometric, not arithmetic: the arithmetic middle of [50, 66.68) is 58.3 ms,
  // which is not the value that splits the bin evenly in the space it was drawn
  // in.
  it('puts each midpoint at the geometric centre of its bin', () => {
    for (let i = 0; i < HIST_BINS; i++) {
      const lo = HIST_EDGES_LOG24_V1[i]
      const hi = HIST_EDGES_LOG24_V1[i + 1]
      expect(HIST_MIDPOINTS_LOG24_V1[i]).toBeGreaterThan(lo)
      expect(HIST_MIDPOINTS_LOG24_V1[i]).toBeLessThan(hi)
      expect(HIST_MIDPOINTS_LOG24_V1[i]).toBeLessThan((lo + hi) / 2)
    }
  })
})

describe('histAdd', () => {
  it('accumulates bin by bin', () => {
    const dst = new Array<number>(HIST_BINS).fill(0)
    expect(histAdd(dst, new Array<number>(HIST_BINS).fill(2))).toBe(true)
    expect(histAdd(dst, new Array<number>(HIST_BINS).fill(3))).toBe(true)
    expect(histTotal(dst)).toBe(5 * HIST_BINS)
  })

  // A bucket recorded under a different layout must not contaminate a total.
  it('refuses a mismatched length rather than merging part of it', () => {
    const dst = new Array<number>(HIST_BINS).fill(1)
    expect(histAdd(dst, [1, 2, 3])).toBe(false)
    expect(histTotal(dst)).toBe(HIST_BINS)
  })
})

describe('sumHistograms', () => {
  const full = (n: number) => ({ layout: HIST_LAYOUT_LOG24_V1, counts: new Array<number>(HIST_BINS).fill(n) })

  it('adds a span of seconds into one distribution', () => {
    const got = sumHistograms([full(1), full(2), full(3)])
    expect(got).not.toBeNull()
    expect(histTotal(got!)).toBe(6 * HIST_BINS)
  })

  // A reader that does not recognize the layout must decline to interpret the
  // counts. Interpreting the rest and dropping the unknown one would report a
  // distribution missing an unknown share of its frames as though it were the
  // span's, with nothing on screen saying so.
  it('refuses the whole span when one second names an unknown layout', () => {
    expect(sumHistograms([full(1), { layout: 'log48_v2', counts: new Array<number>(48).fill(1) }])).toBeNull()
    expect(sumHistograms([{ layout: 'log48_v2', counts: [] }])).toBeNull()
  })

  // Bucket retention can leave a row whose counts came back empty. That
  // contributes nothing and is not an error — unlike an unknown layout, nothing
  // about it is unaccounted for.
  it('skips a second whose counts are empty', () => {
    const got = sumHistograms([full(1), { layout: HIST_LAYOUT_LOG24_V1, counts: [] }])
    expect(got).not.toBeNull()
    expect(histTotal(got!)).toBe(HIST_BINS)
  })

  it('sums nothing to an empty distribution rather than to null', () => {
    expect(sumHistograms([])).toEqual(new Array<number>(HIST_BINS).fill(0))
  })
})

describe('the too-few-frames refusal', () => {
  const at = (bin: number, n: number) => {
    const c = new Array<number>(HIST_BINS).fill(0)
    c[bin] = n
    return c
  }

  // One slow frame out of two hundred is not a 1% low, it is one slow frame.
  it('declines a fraction covering fewer than ten frames', () => {
    expect(histLowFPS(at(12, 200), 0.01)).toBeNull()
    expect(histLowFPS(at(12, 999), 0.01)).not.toBeNull()
  })

  // Rounded up, matching nearest-rank: the slowest 1% of 999 frames is ten of
  // them, not nine. Truncating would fail the minimum right at the boundary for
  // a span that clears it.
  it('rounds the wanted count up rather than truncating', () => {
    // 900 × 0.01 = 9 exactly, which is below the minimum.
    expect(histLowFPS(at(12, 900), 0.01)).toBeNull()
    // 901 × 0.01 = 9.01, which rounds up to ten and clears it.
    expect(histLowFPS(at(12, 901), 0.01)).not.toBeNull()
  })

  it('refuses a fraction that is not one', () => {
    expect(histLowFPS(at(12, 100000), 0)).toBeNull()
    expect(histLowFPS(at(12, 100000), 1)).toBeNull()
    expect(histLowFPS(at(12, 100000), -0.5)).toBeNull()
  })

  it('refuses a histogram of the wrong width', () => {
    expect(histLowFPS([1, 2, 3], 0.01)).toBeNull()
    expect(histMeanFPS([1, 2, 3])).toBeNull()
  })

  // Null rather than 0. A zero here reads as "the machine rendered nothing",
  // which is the opposite of "there was nothing to measure".
  it('reports an empty histogram as absent rather than as zero', () => {
    expect(histMeanFPS(new Array<number>(HIST_BINS).fill(0))).toBeNull()
  })
})
