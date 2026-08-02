import { describe, it, expect } from 'vitest'
import { GAP_BACKGROUND, GAP_NO_FRAMES, type GameBucket, type GameGap, type GameHostSecond } from '../api'
import { selectionStats } from './gameRun'
import { HIST_BINS, histLowFPS, histMeanFPS } from './histogram'

// selectionStats has its own file because it is a different subject from the
// rest of gameRun: everything there explains an absent measurement, and this
// computes figures over a span the reader chose. The rule it turns on — that
// per-second statistics cannot be averaged into a span's — is worth its own
// place to state.

const T0 = Date.parse('2026-08-01T10:00:00Z')
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString()
const span = (a: number, b: number): [number, number] => [T0 + a * 1000, T0 + b * 1000]

// A bucket at second `sec` whose frames all landed in one histogram bin.
function bucket(sec: number, over: Partial<GameBucket> = {}, bin = 12, count = 60): GameBucket {
  const counts = new Array<number>(HIST_BINS).fill(0)
  counts[bin] = count
  return {
    run_id: 'r1',
    ts: at(sec),
    frames: { presented: count },
    ft: { avg: 16.6, p50: 16.5, p95: 17.2, p99: 18.1, max: 20, sd: 0.4 },
    ft_hist: { layout: 'log24_v1', counts },
    ...over,
  }
}

function host(sec: number, over: Partial<GameHostSecond> = {}): GameHostSecond {
  return { ts: at(sec), cpu: null, cpu_clock: null, mem: null, gpu: null, ...over }
}

function gap(reason: string, fromSec: number, toSec: number): GameGap {
  return { id: `g${fromSec}`, run_id: 'r1', reason, started_at: at(fromSec), ended_at: at(toSec) }
}

describe('the selected window', () => {
  const buckets = [bucket(1), bucket(2), bucket(3), bucket(4)]

  // Half-open at the start, matching what a bucket timestamp means: it names the
  // moment the second CLOSED, so the second ending exactly at `from` belongs to
  // whatever came before it.
  it('takes the seconds the span covers, exclusive at the start', () => {
    const s = selectionStats(span(1, 3), buckets, [], [])
    expect(s.frameSeconds).toBe(2)
    expect(s.presented).toBe(120)
  })

  // The difference between these two IS the interruptions, and both have to be
  // reported: a reader told only one of them draws the wrong conclusion from
  // either.
  it('reports the span independently of how much of it carried frames', () => {
    const s = selectionStats(span(0, 10), buckets, [], [])
    expect(s.spanSeconds).toBe(10)
    expect(s.frameSeconds).toBe(4)
  })

  it('reports an empty span without inventing values', () => {
    const s = selectionStats(span(100, 200), buckets, [], [])
    expect(s.frameSeconds).toBe(0)
    expect(s.presented).toBe(0)
    expect(s.meanFps).toBeNull()
    expect(s.worstFrameMs).toBeNull()
  })
})

