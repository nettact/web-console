// Pure helpers for the game performance views: reading a run's optional
// measurements and explaining the ones that are not there.
//
// These exist to keep one rule enforceable in one place. A capture source that
// cannot follow frames to the screen reports no dropped count at all, and
// rendering that absence as 0 would claim a flawless run — the opposite of what
// was observed. So no view writes `?? 0`; it asks missingCause what to say
// instead, and the answer is specific enough to be worth reading.

import { CAP_DISPLAYED, CAP_FRAME_TYPE, CAP_PRESENT_META, type GameBucket, type GameRun } from '../api'

// The optional measurements a view has to render. 'fpsStat' covers the whole-run
// mean/1%/0.1% figures, which share one reason for being absent.
export type GameField = 'displayed' | 'dropped' | 'app' | 'generated' | 'dispFt' | 'present' | 'fpsStat'

// Why a value is missing.
//
// 'source' names the capability the run's source lacks — a permanent property of
// the whole run, and the only one of these that can be fixed by installing
// something. 'notRecorded' means the source declared the capability but no second
// carried the value anyway. 'tooFewFrames' is the statistical answer: a 1% low
// over a couple of hundred frames is one slow frame, not a figure. 'expired' is
// the one nobody did wrong: the second this value lived on was pruned by bucket
// retention, which is far shorter than the run's own.
export type MissingCause =
  | { kind: 'source'; cap: string }
  | { kind: 'notRecorded' }
  | { kind: 'tooFewFrames' }
  | { kind: 'expired' }

const CAP_FOR: Partial<Record<GameField, string>> = {
  displayed: CAP_DISPLAYED,
  dropped: CAP_DISPLAYED,
  dispFt: CAP_DISPLAYED,
  app: CAP_FRAME_TYPE,
  generated: CAP_FRAME_TYPE,
  present: CAP_PRESENT_META,
}

export function missingCause(field: GameField, caps: readonly string[]): MissingCause {
  if (field === 'fpsStat') return { kind: 'tooFewFrames' }
  const cap = CAP_FOR[field]
  if (cap && !caps.includes(cap)) return { kind: 'source', cap }
  return { kind: 'notRecorded' }
}

// Whether the source declared it can fill this field at all. A view uses this to
// decide whether to plot a series: a line the source can never produce must not
// appear as a flat zero baseline, and an empty axis slot with no explanation is
// just as misleading.
export function observes(field: GameField, caps: readonly string[]): boolean {
  const cap = CAP_FOR[field]
  return !cap || caps.includes(cap)
}

// A run with no ended_at is still presenting frames. last_seen_at advances either
// way, so this is the only thing that distinguishes a live session from a
// finished one.
export const isRunning = (run: Pick<GameRun, 'ended_at'>): boolean => !run.ended_at

// How much of the run the loaded buckets actually cover. A run longer than the
// bucket limit comes back truncated, and a chart of the first hour of a six-hour
// session must say so rather than pass itself off as the whole run.
export function bucketsTruncated(run: Pick<GameRun, 'summary'>, buckets: readonly GameBucket[], limit: number): boolean {
  return buckets.length >= limit && run.summary.duration_seconds > buckets.length
}

// Why a run came back with no seconds at all. Buckets are one row per second and
// are pruned on a far shorter window than the run row, whose totals are folded in
// as the seconds land and so survive them — an aged-out run still reports the
// frames it presented while having nothing left to chart. Calling that "recorded
// nothing" describes a different session entirely and sends the reader off to
// check a capture setup that worked.
//
// A surviving frame total is the only evidence the API carries that seconds once
// existed, which leaves one case unreachable: a run whose seconds each presented
// nothing is indistinguishable from a run with no seconds, and gets the more
// conservative answer.
export type BucketsAbsence = 'aged-out' | 'never-recorded'

export function bucketsAbsence(run: Pick<GameRun, 'summary'>): BucketsAbsence {
  return run.summary.presented > 0 ? 'aged-out' : 'never-recorded'
}

// The presentation block is read off a second rather than off the run, so unlike
// the whole-run totals it does not outlive the seconds it came from. Answering
// with 'notRecorded' once they are pruned blames the capture source for what
// retention did.
export function presentCause(
  run: Pick<GameRun, 'summary'>,
  buckets: readonly GameBucket[],
  caps: readonly string[],
): MissingCause {
  const cause = missingCause('present', caps)
  // A source that never had the capability is the stronger answer: it was true
  // before retention touched anything and stays true afterwards.
  if (cause.kind === 'source') return cause
  if (!buckets.length && bucketsAbsence(run) === 'aged-out') return { kind: 'expired' }
  return cause
}

// Distinct quality flags across the loaded seconds, in first-seen order. They
// describe how the measurement was taken rather than what was rendered, so they
// belong in a footnote, not in the figures.
export function qualityFlags(buckets: readonly GameBucket[]): string[] {
  const seen: string[] = []
  for (const b of buckets) {
    for (const q of b.quality ?? []) if (!seen.includes(q)) seen.push(q)
  }
  return seen
}

// ---- view shapes ----
// These live here rather than in the components because a <script setup> block
// cannot export types, and both the producing view and the consuming component
// need them (the same reason useMetricCards owns Card).

// One charted point: [epoch ms, value]. A null value means this second carries no
// such measurement — the chart breaks the line there instead of drawing a zero.
export type GamePoint = [number, number | null]

export interface GameChartSeries {
  key: string
  label: string
  color: string
  data: GamePoint[]
}

// One summary figure. A null value is not measured, and `reason` is what the
// dash's tooltip says about why.
export interface GameCard {
  key: string
  label: string
  value: string | null
  unit?: string
  reason?: string
  foot?: string
}
