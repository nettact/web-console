// Pure helpers for the game performance views: reading a run's optional
// measurements and explaining the ones that are not there.
//
// These exist to keep one rule enforceable in one place. A capture source that
// cannot follow frames to the screen reports no dropped count at all, and
// rendering that absence as 0 would claim a flawless run — the opposite of what
// was observed. So no view writes `?? 0`; it asks missingCause what to say
// instead, and the answer is specific enough to be worth reading.

import {
  CAP_CPU_SPLIT,
  CAP_DISPLAYED,
  CAP_FRAME_TYPE,
  CAP_GPU_SPLIT,
  CAP_LATENCY,
  CAP_PRESENT_META,
  CAP_PROC_CPU,
  CAP_PROC_MEM,
  CAP_PROC_VRAM,
  CAP_STUTTER,
  GAP_BACKGROUND,
  GAP_NO_FRAMES,
  type GameBucket,
  type GameGap,
  type GameHostSecond,
  type GameRun,
} from '../api'
import { histLowFPS, histMeanFPS, sumHistograms } from './histogram'

// The optional measurements a view has to render. 'fpsStat' covers the whole-run
// mean/1%/0.1% figures, which share one reason for being absent. The process
// resource fields are split three ways rather than one because 'procCpu' and
// 'procWs'/'procPriv' are backed by different capabilities — a source can report
// the game's memory without being able to report its CPU.
// The diagnostic families each get their own field, one per chart the page
// draws, even where two of them share a capability. A field is what a caption
// asks about, and "the presentation chain is missing" and "the GPU breakdown is
// missing" are different sentences to write even when one absent capability
// causes both.
export type GameField =
  | 'displayed'
  | 'dropped'
  | 'app'
  | 'generated'
  | 'dispFt'
  | 'present'
  | 'fpsStat'
  | 'stutter'
  | 'procCpu'
  | 'procWs'
  | 'procPriv'
  | 'cpuSplit'
  | 'gpuSplit'
  | 'presentChain'
  | 'displayLatency'
  | 'animError'
  | 'procVram'

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
  stutter: CAP_STUTTER,
  procCpu: CAP_PROC_CPU,
  procWs: CAP_PROC_MEM,
  procPriv: CAP_PROC_MEM,
  cpuSplit: CAP_CPU_SPLIT,
  // The present-chain figures (time blocked inside Present, and Present to GPU
  // completion) travel in the GPU breakdown block, so they stand or fall with
  // it — but they answer a different question, which is why they are charted and
  // explained separately.
  gpuSplit: CAP_GPU_SPLIT,
  presentChain: CAP_GPU_SPLIT,
  // Display latency and animation error come from the same block for the same
  // reason: one says how long a frame took to appear, the other how evenly the
  // frames that did appear were spaced.
  displayLatency: CAP_LATENCY,
  animError: CAP_LATENCY,
  procVram: CAP_PROC_VRAM,
}

// The diagnostic capabilities, split by where they come from. The video-memory
// read is the one that needs a permission the others do not — game.gpu.read —
// and can therefore be absent from a run that asked for everything else and got
// it.
//
// The whole-card and whole-machine readings are deliberately not here. They are
// not a property of a run at all: they are keyed by (agent, second) and read by
// every run that overlaps them, so a run's capability list cannot promise or
// deny them and a reader answers "is there any" by looking for a value.
export const DIAG_FRAME_CAPS = [CAP_CPU_SPLIT, CAP_GPU_SPLIT, CAP_LATENCY]
export const DIAG_GPU_CAPS = [CAP_PROC_VRAM]
export const DIAG_CAPS = [...DIAG_FRAME_CAPS, ...DIAG_GPU_CAPS]

