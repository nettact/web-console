import { describe, expect, it } from 'vitest'
import { timelineSlices, type Seg, visibleTimelineBounds } from './timeline'

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