describe('the frame figures', () => {
  // The rule the whole feature turns on. A mean of per-second percentiles is not
  // the span's percentile — it is not any number — so the FPS figures come from
  // summing the histograms and nowhere else.
  it('derives the FPS figures from the summed histograms', () => {
    const buckets = Array.from({ length: 400 }, (_, i) => bucket(i + 1))
    const s = selectionStats(span(0, 400), buckets, [], [])
    const summed = new Array<number>(HIST_BINS).fill(0)
    summed[12] = 400 * 60
    expect(s.meanFps).toBe(histMeanFPS(summed))
    expect(s.low1PctFps).toBe(histLowFPS(summed, 0.01))
    expect(s.low01PctFps).toBe(histLowFPS(summed, 0.001))
  })

  // A distribution missing an unknown share of its frames is not the span's, so
  // the figures are refused rather than computed from what is recognisable.
  it('refuses the FPS figures when a second used an unknown layout', () => {
    const odd = bucket(2)
    odd.ft_hist = { layout: 'log48_v2', counts: new Array<number>(48).fill(1) }
    const s = selectionStats(span(0, 5), [bucket(1), odd, bucket(3)], [], [])
    expect(s.layoutUnknown).toBe(true)
    expect(s.meanFps).toBeNull()
    expect(s.low1PctFps).toBeNull()
    // Everything not derived from the distribution still stands.
    expect(s.presented).toBe(180)
    expect(s.frameSeconds).toBe(3)
  })

  // A maximum IS combinable across seconds — the max of maxes is the max — which
  // is exactly why no percentile is offered beside it.
  it('takes the slowest single frame across the span', () => {
    const spike = bucket(2)
    spike.ft = { ...spike.ft, max: 240 }
    const s = selectionStats(span(0, 5), [bucket(1), spike, bucket(3)], [], [])
    expect(s.worstFrameMs).toBe(240)
  })

  // A count a second could not see is a blind spot, not a zero: it contributes
  // nothing AND leaves the total absent unless some second could see it.
  it('leaves a total absent when no second could count it', () => {
    const s = selectionStats(span(0, 5), [bucket(1), bucket(2)], [], [])
    expect(s.displayed).toBeNull()
    expect(s.dropped).toBeNull()
    expect(s.stutterCount).toBeNull()
  })

  it('establishes a total as soon as one second could count it', () => {
    const seen = bucket(2, { frames: { presented: 60, displayed: 59, dropped: 1 } })
    const s = selectionStats(span(0, 5), [bucket(1), seen], [], [])
    expect(s.displayed).toBe(59)
    expect(s.dropped).toBe(1)
  })

  // A second that WATCHED for long frames and saw none contributes its zero and
  // establishes the total; one that watched for nothing leaves it absent.
  it('counts a watched second with no hitch as a real zero', () => {
    const watched = bucket(1, { stutter: { count: 0, excess_ms: 0 } })
    const hitched = bucket(2, { stutter: { count: 2, excess_ms: 118.5 } })
    const s = selectionStats(span(0, 5), [watched, hitched], [], [])
    expect(s.stutterCount).toBe(2)
    expect(s.stutterExcessMs).toBeCloseTo(118.5)
  })
})

