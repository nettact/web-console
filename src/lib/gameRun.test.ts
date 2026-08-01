import { describe, it, expect } from 'vitest'
import { CAP_DISPLAYED, CAP_FRAME_TYPE, CAP_PRESENT_META, type GameBucket, type GameRun } from '../api'
import {
  bucketsAbsence,
  bucketsTruncated,
  isRunning,
  missingCause,
  observes,
  presentCause,
  qualityFlags,
} from './gameRun'

function bucket(over: Partial<GameBucket> = {}): GameBucket {
  return {
    run_id: 'r1',
    ts: '2026-08-01T10:00:00Z',
    frames: { presented: 120 },
    ft: { avg: 8.3, p50: 8.2, p95: 9.1, p99: 12.4, max: 20, sd: 1.1 },
    ft_hist: { layout: 'log24_v1', counts: [] },
    ...over,
  }
}

describe('missingCause', () => {
  it('blames the capability the source lacks', () => {
    expect(missingCause('dropped', [CAP_FRAME_TYPE])).toEqual({ kind: 'source', cap: CAP_DISPLAYED })
    expect(missingCause('app', [CAP_DISPLAYED])).toEqual({ kind: 'source', cap: CAP_FRAME_TYPE })
    expect(missingCause('present', [])).toEqual({ kind: 'source', cap: CAP_PRESENT_META })
  })

  it('distinguishes a declared-but-empty capability from a missing one', () => {
    expect(missingCause('displayed', [CAP_DISPLAYED])).toEqual({ kind: 'notRecorded' })
  })

  // A null 1% low says the run was too short to support the figure. Blaming a
  // capability for it would send the user off installing something that would not
  // have helped.
  it('attributes a null run-level FPS figure to the frame count, not to a capability', () => {
    expect(missingCause('fpsStat', [])).toEqual({ kind: 'tooFewFrames' })
    expect(missingCause('fpsStat', [CAP_DISPLAYED, CAP_FRAME_TYPE])).toEqual({ kind: 'tooFewFrames' })
  })
})

describe('observes', () => {
  it('gates the optional series on their capability', () => {
    expect(observes('displayed', [CAP_DISPLAYED])).toBe(true)
    expect(observes('displayed', [])).toBe(false)
    expect(observes('generated', [CAP_FRAME_TYPE])).toBe(true)
  })

  it('treats an always-present field as observed', () => {
    expect(observes('fpsStat', [])).toBe(true)
  })
})

describe('isRunning', () => {
  it('reads a null ended_at as still presenting', () => {
    expect(isRunning({ ended_at: null })).toBe(true)
    expect(isRunning({ ended_at: '2026-08-01T11:00:00Z' })).toBe(false)
  })
})

describe('bucketsTruncated', () => {
  const run = (durationSeconds: number) =>
    ({ summary: { duration_seconds: durationSeconds } } as Pick<GameRun, 'summary'>)

  it('flags a run longer than the seconds actually fetched', () => {
    expect(bucketsTruncated(run(7200), new Array(3600).fill(bucket()), 3600)).toBe(true)
  })

  it('leaves a fully fetched run alone', () => {
    expect(bucketsTruncated(run(600), new Array(600).fill(bucket()), 3600)).toBe(false)
  })

  // Idle seconds produce no bucket at all, so a run can span more wall-clock
  // seconds than it has buckets without being truncated.
  it('does not flag a short run that simply paused', () => {
    expect(bucketsTruncated(run(1200), new Array(600).fill(bucket()), 3600)).toBe(false)
  })
})

// A run whose seconds were pruned keeps its totals, so `presented` is what tells
// the two empty charts apart: frames were counted, and then their detail expired.
function summarized(presented: number): Pick<GameRun, 'summary'> {
  return {
    summary: {
      duration_seconds: 600,
      mean_fps: presented > 0 ? 120 : null,
      low_1pct_fps: null,
      low_0_1pct_fps: null,
      presented,
      displayed: null,
      dropped: null,
    },
  }
}

describe('bucketsAbsence', () => {
  it('reads counted frames with no seconds left as retention, not as a run that measured nothing', () => {
    expect(bucketsAbsence(summarized(842_000))).toBe('aged-out')
  })

  it('reads a run that never counted a frame as never recorded', () => {
    expect(bucketsAbsence(summarized(0))).toBe('never-recorded')
  })
})

describe('presentCause', () => {
  it('blames retention once the seconds the block lived on are gone', () => {
    expect(presentCause(summarized(842_000), [], [CAP_PRESENT_META])).toEqual({ kind: 'expired' })
  })

  // The capability is a property of the whole run and was already true before
  // retention ran, so it stays the answer — installing a source that can read
  // presentation details is the actionable advice, expiry is not.
  it('keeps blaming a missing capability over retention', () => {
    expect(presentCause(summarized(842_000), [], [])).toEqual({ kind: 'source', cap: CAP_PRESENT_META })
  })

  it('leaves a run whose seconds are loaded to the ordinary reasons', () => {
    expect(presentCause(summarized(842_000), [bucket()], [CAP_PRESENT_META])).toEqual({ kind: 'notRecorded' })
    expect(presentCause(summarized(0), [], [CAP_PRESENT_META])).toEqual({ kind: 'notRecorded' })
  })
})

describe('qualityFlags', () => {
  it('collects distinct flags in first-seen order', () => {
    const buckets = [
      bucket({ quality: ['hist_clipped'] }),
      bucket(),
      bucket({ quality: ['consume_backlog', 'hist_clipped'] }),
    ]
    expect(qualityFlags(buckets)).toEqual(['hist_clipped', 'consume_backlog'])
  })
})
