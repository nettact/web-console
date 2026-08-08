// Shared math for status/heartbeat timelines. Both the chart (MetricChart) and
// the summary stats (History) must agree on where a sample-and-hold segment
// ends and when the newest sample is too stale to count as "current" — so that
// logic lives here once instead of being duplicated (and drifting) per view.

export const HEARTBEAT_MS = 30_000 // agent status heartbeat cadence
export const OFFLINE_GAP_MS = 90_000 // >3 missed heartbeats ⇒ treat as offline

export type Pt = { t: number; v: number }
export type Seg = { start: number; end: number; ok: boolean }
export type TimelineSlice = Seg & { sourceStart: number; sourceEnd: number }

// A selected window may start before a target existed. Status bands should not
// reserve most of their width for that unobserved time: begin at the first real
// sample, while still clipping older histories to the requested window.
export function visibleTimelineBounds(
  sampleTimes: number[],
  requestedStart: number,
  rangeEnd: number,
): [number, number] {
  let firstObserved = Number.POSITIVE_INFINITY
  for (const value of sampleTimes) {
    if (Number.isFinite(value) && value < rangeEnd && value < firstObserved) firstObserved = value
  }
  if (!Number.isFinite(firstObserved)) return [requestedStart, rangeEnd]
  return [Math.max(requestedStart, firstObserved), rangeEnd]
}

export function toPoints(samples: { ts: string; value: number }[]): Pt[] {
  return samples.map((s) => ({ t: new Date(s.ts).getTime(), v: s.value })).sort((a, b) => a.t - b.t)
}

export function medianGap(pts: Pt[]): number {
  if (pts.length < 2) return HEARTBEAT_MS
  const gaps: number[] = []
  for (let i = 1; i < pts.length; i++) gaps.push(pts[i].t - pts[i - 1].t)
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] || HEARTBEAT_MS
}

// A boolean sample is only trusted as "current" for this long after its
// timestamp; past it the series is treated as unknown (agent likely gone).
export function boolStaleMs(pts: Pt[]): number {
  return Math.max(3 * medianGap(pts), OFFLINE_GAP_MS)
}

function push(segs: Seg[], start: number, end: number, ok: boolean) {
  if (end <= start) return
  const last = segs[segs.length - 1]
  if (last && last.ok === ok && start - last.end < 1) last.end = end
  else segs.push({ start, end, ok })
}

// Boolean status (iface.up, probe.*.ok): sample-and-hold each value forward.
// The final sample is held only until it goes stale, so a dead series stops
// extending rather than drawing a fabricated "up" bar to now.
export function boolSegments(pts: Pt[], now: number): Seg[] {
  const segs: Seg[] = []
  if (!pts.length) return segs
  const stale = boolStaleMs(pts)
  for (let i = 0; i < pts.length; i++) {
    // Rollup buckets carry the fraction of successful rounds. Any value below
    // 1 means the bucket contains at least one failure and must stay visible as
    // an interrupted segment; thresholding at 0.5 would erase short failures.
    const ok = pts[i].v >= 1
    const end = i + 1 < pts.length ? pts[i + 1].t : Math.min(now, pts[i].t + stale)
    push(segs, pts[i].t, end, ok)
  }
  return segs
}

// Count contiguous runs containing one or more failed rounds. This accepts both
// raw booleans and rollup success ratios, so changing the selected range cannot
// make the same short outage disappear at a coarser resolution.
export function availabilityOutages(pts: Pt[]): number {
  let outages = 0
  let wasUp = true
  for (const point of pts) {
    const up = point.v >= 1
    if (wasUp && !up) outages++
    wasUp = up
  }
  return outages
}

// Split long state segments against a fixed time grid without rounding away
// their real transition boundaries. The small cells make an all-up range
// readable as time rather than as one anonymous solid bar; sourceStart/sourceEnd
// retain the exact underlying state interval for the hover detail.
export function timelineSlices(
  segs: Seg[],
  rangeStart: number,
  rangeEnd: number,
  targetSlices = 96,
): TimelineSlice[] {
  if (!segs.length || rangeEnd <= rangeStart || targetSlices <= 0) return []
  const sliceMs = (rangeEnd - rangeStart) / targetSlices
  const out: TimelineSlice[] = []

  for (const seg of segs) {
    const sourceStart = Math.max(seg.start, rangeStart)
    const sourceEnd = Math.min(seg.end, rangeEnd)
    if (sourceEnd <= sourceStart) continue

    let cursor = sourceStart
    while (cursor < sourceEnd) {
      const bucket = Math.floor((cursor - rangeStart) / sliceMs)
      let nextBoundary = rangeStart + (bucket + 1) * sliceMs
      // Avoid a floating-point boundary leaving the cursor unchanged.
      if (nextBoundary <= cursor) nextBoundary = cursor + sliceMs
      const end = Math.min(sourceEnd, nextBoundary)
      out.push({
        start: cursor,
        end,
        ok: seg.ok,
        sourceStart,
        sourceEnd,
      })
      cursor = end
    }
  }
  return out
}