describe('the machine figures', () => {
  // These ARE averaged, and the reason differs in kind from the frame-time
  // percentiles above: a percentage is a rate over intervals of equal length, so
  // the mean of N of them is the mean over N seconds.
  it('averages the machine CPU and peaks the rest', () => {
    const hosts = [
      host(1, { cpu: { total_pct: 20, busiest_pct: 80 }, mem: { used: 100, total: 1000 } }),
      host(2, { cpu: { total_pct: 40, busiest_pct: 95 }, mem: { used: 300, total: 1000 }, gpu: { util_pct: 70 } }),
      host(3, { cpu: { total_pct: 60, busiest_pct: 50 }, gpu: { util_pct: 40 } }),
    ]
    const s = selectionStats(span(0, 5), [], hosts, [])
    expect(s.hostCpuMeanPct).toBe(40)
    expect(s.hostCpuPeakPct).toBe(95)
    expect(s.hostGpuPeakPct).toBe(70)
    expect(s.hostMemPeakUsed).toBe(300)
  })

  // A machine that reported nothing is absent, not zero: a zero here reads as
  // "the box was idle", which is the opposite of "nothing was measured".
  it('reports unmeasured machine figures as absent', () => {
    const s = selectionStats(span(0, 5), [], [host(1)], [])
    expect(s.hostCpuMeanPct).toBeNull()
    expect(s.hostCpuPeakPct).toBeNull()
    expect(s.hostGpuPeakPct).toBeNull()
    expect(s.hostMemPeakUsed).toBeNull()
  })

  // An idle machine is a measurement and must survive as one.
  it('keeps a measured zero', () => {
    const s = selectionStats(span(0, 5), [], [host(1, { cpu: { total_pct: 0, busiest_pct: 0 } })], [])
    expect(s.hostCpuMeanPct).toBe(0)
    expect(s.hostCpuPeakPct).toBe(0)
  })

  // The clocks take the FLOOR, not the peak or the mean. A peak says the
  // hardware was capable of it, which is never the question when a reader has
  // just dragged out a stretch where the frame rate dropped — a clock that fell
  // inside it is the answer, and both a mean and a peak hide it.
  it('takes the lowest clock seen rather than the peak or the mean', () => {
    const hosts = [
      host(1, { cpu_clock: { current_mhz: 4900, max_mhz: 3600 }, gpu: { core_mhz: 2600, mem_mhz: 1313 } }),
      host(2, { cpu_clock: { current_mhz: 1200, max_mhz: 3600 }, gpu: { core_mhz: 900, mem_mhz: 1313 } }),
      host(3, { cpu_clock: { current_mhz: 4700, max_mhz: 3600 }, gpu: { core_mhz: 2550, mem_mhz: 1313 } }),
    ]
    const s = selectionStats(span(0, 5), [], hosts, [])
    expect(s.cpuMinMHz).toBe(1200)
    expect(s.gpuMinMHz).toBe(900)
    expect(s.gpuMemMinMHz).toBe(1313)
  })

  // A card that publishes one clock and not the other is ordinary. The absent
  // one stays absent rather than dragging the present one down to nothing.
  it('reports each clock independently', () => {
    const hosts = [
      host(1, { cpu_clock: { current_mhz: 3000, max_mhz: 3600 } }),
      host(2, { gpu: { core_mhz: 2100 } }),
    ]
    const s = selectionStats(span(0, 5), [], hosts, [])
    expect(s.cpuMinMHz).toBe(3000)
    expect(s.gpuMinMHz).toBe(2100)
    expect(s.gpuMemMinMHz).toBeNull()
  })

  // The machine stream and the frame stream are separate, so a span holding one
  // and not the other reports what it has.
  it('reports machine figures for a span with no frames at all', () => {
    const s = selectionStats(span(0, 5), [], [host(1, { cpu: { total_pct: 55, busiest_pct: 99 } })], [])
    expect(s.frameSeconds).toBe(0)
    expect(s.hostCpuMeanPct).toBe(55)
  })
})

describe('the interruptions', () => {
  it('counts each reason separately', () => {
    const gaps = [gap(GAP_BACKGROUND, 1, 5), gap(GAP_NO_FRAMES, 6, 9)]
    const s = selectionStats(span(0, 20), [], [], gaps)
    expect(s.gapBackgroundSeconds).toBe(4)
    expect(s.gapNoFramesSeconds).toBe(3)
  })

  // A reader who selected ten seconds of a fifty-minute absence asked about ten
  // seconds, so the interval is clipped rather than counted whole.
  it('clips a gap to the selected span', () => {
    const s = selectionStats(span(10, 20), [], [], [gap(GAP_BACKGROUND, 0, 3600)])
    expect(s.gapBackgroundSeconds).toBe(10)
  })

  it('ignores a gap entirely outside the span', () => {
    const s = selectionStats(span(0, 5), [], [], [gap(GAP_BACKGROUND, 100, 200)])
    expect(s.gapBackgroundSeconds).toBe(0)
  })

  // The vocabulary is the sensor's and is open. An unrecognised reason is not
  // counted under either heading rather than being guessed into one — the band
  // is still drawn, unlabelled, which is where it is reported.
  it('does not guess an unrecognised reason into a known heading', () => {
    const s = selectionStats(span(0, 20), [], [], [gap('some_future_reason', 1, 9)])
    expect(s.gapBackgroundSeconds).toBe(0)
    expect(s.gapNoFramesSeconds).toBe(0)
  })
})
