import { describe, expect, it } from 'vitest'
import {
  availability,
  availabilityOutages,
  boolSegments,
  HEARTBEAT_MS,
  type Pt,
  type Seg,
  timelineSlices,
  uptimeSegments,
  visibleTimelineBounds,
} from './timeline'

describe('visibleTimelineBounds', () => {
  it('starts at the first observed sample when monitoring began inside the selected window', () => {
    expect(visibleTimelineBounds([8_000, 9_000], 0, 10_000)).toEqual([8_000, 10_000])
  })

  it('clips longer histories to the selected window', () => {
    expect(visibleTimelineBounds([-5_000, 2_000], 0, 10_000)).toEqual([0, 10_000])
  })

  it('keeps the selected window when there are no usable samples', () => {
    expect(visibleTimelineBounds([Number.NaN, 10_000], 0, 10_000)).toEqual([0, 10_000])
  })
})

describe('timelineSlices', () => {
  it('turns one continuous state into evenly spaced time cells', () => {
    const hour = 60 * 60 * 1000
    const slices = timelineSlices([{ start: 0, end: hour, ok: true }], 0, hour, 6)

    expect(slices).toHaveLength(6)
    expect(slices.map((slice) => slice.end - slice.start)).toEqual(Array(6).fill(10 * 60 * 1000))
    expect(slices.every((slice) => slice.ok)).toBe(true)
  })

  it('keeps the exact source interval when a fault crosses display cells', () => {
    const minute = 60 * 1000
    const segs: Seg[] = [
      { start: 0, end: 22 * minute, ok: true },
      { start: 22 * minute, end: 27 * minute, ok: false },
      { start: 27 * minute, end: 60 * minute, ok: true },
    ]
    const slices = timelineSlices(segs, 0, 60 * minute, 6)
    const failed = slices.filter((slice) => !slice.ok)

    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      start: 22 * minute,
      end: 27 * minute,
      sourceStart: 22 * minute,
      sourceEnd: 27 * minute,
    })
  })

  it('clips source intervals to the visible time range', () => {
    const slices = timelineSlices(
      [{ start: -100, end: 1_100, ok: false }],
      0,
      1_000,
      2,
    )

    expect(slices).toHaveLength(2)
    expect(slices[0].sourceStart).toBe(0)
    expect(slices[1].sourceEnd).toBe(1_000)
  })
})

describe('rolled-up availability', () => {
  const minute = 60 * 1000
  const points = [
    { t: 0, v: 1 },
    { t: minute, v: 0.5 },
    { t: 2 * minute, v: 1 },
  ]

  it('keeps a partial-failure bucket visible as interrupted', () => {
    expect(boolSegments(points, 3 * minute)).toEqual([
      { start: 0, end: minute, ok: true },
      { start: minute, end: 2 * minute, ok: false },
      { start: 2 * minute, end: 3 * minute, ok: true },
    ])
  })

  it('uses the bucket success ratio without rounding away failures', () => {
    expect(availability(points, 3 * minute)).toBeCloseTo(5 / 6)
    expect(availabilityOutages(points)).toBe(1)
  })
})

const MINUTE = 60 * 1000

// An uptime counter series, `n` points spaced `gap` apart ending at `end`, whose
// value climbs by `gap` per point the way the agent reports it (seconds).
function uptimeSeries(end: number, gap: number, n: number, startUptimeS = 3600): Pt[] {
  const pts: Pt[] = []
  for (let i = n - 1; i >= 0; i--) pts.push({ t: end - i * gap, v: startUptimeS + (n - 1 - i) * (gap / 1000) })
  return pts
}

describe('uptimeSegments trailing edge', () => {
  const now = 1_700_000_000_000

  // The regression this covers: ranges over 2h read the 1-minute rollup, whose
  // newest bucket trails now by the in-progress bucket plus the rollup worker's
  // cadence. That lag is missing data, not an outage, and drawing it as one put
  // a red "offline" band under an agent that never went down.
  it('does not fabricate an outage from rollup right-edge lag', () => {
    const { segs } = uptimeSegments(uptimeSeries(now - 5 * MINUTE, MINUTE, 60), now)
    expect(segs.some((seg) => !seg.ok)).toBe(false)
    expect(segs[segs.length - 1].end).toBeLessThanOrEqual(now)
  })

  it('stops at the stale horizon instead of extending the last state to now', () => {
    const { segs } = uptimeSegments(uptimeSeries(now - 30 * MINUTE, 30_000, 20), now)
    expect(segs[segs.length - 1].end).toBeLessThan(now)
    expect(segs.some((seg) => !seg.ok)).toBe(false)
  })

  it('still reaches now while heartbeats are current', () => {
    const { segs } = uptimeSegments(uptimeSeries(now - 10_000, 30_000, 20), now)
    expect(segs[segs.length - 1].end).toBe(now)
    expect(segs.every((seg) => seg.ok)).toBe(true)
  })
})

describe('uptimeSegments observed outages', () => {
  const now = 1_700_000_000_000

  it('still marks a gap between two samples as offline', () => {
    const before = uptimeSeries(now - 10 * MINUTE, 30_000, 10)
    const after = uptimeSeries(now - 10_000, 30_000, 10, 60)
    const down = uptimeSegments([...before, ...after], now).segs.filter((seg) => !seg.ok)

    expect(down).toHaveLength(1)
    expect(down[0].start).toBe(before[before.length - 1].t + HEARTBEAT_MS)
    expect(down[0].end).toBe(after[0].t)
  })

  it('reports a counter reset as a restart', () => {
    const before = uptimeSeries(now - MINUTE, 30_000, 4)
    const after = uptimeSeries(now - 10_000, 30_000, 2, 5)
    expect(uptimeSegments([...before, ...after], now).restarts).toEqual([after[0].t])
  })
})
