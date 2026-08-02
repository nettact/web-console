import { describe, it, expect } from 'vitest'
import { bandAt, mergeBands, type ChartBand } from './chartBands'

const band = (kind: ChartBand['kind'], from: number, to: number, text = ''): ChartBand => ({ kind, from, to, text })

describe('mergeBands', () => {
  it('collapses touching and overlapping spans of one kind', () => {
    const got = mergeBands([
      band('stutter', 1000, 2000),
      band('stutter', 2000, 3000),
      band('stutter', 2500, 4000),
    ])
    expect(got).toEqual([{ kind: 'stutter', spans: [[1000, 4000]] }])
  })

  it('keeps a real separation between two spans of one kind', () => {
    const got = mergeBands([band('stutter', 1000, 2000), band('stutter', 5000, 6000)])
    expect(got).toEqual([
      {
        kind: 'stutter',
        spans: [
          [1000, 2000],
          [5000, 6000],
        ],
      },
    ])
  })

  // The rule the whole file exists for. A stutter is a long frame inside a second
  // that HAD frames; a gap is a second that had none. A band claiming to be both
  // would be drawn in one colour and explained by whichever tooltip won, and a
  // reader would have no way to tell which they were looking at.
  it('never merges across kinds, however much they overlap', () => {
    const got = mergeBands([
      band('stutter', 1000, 2000),
      band('gapBackground', 1500, 3000),
      band('gapNoFrames', 1800, 2500),
    ])
    expect(got).toEqual([
      { kind: 'stutter', spans: [[1000, 2000]] },
      { kind: 'gapBackground', spans: [[1500, 3000]] },
      { kind: 'gapNoFrames', spans: [[1800, 2500]] },
    ])
  })

  // A clock stepping backwards produces two intervals covering the same seconds.
  // That is what a clock step IS, and the two should draw as one stretch rather
  // than as an edge in the middle of a continuous silence.
  it('draws two overlapping intervals of one kind as one stretch', () => {
    const got = mergeBands([band('gapBackground', 1000, 5000), band('gapBackground', 3000, 4000)])
    expect(got).toEqual([{ kind: 'gapBackground', spans: [[1000, 5000]] }])
  })

  it('takes spans in any order', () => {
    const got = mergeBands([band('gapNoFrames', 5000, 6000), band('gapNoFrames', 1000, 2000)])
    expect(got).toEqual([
      {
        kind: 'gapNoFrames',
        spans: [
          [1000, 2000],
          [5000, 6000],
        ],
      },
    ])
  })

  it('has nothing to say about nothing', () => {
    expect(mergeBands([])).toEqual([])
  })
})

describe('bandAt', () => {
  const bands = [
    band('stutter', 1000, 2000, 'one hitch'),
    band('stutter', 2000, 3000, 'another hitch'),
    band('gapBackground', 5000, 9000, 'minimised'),
  ]

  // The tooltip reads the UNMERGED list, so a run that stuttered through a whole
  // minute draws one band and still explains each second individually.
  it('finds the individual span rather than the merged one', () => {
    expect(bandAt(bands, 1500)?.text).toBe('one hitch')
    expect(bandAt(bands, 2500)?.text).toBe('another hitch')
  })

  // Half-open at the start, matching how a bucket's timestamp names the moment
  // its second CLOSED: two touching seconds must not both claim the boundary.
  it('treats a span as exclusive at the start and inclusive at the end', () => {
    expect(bandAt(bands, 1000)?.text).toBeUndefined()
    expect(bandAt(bands, 2000)?.text).toBe('one hitch')
    expect(bandAt(bands, 3000)?.text).toBe('another hitch')
  })

  it('finds nothing outside every span', () => {
    expect(bandAt(bands, 4000)).toBeUndefined()
    expect(bandAt(bands, 9001)).toBeUndefined()
    expect(bandAt(undefined, 1500)).toBeUndefined()
    expect(bandAt([], 1500)).toBeUndefined()
  })

  it('finds a gap that no stutter overlaps', () => {
    expect(bandAt(bands, 6000)?.kind).toBe('gapBackground')
  })

  // The two should never overlap — a second either held frames or did not — but
  // if a source ever produces both, the stutter is the more specific claim.
  it('prefers the stutter when something has produced both', () => {
    const both = [band('gapNoFrames', 1000, 3000, 'loading'), band('stutter', 1000, 3000, 'hitch')]
    expect(bandAt(both, 2000)?.text).toBe('hitch')
    expect(bandAt([...both].reverse(), 2000)?.text).toBe('hitch')
  })
})
