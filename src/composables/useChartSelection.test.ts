import { describe, it, expect } from 'vitest'
import type { ECharts } from 'echarts'
import { covers, pixelAtTime, roundToSeconds, timeAtPixel } from './useChartSelection'

// The pure half of the selection: how a raw drag becomes a span, and which
// seconds that span holds. The pointer handling around them needs a real chart
// and a real pointer, and is exercised by hand.

describe('roundToSeconds', () => {
  // A bucket IS a second. A span ending halfway through one would either include
  // a second the reader did not drag over or exclude one they did, and the
  // statistics cannot express a fraction of a bucket either way.
  it('floors the start and ceils the end, so the span covers every second crossed', () => {
    expect(roundToSeconds(1500, 4200)).toEqual([1000, 5000])
  })

  it('takes a backwards drag as the same span', () => {
    expect(roundToSeconds(4200, 1500)).toEqual([1000, 5000])
  })

  it('leaves a span already on second boundaries alone', () => {
    expect(roundToSeconds(2000, 6000)).toEqual([2000, 6000])
  })

  // A drag that never left one second collapses to nothing rather than to a
  // one-second span the reader did not ask for. The caller drops it.
  it('collapses a drag inside a single second', () => {
    expect(roundToSeconds(3000, 3000)).toEqual([3000, 3000])
  })
})

describe('covers', () => {
  const span: [number, number] = [1000, 4000]

  // Half-open at the start, matching what a bucket timestamp means and what the
  // shaded bands use: the second ending exactly at the span's start belongs to
  // whatever came before it, and two touching spans do not both claim it.
  it('is exclusive at the start and inclusive at the end', () => {
    expect(covers(span, 1000)).toBe(false)
    expect(covers(span, 1001)).toBe(true)
    expect(covers(span, 4000)).toBe(true)
    expect(covers(span, 4001)).toBe(false)
  })

  it('covers nothing when nothing is selected', () => {
    expect(covers(null, 2000)).toBe(false)
  })
})

// The two axis conversions, and specifically the ARGUMENT SHAPE they use.
//
// This is a regression test for a defect that shipped: both were first written
// with the point form, `convertFromPixel(finder, [x, 0])`. With an {xAxisIndex}
// finder that is the wrong overload, and the y of 0 sits above the grid
// rectangle — so ECharts returned an empty array for every call. No drag ever
// started and no highlight was ever positioned, silently, because an empty array
// is not an error.
//
// Asserting the argument is a number rather than only the return value is the
// point: a stub that accepted an array and answered anyway would let the bug
// back in with the test still green.
function stubChart(answer: unknown, seen: unknown[]): ECharts {
  return {
    convertFromPixel: (_finder: unknown, value: unknown) => {
      seen.push(value)
      return answer
    },
    convertToPixel: (_finder: unknown, value: unknown) => {
      seen.push(value)
      return answer
    },
  } as unknown as ECharts
}

describe('the axis conversions', () => {
  it('asks along the axis with a scalar, not with a grid point', () => {
    const seen: unknown[] = []
    timeAtPixel(stubChart(1_700_000_000_000, seen), 240)
    pixelAtTime(stubChart(512, seen), 1_700_000_000_000)
    expect(seen).toEqual([240, 1_700_000_000_000])
    for (const v of seen) {
      expect(Array.isArray(v), 'a point array is the wrong overload for an xAxisIndex finder').toBe(false)
    }
  })

  it('returns what the axis answered', () => {
    expect(timeAtPixel(stubChart(1_700_000_000_000, []), 240)).toBe(1_700_000_000_000)
    expect(pixelAtTime(stubChart(512, []), 1_700_000_000_000)).toBe(512)
  })

  // A chart that has not laid out an axis yet answers with something that is not
  // a number — including the empty array the wrong overload used to produce. All
  // of them have to come back as "cannot answer" rather than as NaN pixels.
  it('treats anything that is not a finite number as no answer', () => {
    for (const bad of [[], NaN, undefined, null, [1, 2]]) {
      expect(timeAtPixel(stubChart(bad, []), 240), String(bad)).toBeNull()
      expect(pixelAtTime(stubChart(bad, []), 1), String(bad)).toBeNull()
    }
  })
})