// Why a run is missing diagnostic capabilities — which is really the question
// "what, if anything, would fix it", and the answers are not interchangeable.
//
// A run's caps state what it set out to measure, so they distinguish the case
// nobody can act on from the two somebody can:
//
// - 'tier'    not one diagnostic capability: the run was captured at the base
//             depth. The profile's tier decides this, and switching it to
//             Diagnostic makes LATER runs carry the breakdowns.
// - 'gpu'     everything else is present and exactly the GPU-sourced reading is
//             not. The depth is already Diagnostic — the missing half needs
//             game.gpu.read to be granted and effective on the agent, or the
//             machine exposes no per-process video memory at all. Re-selecting
//             the tier changes nothing, and telling the reader to try it wastes
//             a configuration round-trip on the wrong page.
// - 'partial' captured at the diagnostic depth with some other family missing:
//             a source that did not initialize on that machine. Again not a
//             tier problem.
//
// The distinction only holds while caps are per-run truthful — a run captured at
// base depth must not carry diagnostic caps, or 'gpu'/'partial' would be
// reported for runs whose actual answer is 'tier'.
export type DiagAbsence = 'none' | 'tier' | 'gpu' | 'partial'

export function diagAbsence(caps: readonly string[]): DiagAbsence {
  const missing = DIAG_CAPS.filter((c) => !caps.includes(c))
  if (!missing.length) return 'none'
  if (missing.length === DIAG_CAPS.length) return 'tier'
  if (missing.every((c) => DIAG_GPU_CAPS.includes(c))) return 'gpu'
  return 'partial'
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

// One second the player felt a hitch in, as a half-open span on the chart's time
// axis. A bucket's ts is the moment the second CLOSED, which is also where its
// point is plotted, so the span it describes ends there and begins a second
// earlier — shading [ts, ts+1s] would mark the second after the one that hitched.
//
// The two counters are booked differently, which is the whole reason for `kind`.
// A merged stutter event is attributed IN FULL to the second it started in, so
// its count lands there and nowhere else; the excess time it cost is booked to
// each second it actually spanned. A freeze crossing a second boundary therefore
// leaves `count: 0, excess_ms: >0` behind it — a second the screen was still
// frozen through. Keying the marks on count alone left exactly those seconds
// unshaded, drawing a 400 ms freeze as an instant and, worse, letting the caption
// conclude the run's hitches happened somewhere off-screen.
//
// Only 0/0 is smooth: watched, and nothing to show for it.
export type StutterKind = 'start' | 'continuation'

export interface StutterSecond {
  from: number
  to: number
  kind: StutterKind
  count: number
  excessMs: number
}

export function stutterSeconds(buckets: readonly GameBucket[]): StutterSecond[] {
  const out: StutterSecond[] = []
  for (const b of buckets) {
    const s = b.stutter
    if (!s || (s.count <= 0 && s.excess_ms <= 0)) continue
    const to = new Date(b.ts).getTime()
    out.push({
      from: to - 1000,
      to,
      // A second holding cost but no event is the tail of one that started
      // earlier. Reporting "0 stutters" over it would contradict the band.
      kind: s.count > 0 ? 'start' : 'continuation',
      count: s.count,
      excessMs: s.excess_ms,
    })
  }
  return out
}

// The earliest instant the run's charts must cover.
//
// A second's span reaches back from its closing timestamp to the moment it
// began, so the first loaded second occupies the axis to the LEFT of where its
// point is plotted. A run whose first bucket closes at started_at therefore has
// a second of history before its own start, and an axis pinned at started_at
// clips that second's stutter band to zero width — the one hitch in a short run
// disappears from the chart while the card above it still counts the hitch.
//
// Widening rather than clamping the band keeps the band honest: a mark squeezed
// to fit the axis would sit over the wrong second.
export function chartFloor(startMs: number, buckets: readonly GameBucket[]): number {
  if (!buckets.length) return startMs
  return Math.min(startMs, new Date(buckets[0].ts).getTime() - 1000)
}

// What the frame-time chart's stutter markers mean, including when there are
// none of them.
//
// An empty marker set has three unrelated causes and only one of them is good
// news. The run-level count settles it: it is folded in as the seconds land, so
// it covers the WHOLE run even when the page loaded only the first slice of it,
// and it survives the seconds themselves. A caption reading the loaded buckets
// instead would call a clipped run smooth while the card above it reports
// hundreds of hitches — the loaded segment simply is not where they happened.
//
// - 'unwatched'    the source cannot detect stutter at all
// - 'marked'       at least one loaded second is shaded
// - 'smooth'       the whole run was watched and held nothing
// - 'elsewhere'    the run held hitches, but not in the seconds on screen
// - 'notRecorded'  the capability was declared and no figure ever arrived
export type StutterMarkState = 'unwatched' | 'marked' | 'smooth' | 'elsewhere' | 'notRecorded'

export function stutterMarkState(
  run: Pick<GameRun, 'stutter_count'>,
  marked: number,
  caps: readonly string[],
): StutterMarkState {
  if (!observes('stutter', caps)) return 'unwatched'
  if (marked > 0) return 'marked'
  if (run.stutter_count === null) return 'notRecorded'
  return run.stutter_count > 0 ? 'elsewhere' : 'smooth'
}

// Stutters per minute of play. Two sessions of different lengths cannot be
// compared on their raw counts — twenty hitches in ten minutes and twenty in
// four hours are not the same experience — so the rate is what the card shows.
//
// Null in, null out: a run nobody watched for stutter has no rate, and dividing
// a missing count would manufacture a 0. A run with no measured duration gets
// the same answer rather than an infinity.
export function stutterPerMinute(count: number | null, durationSeconds: number): number | null {
  if (count === null || durationSeconds <= 0) return null
  return (count * 60) / durationSeconds
}

// Whether any second of a charted series carried a value. A series that is all
// null draws nothing, and an empty plot with a legend entry above it reads as a
// flat zero the eye missed rather than as the absence it is — so the view uses
// this to swap the caption for the reason instead.
export const seriesHasValue = (data: readonly GamePoint[]): boolean => data.some(([, v]) => v !== null)

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
//
// `hint` is the sentence explaining what the figure IS, shown on hover rather
// than under the value. It used to be a line in the card, and that made the
// card's height depend on whether the sentence was there — so a grid whose cards
// gained and lost their explanations reflowed, which is unpleasant under a
// pointer that is mid-drag. Hovering also keeps a dense grid readable: the
// explanations are worth having and worth not reading forty at a time.
export interface GameCard {
  key: string
  label: string
  value: string | null
  unit?: string
  reason?: string
  hint?: string
}

// ---- statistics over a selected span ----

// What a dragged-out span held.
//
// # What is here, and what is deliberately not
//
// The FPS figures come from SUMMING the selected seconds' histograms, not from
// averaging their per-second statistics. That is not a refinement, it is the
// only way the figures exist at all: a "1% low" is the slowest one percent of
// frames across the whole span, and a mean of per-second p95s is not that number
// — it is not any number (see protocol/gamesense, FrameTimes).
//
// So there is no mean frame time here, and no p95 or p99. `worstFrameMs` IS
// offered, because a maximum genuinely does combine across seconds — the max of
// maxes is the max — and that is precisely why the percentiles beside it are
// not. If someone later wants a span p95, the answer is another histogram
// figure, never an average of the stored ones.
//
// The machine figures ARE averaged, and the difference is a difference in kind
// rather than in rigour: a CPU percentage is a rate over an interval of equal
// length, so the mean of N of them is the mean over N seconds. A percentile is
// an order statistic over a population, and populations cannot be recombined
// from their summaries.
export interface SelectionStats {
  fromMs: number
  toMs: number
  spanSeconds: number
  // Seconds inside the span that carried frames, which is NOT spanSeconds. The
  // difference is the interruptions, and it is information rather than an
  // inconsistency: a span over a loading screen is ninety seconds long and holds
  // eleven seconds of frames, and a reader told only one of those two numbers
  // draws the wrong conclusion from either.
  frameSeconds: number
  presented: number
  displayed: number | null
  dropped: number | null
  meanFps: number | null
  low1PctFps: number | null
  low01PctFps: number | null
  // The slowest single frame in the span, in ms.
  worstFrameMs: number | null
  stutterCount: number | null
  stutterExcessMs: number | null
  hostCpuMeanPct: number | null
  hostCpuPeakPct: number | null
  hostGpuPeakPct: number | null
  hostMemPeakUsed: number | null
  // The clocks, reported as the LOWEST seen rather than the mean or the peak.
  //
  // A peak clock says the hardware was capable of it, which is never the
  // question a reader has when they drag out a stretch where the frame rate
  // dropped. The floor is: a GPU core clock that fell to half its usual figure
  // inside the selection is the answer, and both a mean and a peak hide it.
  cpuMinMHz: number | null
  gpuMinMHz: number | null
  gpuMemMinMHz: number | null
  // Interruption time inside the span, by reason, in seconds. Clipped to the
  // span: a gap that starts before it or ends after it contributes only the part
  // the reader selected.
  gapBackgroundSeconds: number
  gapNoFramesSeconds: number
  // A second in the span named a histogram layout this build does not know, so
  // the three FPS figures are null rather than computed from the rest. A
  // distribution missing an unknown share of its frames is not the span's.
  layoutUnknown: boolean
}

// selectionStats computes what a span held, from the records already loaded.
//
// Everything is derived client-side rather than asked of the server, because the
// span is a reading gesture: it changes as fast as a pointer moves, and a
// round-trip per drag would make the panel lag the highlight it describes. The
// seconds are already here.
export function selectionStats(
  selection: [number, number],
  buckets: readonly GameBucket[],
  hosts: readonly GameHostSecond[],
  gaps: readonly GameGap[],
): SelectionStats {
  const [fromMs, toMs] = selection
  // Half-open at the start, matching what a bucket's timestamp means: it names
  // the moment the second CLOSED, so the second ending exactly at `from` belongs
  // to whatever came before.
  const inSpan = (ts: string) => {
    const ms = new Date(ts).getTime()
    return ms > fromMs && ms <= toMs
  }

  const picked = buckets.filter((b) => inSpan(b.ts))
  const counts = sumHistograms(picked.map((b) => b.ft_hist))

  let presented = 0
  let displayed = 0
  let dropped = 0
  let sawDisplayed = false
  let sawDropped = false
  let stutterCount = 0
  let stutterExcess = 0
  let sawStutter = false
  let worst: number | null = null
  for (const b of picked) {
    presented += b.frames.presented
    // A count this second could not see is a blind spot in the source, not a
    // zero: it contributes nothing AND leaves the total absent unless some
    // second could see it. The rule is ingest's fold, restated for a span.
    if (b.frames.displayed != null) {
      displayed += b.frames.displayed
      sawDisplayed = true
    }
    if (b.frames.dropped != null) {
      dropped += b.frames.dropped
      sawDropped = true
    }
    // The same rule one measurement further out: a second nothing watched for
    // long frames contributes nothing and leaves the totals absent, while a
    // second that watched and saw none contributes its zero and establishes them.
    if (b.stutter) {
      stutterCount += b.stutter.count
      stutterExcess += b.stutter.excess_ms
      sawStutter = true
    }
    if (worst === null || b.ft.max > worst) worst = b.ft.max
  }

  const pickedHosts = hosts.filter((h) => inSpan(h.ts))
  let cpuSum = 0
  let cpuN = 0
  let cpuPeak: number | null = null
  let gpuPeak: number | null = null
  let memPeak: number | null = null
  let cpuMin: number | null = null
  let gpuMin: number | null = null
  let gpuMemMin: number | null = null
  const lower = (cur: number | null, v: number | null | undefined) =>
    v == null ? cur : cur === null || v < cur ? v : cur
  for (const h of pickedHosts) {
    if (h.cpu) {
      cpuSum += h.cpu.total_pct
      cpuN++
      if (cpuPeak === null || h.cpu.busiest_pct > cpuPeak) cpuPeak = h.cpu.busiest_pct
    }
    const util = h.gpu?.util_pct
    if (util != null && (gpuPeak === null || util > gpuPeak)) gpuPeak = util
    if (h.mem && (memPeak === null || h.mem.used > memPeak)) memPeak = h.mem.used
    // Clocks take the floor, not the peak — see the field comments.
    cpuMin = lower(cpuMin, h.cpu_clock?.current_mhz)
    gpuMin = lower(gpuMin, h.gpu?.core_mhz)
    gpuMemMin = lower(gpuMemMin, h.gpu?.mem_mhz)
  }

  let gapBackground = 0
  let gapNoFrames = 0
  for (const g of gaps) {
    // Clipped to the span rather than counted whole: a reader who selected ten
    // seconds of a fifty-minute absence asked about ten seconds.
    const lo = Math.max(fromMs, new Date(g.started_at).getTime())
    const hi = Math.min(toMs, new Date(g.ended_at).getTime())
    if (hi <= lo) continue
    const secs = (hi - lo) / 1000
    if (g.reason === GAP_NO_FRAMES) gapNoFrames += secs
    else if (g.reason === GAP_BACKGROUND) gapBackground += secs
  }

  return {
    fromMs,
    toMs,
    spanSeconds: Math.round((toMs - fromMs) / 1000),
    frameSeconds: picked.length,
    presented,
    displayed: sawDisplayed ? displayed : null,
    dropped: sawDropped ? dropped : null,
    meanFps: counts && histMeanFPS(counts),
    low1PctFps: counts && histLowFPS(counts, 0.01),
    low01PctFps: counts && histLowFPS(counts, 0.001),
    worstFrameMs: worst,
    stutterCount: sawStutter ? stutterCount : null,
    stutterExcessMs: sawStutter ? stutterExcess : null,
    hostCpuMeanPct: cpuN ? cpuSum / cpuN : null,
    hostCpuPeakPct: cpuPeak,
    hostGpuPeakPct: gpuPeak,
    hostMemPeakUsed: memPeak,
    cpuMinMHz: cpuMin,
    gpuMinMHz: gpuMin,
    gpuMemMinMHz: gpuMemMin,
    gapBackgroundSeconds: Math.round(gapBackground),
    gapNoFramesSeconds: Math.round(gapNoFrames),
    layoutUnknown: counts === null,
  }
}

// MAX_GAP_MARKS bounds how many placeholder points gapMarkerTimes will produce
// across a whole run.
//
// It is above the pixel width of any chart on the page, so hover resolution is
// never what this limit costs. What it protects against is a session that spent
// six hours minimized: at one point a second that is twenty thousand extra
// items per line, on fourteen charts, for a stretch where the answer is one
// sentence that does not change from second to second.
const MAX_GAP_MARKS = 2000

// gapMarkerTimes returns the instants inside gaps that need a placeholder point.
//
// # Why a chart needs points where there is nothing to plot
//
// A gap is drawn as a shaded band and explained by a sentence the tooltip adds
// for the seconds it covers. But an axis tooltip is anchored to DATA: ECharts
// answers a pointer by finding the nearest point in each series and reporting
// that point's time, and a gap contains no points at all. So the pointer inside
// a two-minute band snapped out to the band's edge, the reported time was a
// second outside the gap, and the sentence — which is looked up by time — never
// appeared. The band was a coloured rectangle a reader could not interrogate,
// which is most of the way back to the blank stretch it was added to replace.
//
// A placeholder is a point with a time and no value, which is exactly what those
// seconds are: seconds that happened and were not measured. Adding them is not a
// rendering trick, it is the series finally saying what the gap record already
// says. `connectNulls: false` keeps the line broken across them.
//
// # Resolution
//
// One per second until the total would exceed MAX_GAP_MARKS, then evenly
// coarser. The cost of coarsening is that the tooltip's time is up to half a
// step away from the pointer, and it is charged where it cannot matter: a step
// only widens when there are hours of gaps to cover, and inside an hour-long
// absence the tooltip's subject is the absence rather than the instant.
//
// Every gap gets at least one marker regardless of the step, because a band with
// none is the original defect back again for that band.
export function gapMarkerTimes(gaps: readonly GameGap[], maxTotal = MAX_GAP_MARKS): number[] {
  let seconds = 0
  const spans: [number, number][] = []
  for (const g of gaps) {
    const from = new Date(g.started_at).getTime()
    const to = new Date(g.ended_at).getTime()
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue
    spans.push([from, to])
    seconds += Math.round((to - from) / 1000)
  }
  const step = Math.max(1, Math.ceil(seconds / Math.max(1, maxTotal))) * 1000

  const out: number[] = []
  for (const [from, to] of spans) {
    // From the close of the gap's FIRST covered second, matching the half-open
    // (from, to] a band claims: the instant `from` itself belongs to the second
    // before the gap, which is a second that had frames.
    for (let t = from + 1000; t <= to; t += step) out.push(t)
  }
  out.sort((a, b) => a - b)
  return out
}