// Time-weighted availability: the mean of each point's value weighted by how
// long it was held. For raw boolean samples (v ∈ {0,1}) this equals the
// fraction of time up; for rollup buckets (v = the bucket's average of 0/1
// samples, i.e. its own up-fraction) it stays exact — a hard >=0.5 threshold
// would round each bucket to fully-up/fully-down and skew the number.
export function availability(pts: Pt[], now: number): number {
  if (!pts.length) return 0
  const stale = boolStaleMs(pts)
  let up = 0
  let total = 0
  for (let i = 0; i < pts.length; i++) {
    const start = pts[i].t
    const end = i + 1 < pts.length ? pts[i + 1].t : Math.min(now, pts[i].t + stale)
    const dur = end - start
    if (dur <= 0) continue
    total += dur
    up += dur * Math.min(Math.max(pts[i].v, 0), 1)
  }
  return total > 0 ? up / total : Math.min(Math.max(pts[pts.length - 1].v, 0), 1)
}

// How long an uptime sample is trusted as "current". Like boolStaleMs it adapts
// to the sample cadence (max of 3× the median gap and the 90s floor): raw
// heartbeats stay at the 90s floor, but a downsampled series (1-minute / 1-hour
// rollup buckets, read at the 6h/24h/… >2h ranges) tolerates its coarser
// spacing.
//
// This is a sample-and-hold horizon, NOT a fault threshold: it decides how far
// the last known state is drawn forward, and how stale the summary card lets a
// value get before it stops claiming the agent is up. It deliberately does not
// try to cover the rollup pipeline's right-edge lag (an in-progress bucket plus
// the worker's multi-minute cadence) — sizing it for that would swallow real
// short outages at the coarse ranges. uptimeSegments instead stops drawing at
// the end of the data rather than extrapolating absence into a fault.
export function uptimeStaleMs(pts: Pt[]): number {
  return Math.max(3 * medianGap(pts), OFFLINE_GAP_MS)
}

// Uptime counter: online while heartbeats keep arriving; a gap = the agent was
// offline; a value drop = it restarted (a failure event worth marking).
export function uptimeSegments(pts: Pt[], now: number): { segs: Seg[]; restarts: number[] } {
  const segs: Seg[] = []
  const restarts: number[] = []
  if (!pts.length) return { segs, restarts }
  const stale = uptimeStaleMs(pts)
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    if (cur.v + 1 < prev.v) restarts.push(cur.t) // counter reset ⇒ restart
    if (cur.t - prev.t > stale) {
      push(segs, prev.t, prev.t + HEARTBEAT_MS, true)
      push(segs, prev.t + HEARTBEAT_MS, cur.t, false)
    } else {
      push(segs, prev.t, cur.t, true)
    }
  }
  // Trailing edge: hold the newest sample forward until it goes stale, then STOP
  // — never extend a red band to now. Past the last sample the series says
  // nothing, and nothing is not evidence of an outage: ranges over 2h read the
  // 1-minute rollup, whose right edge trails now by the in-progress bucket plus
  // the rollup worker's cadence (minutes, not seconds), so extrapolating that
  // absence into a fault painted an offline band across an agent that was up the
  // whole time. Outages that were actually observed are gaps BETWEEN samples and
  // still render, above. Same sample-and-hold convention as boolSegments —
  // whether the agent is offline *right now* is a current-state question for the
  // summary card, not something to infer from where the series happens to end.
  const last = pts[pts.length - 1]
  push(segs, last.t, Math.min(now, last.t + stale), true)
  return { segs, restarts }
}

export function uptimeOnline(pts: Pt[], now: number): boolean {
  if (!pts.length) return false
  if (pts.length < 2) return true // single fresh sample: no cadence to infer an outage from
  return now - pts[pts.length - 1].t <= uptimeStaleMs(pts)
}

export function countRestarts(pts: Pt[]): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) if (pts[i].v + 1 < pts[i - 1].v) n++
  return n
}
