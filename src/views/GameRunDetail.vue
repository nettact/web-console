<script setup lang="ts">
// One game run: its whole-run figures, its per-second frame rate and frame times,
// and what the capture source was able to observe.
//
// The frame counts and the two low-percentile figures are the reason this page is
// careful rather than obvious. Every one of them can be absent, for two unrelated
// reasons — the source could not observe it, or the run held too few frames for
// the figure to mean anything — and both are reported as null. Rendering either as
// 0 would invent an observation: a flawless run that dropped nothing, or a game
// that stuttered to a standstill. So a missing value is a dash carrying its
// reason, and a series the source can never fill is not plotted at all.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  api,
  ApiError,
  CAP_DISPLAYED,
  CAP_FRAME_TYPE,
  CAP_PER_FRAME_COMPLETE,
  CAP_PRESENT_META,
  CAP_PROC_CPU,
  CAP_PROC_MEM,
  CAP_STUTTER,
  GAP_BACKGROUND,
  GAP_NO_FRAMES,
  type GameBucket,
  type GameGap,
  type GameHostSecond,
  type GameRun,
} from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import InfoTip from '../components/InfoTip.vue'
import GameRunChart from '../components/game/GameRunChart.vue'
import GameStatCards from '../components/game/GameStatCards.vue'
import GameValue from '../components/game/GameValue.vue'
import NetworkTimeline from '../components/game/NetworkTimeline.vue'
import { useGameMeta } from '../composables/useGameMeta'
import type { ChartBand } from '../lib/chartBands'
import { covers as coversSelection, type TimeSelection } from '../composables/useChartSelection'
import { useMetricMeta } from '../composables/useMetricMeta'
import {
  bucketsAbsence,
  bucketsTruncated,
  chartFloor,
  diagAbsence,
  DIAG_CAPS,
  gapMarkerTimes,
  isRunning,
  missingCause,
  observes,
  presentCause,
  qualityFlags,
  selectionStats,
  seriesHasValue,
  stutterMarkState,
  stutterPerMinute,
  stutterSeconds,
  type GameCard,
  type GameChartSeries,
  type GameField,
  type GamePoint,
} from '../lib/gameRun'
import { fmtByUnit } from '../lib/format'
import { pushToast } from '../toasts'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { fmtTime } = useMetricMeta()
const {
  bucketsAbsenceText,
  capLabel,
  capDesc,
  fmtCount,
  fmtFps,
  fmtRunDuration,
  graphicsApiLabel,
  missingText,
  presentModeLabel,
  qualityDesc,
  qualityLabel,
  sourceLabel,
} = useGameMeta()

// Six hours of seconds. A longer session comes back clipped and the page says so —
// silently charting the first slice of a run as though it were the whole thing is
// exactly the kind of quiet lie this feature exists to avoid.
const BUCKET_LIMIT = 6 * 3600

// A day of machine seconds — the server's own maximum for the endpoint.
//
// Higher than the bucket limit, and not by oversight. Machine seconds are
// recorded for every second the sensor is watching anything, INCLUDING the ones
// with no frames, so a run left minimised overnight holds far more of them than
// it holds buckets. Sizing this to the bucket limit would clip exactly the runs
// the machine data was added for: the chart window covers the whole run, and the
// curves would stop partway across it with nothing on screen saying why.
const HOST_LIMIT = 86400

const SITE = 'site_default'

const runId = computed(() => String(route.params.id || ''))
const run = ref<GameRun | null>(null)
const buckets = ref<GameBucket[]>([])
// The machine's own seconds over this run's window, and the stretches in which
// the game presented nothing. Neither is per-run data: the machine seconds are
// keyed by (agent, second) and merely read here, and the gaps are the run's but
// exist precisely where its buckets do not.
const hostSeconds = ref<GameHostSecond[]>([])
const gaps = ref<GameGap[]>([])
// The run's profile, when it still exists — only for the monitors it links, which
// decide what the network section charts. The name comes off the run itself, so a
// deleted profile still labels the run correctly.
const profileMonitorIds = ref<string[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notFound = ref(false)

const caps = computed(() => run.value?.caps ?? [])
const reason = (field: GameField) => missingText(missingCause(field, caps.value))

// Monotonic token. The router reuses this component when the id changes, so
// walking from one run to the next leaves the first run's two requests in flight;
// without the token a late reply either restores the run the reader navigated away
// from or pairs the run on screen with the other one's seconds.
let seq = 0
// Whether a load is out. The token above keeps a late reply from landing on the
// wrong run, which is a different job: this one keeps the five-second tick from
// stacking requests behind one slow read of a long session.
let inFlight = false

// quiet is for the background refresh: it re-reads the same run without
// announcing itself.
//
// The visible loading state replaces the WHOLE page with one line of text, which
// is right for a reader who has just arrived and wrong every five seconds after
// that — the charts they were reading would blink out and back on a timer. So a
// quiet pass leaves the page standing and swaps the data underneath it.
async function load(opts: { quiet?: boolean } = {}) {
  const mine = ++seq
  const id = runId.value
  if (!id) return
  // A background tick defers to a read already out; a refresh the reader pressed
  // does not. The token above makes the older reply harmless either way, and a
  // button that silently does nothing because of a tick nobody can see is worse
  // than one duplicate request.
  if (opts.quiet && inFlight) return
  inFlight = true
  if (!opts.quiet) {
    loading.value = true
    notFound.value = false
    error.value = ''
  }
  try {
    const r = await api.gameRun(id)
    const b = await api.gameRunBuckets(id, { limit: BUCKET_LIMIT })
    if (mine !== seq) return
    run.value = r
    buckets.value = b
    hostSeconds.value = []
    gaps.value = []
    profileMonitorIds.value = []
    // The machine's seconds and the run's silences are both supporting evidence:
    // failing to read either leaves the frame charts intact rather than failing
    // the page. An agent too old to send them is the ordinary case for both.
    //
    // Settled independently rather than awaited together, because they are read
    // independently: the gaps shade every chart and the machine seconds draw
    // four of their own, so one failing must not take the other down. Promise.all
    // would discard a successful result alongside a rejected one — a gaps
    // endpoint that 404s would blank the machine charts, which have nothing to do
    // with it.
    //
    // The window is the run's own. `until` is exclusive server-side, so a live
    // run asks up to now and a finished one one second past its end — otherwise
    // the second the run ended in would be the one second of machine data the
    // chart is missing.
    const until = r.ended_at ? new Date(r.ended_at).getTime() : Date.now()
    const [h, g] = await Promise.allSettled([
      api.hostSeconds(r.agent_id, {
        since: Math.floor(new Date(r.started_at).getTime() / 1000),
        until: Math.floor(until / 1000) + 1,
        limit: HOST_LIMIT,
      }),
      api.gameRunGaps(id),
    ])
    if (mine !== seq) return
    if (h.status === 'fulfilled') hostSeconds.value = h.value
    if (g.status === 'fulfilled') gaps.value = g.value
    // The profile's linked monitors are a nice-to-have for the network section:
    // failing to read them falls back to the agent's own monitors rather than
    // failing the page.
    if (r.profile_id) {
      try {
        const list = await api.gameProfiles(SITE)
        if (mine !== seq) return
        profileMonitorIds.value = list.items.find((p) => p.id === r.profile_id)?.monitor_ids ?? []
      } catch {
        /* keep the fallback */
      }
    }
  } catch (e) {
    if (mine !== seq) return
    // A background tick that fails changes nothing on screen. Tearing the run
    // down would replace a page the reader is using with an error raised by a
    // request they never made, and five seconds later the next tick may well
    // succeed — so the stale-but-whole page stands and says nothing.
    //
    // The one exception is a run that has gone: a 404 on a refresh means it was
    // deleted from somewhere else, and continuing to show it is the one outcome
    // worse than an interruption.
    if (e instanceof ApiError && e.status === 404) notFound.value = true
    else if (opts.quiet) return
    else error.value = String((e as Error).message || e)
    run.value = null
    buckets.value = []
    hostSeconds.value = []
    gaps.value = []
    profileMonitorIds.value = []
  } finally {
    inFlight = false
    if (mine === seq && !opts.quiet) loading.value = false
  }
}

// Returning to the list keeps the run's agent selected; the list would otherwise
// fall back to whichever agent happens to be first.
const backLocation = computed(() =>
  run.value ? { path: '/game-performance', query: { agent: run.value.agent_id } } : { path: '/game-performance' },
)

const running = computed(() => (run.value ? isRunning(run.value) : false))
const runTitle = computed(() => run.value?.title?.trim() || '')
const truncated = computed(() => (run.value ? bucketsTruncated(run.value, buckets.value, BUCKET_LIMIT) : false))
const quality = computed(() => qualityFlags(buckets.value))

// The profile this run was captured under. A stamped id whose name no longer
// resolves is a profile that has been deleted since — saying "no profile" there
// would rewrite what was recorded, so it gets its own wording.
const profileDeleted = computed(() => !!run.value?.profile_id && run.value.profile_name === null)

// The window every chart on this page shares. It is the run itself, except on a
// run long enough to come back clipped: then the charts cover the loaded segment,
// and stretching the axis to the run's full length would draw hours of blank as
// though nothing had been measured there.
//
// The floor reaches back to where the first loaded second BEGAN rather than to
// where it closed, so a hitch in that second still has an axis to be shaded on.
const chartWindow = computed<[number, number]>(() => {
  const r = run.value
  const start = r ? chartFloor(new Date(r.started_at).getTime(), buckets.value) : 0
  const end = r ? (r.ended_at ? new Date(r.ended_at).getTime() : Date.now()) : 0
  if (truncated.value && buckets.value.length) {
    return [start, new Date(buckets.value[buckets.value.length - 1].ts).getTime()]
  }
  return [start, Math.max(end, start)]
})

// ---- summary figures ----
const summaryCards = computed<GameCard[]>(() => {
  const r = run.value
  if (!r) return []
  const s = r.summary
  const fps = (v: number | null): GameCard['value'] => (v === null ? null : fmtFps(v))
  return [
    {
      key: 'duration',
      label: t('gameRuns.duration'),
      value: fmtRunDuration(s.duration_seconds),
      // The duration beside it is measured to ended_at, and last_seen_at can sit
      // well before that when tracking stopped without closing a second — footing
      // the figure with the later moment would make the card contradict itself.
      hint: r.ended_at ? t('gameRuns.durationFoot', { time: fmtTime(r.ended_at) }) : t('gameRuns.durationRunningFoot'),
    },
    { key: 'mean', label: t('gameRuns.meanFps'), value: fps(s.mean_fps), unit: 'FPS', reason: reason('fpsStat'), hint: t('gameRuns.meanFpsFoot') },
    { key: 'low1', label: t('gameRuns.low1'), value: fps(s.low_1pct_fps), unit: 'FPS', reason: reason('fpsStat'), hint: t('gameRuns.low1Foot') },
    { key: 'low01', label: t('gameRuns.low01'), value: fps(s.low_0_1pct_fps), unit: 'FPS', reason: reason('fpsStat'), hint: t('gameRuns.low01Foot') },
  ]
})

// ---- frame counts ----
// Whole-run totals from the summary, so they cover the entire run even when the
// charts below show only part of it.
const frameCards = computed<GameCard[]>(() => {
  const s = run.value?.summary
  if (!s) return []
  const dropRate =
    s.dropped === null || s.presented === 0 ? null : `${((s.dropped / s.presented) * 100).toFixed(2)}%`
  return [
    { key: 'presented', label: t('gameRuns.presented'), value: fmtCount(s.presented), hint: t('gameRuns.presentedFoot') },
    {
      key: 'displayed',
      label: t('gameRuns.displayed'),
      value: s.displayed === null ? null : fmtCount(s.displayed),
      reason: reason('displayed'),
      hint: t('gameRuns.displayedFoot'),
    },
    {
      key: 'dropped',
      label: t('gameRuns.dropped'),
      value: s.dropped === null ? null : fmtCount(s.dropped),
      reason: reason('dropped'),
      hint: dropRate === null ? t('gameRuns.droppedFoot') : t('gameRuns.droppedRateFoot', { rate: dropRate }),
    },
  ]
})

// ---- stutter ----
// Whole-run figures, folded in as the seconds landed, so they survive bucket
// retention exactly as the frame totals do. A null count is "nothing watched for
// stutter"; a 0 is a detector that ran and found nothing, which is the good news
// this page must be able to deliver.
const stutterCards = computed<GameCard[]>(() => {
  const r = run.value
  if (!r) return []
  const why = reason('stutter')
  const rate = stutterPerMinute(r.stutter_count, r.summary.duration_seconds)
  return [
    {
      key: 'stutterCount',
      label: t('gameRuns.stutterCount'),
      value: r.stutter_count === null ? null : fmtCount(r.stutter_count),
      reason: why,
      hint: t('gameRuns.stutterCountFoot'),
    },
    {
      key: 'stutterExcess',
      label: t('gameRuns.stutterExcess'),
      // Rounded to the millisecond: the sub-millisecond digit of a sum over
      // hundreds of frames is noise dressed as precision.
      value: r.stutter_excess_ms === null ? null : fmtCount(Math.round(r.stutter_excess_ms)),
      unit: 'ms',
      reason: why,
      hint: t('gameRuns.stutterExcessFoot'),
    },
    {
      key: 'stutterRate',
      label: t('gameRuns.stutterRate'),
      value: rate === null ? null : rate.toFixed(1),
      unit: t('gameRuns.stutterRateUnit'),
      // A count that exists but has no rate is a run with no measured duration,
      // which the capability tooltip would misdescribe as an absent detector.
      reason: r.stutter_count === null ? why : t('gameRuns.stutterRateNoDuration'),
      hint: t('gameRuns.stutterRateFoot'),
    },
  ]
})

// ---- capture source ----
// The diagnostic six are listed last and only ever as a group, because they
// arrive together: a run captured at the base depth declares none of them, and
// the panel showing six crosses in a row is what tells the reader the run was
// recorded shallow rather than that the machine could not manage it.
const CAPS = [
  CAP_DISPLAYED,
  CAP_FRAME_TYPE,
  CAP_PRESENT_META,
  CAP_PER_FRAME_COMPLETE,
  CAP_STUTTER,
  CAP_PROC_CPU,
  CAP_PROC_MEM,
  ...DIAG_CAPS,
]
const capRows = computed(() => CAPS.map((cap) => ({ cap, label: capLabel(cap), desc: capDesc(cap), on: caps.value.includes(cap) })))

// The newest second that carried presentation settings — a run may start windowed
// and end in fullscreen, so this is "how it was presenting most recently" rather
// than "how the run was presented".
//
// The buckets endpoint returns the run's FIRST BUCKET_LIMIT seconds in ascending
// order, so on a run long enough to be clipped the newest loaded second is only
// the newest of the charted segment. The heading follows `truncated` for that
// reason: without it a six-hour-old reading is presented as the state the session
// ended in.
const latestPresent = computed(() => {
  for (let i = buckets.value.length - 1; i >= 0; i--) {
    const p = buckets.value[i].present
    if (p) return p
  }
  return null
})
const presentHeading = computed(() =>
  truncated.value ? t('gameRuns.presentTitleSegment') : t('gameRuns.presentTitle'),
)
// `changed` marks a second the source could not describe with one setting: the
// values are whichever held for most of it. Drawing them like a settled second
// destroys the only evidence that a fullscreen switch or a vsync toggle happened
// there at all.
const presentMixed = computed(() => latestPresent.value?.changed === true)
const presentRows = computed(() => {
  const p = latestPresent.value
  const r = run.value
  const na = r ? missingText(presentCause(r, buckets.value, caps.value)) : ''
  return [
    { key: 'mode', label: t('gameRuns.presentModeLabel'), value: p?.mode ? presentModeLabel(p.mode) : null, reason: na },
    { key: 'api', label: t('gameRuns.apiLabel'), value: p?.api ? graphicsApiLabel(p.api) : null, reason: na },
    {
      key: 'sync',
      // Sync interval 0 is vsync OFF — a real reading, not a missing one, which is
      // why the API models it as a pointer and this must not treat 0 as absent.
      label: t('gameRuns.syncLabel'),
      value: p?.sync == null ? null : p.sync === 0 ? t('gameRuns.vsyncOff') : t('gameRuns.vsyncOn', { n: p.sync }),
      reason: na,
    },
    {
      key: 'tearing',
      label: t('gameRuns.tearingLabel'),
      value: p?.tearing == null ? null : p.tearing ? t('gameRuns.yes') : t('gameRuns.no'),
      reason: na,
    },
  ]
})

// Why there is nothing to chart. A run outlives its seconds by weeks, so an empty
// chart is far more often retention catching up than a session that measured
// nothing.
const bucketsNote = computed(() => (run.value ? bucketsAbsenceText(bucketsAbsence(run.value)) : ''))

// ---- charts ----
const at = (b: GameBucket) => new Date(b.ts).getTime()

// The x positions every bucket-derived chart plots against: one row per second
// there is a bucket for, plus a valueless row for the seconds a gap covers.
//
// The gap rows are what make a shaded band hoverable. An axis tooltip is
// anchored to data, so without them the pointer inside a band snapped out to the
// band's edge and the sentence explaining the band — looked up by time — never
// appeared; see gapMarkerTimes. They carry no value because there is none: those
// seconds happened and were not measured, which is the same thing the gap record
// says and the same null every other unmeasured figure on this page uses.
//
// Built once and shared by every series rather than merged per series: the sort
// is the expensive part and the answer does not differ between them.
//
// Host-derived charts do NOT use this. Machine telemetry is collected right
// through a gap by design, so those seconds already have rows, and inventing
// empty ones beside them would assert a hole that is not there.
const chartRows = computed<{ ts: number; b: GameBucket | null }[]>(() => {
  const rows: { ts: number; b: GameBucket | null }[] = buckets.value.map((b) => ({ ts: at(b), b }))
  const taken = new Set(rows.map((r) => r.ts))
  for (const ts of gapMarkerTimes(gaps.value)) {
    // A gap second has no bucket by definition, so this only ever fires after a
    // clock step has made two records claim one instant. The bucket wins: it has
    // something to say.
    if (!taken.has(ts)) rows.push({ ts, b: null })
  }
  rows.sort((x, y) => x.ts - y.ts)
  return rows
})

const points = (pick: (b: GameBucket) => number | null | undefined): GamePoint[] =>
  chartRows.value.map((r) => [r.ts, r.b ? (pick(r.b) ?? null) : null])

// A bucket is one closed second, so a frame count IS a rate — no division, and no
// invented denominator for a partial second.
const fpsSeries = computed<GameChartSeries[]>(() => {
  const out: GameChartSeries[] = [
    { key: 'presented', label: t('gameRuns.seriesPresented'), color: '#34d399', data: points((b) => b.frames.presented) },
  ]
  if (observes('displayed', caps.value)) {
    out.push({ key: 'displayed', label: t('gameRuns.seriesDisplayed'), color: '#38bdf8', data: points((b) => b.frames.displayed) })
  }
  if (observes('app', caps.value)) {
    out.push({ key: 'app', label: t('gameRuns.seriesApp'), color: '#a78bfa', data: points((b) => b.frames.app) })
  }
  return out
})

const frameTimeSeries = computed<GameChartSeries[]>(() => [
  { key: 'avg', label: t('gameRuns.seriesFtAvg'), color: '#38bdf8', data: points((b) => b.ft.avg) },
  { key: 'p95', label: t('gameRuns.seriesFtP95'), color: '#f472b6', data: points((b) => b.ft.p95) },
  { key: 'p99', label: t('gameRuns.seriesFtP99'), color: '#fbbf24', data: points((b) => b.ft.p99) },
])

// Series the source can never fill are absent from the chart entirely; the caption
// says which ones and why, so a two-line chart is not read as a three-line chart
// with one line flat at zero.
const fpsCaption = computed(() => {
  const missing: string[] = []
  if (!observes('displayed', caps.value)) missing.push(t('gameRuns.seriesDisplayed'))
  if (!observes('app', caps.value)) missing.push(t('gameRuns.seriesApp'))
  if (!missing.length) return ''
  return t('gameRuns.seriesUnavailable', { series: missing.join(t('gameRuns.listSep')) })
})

// The seconds that hitched, shaded behind the frame-time lines. They belong on
// THAT chart because a stutter is a long frame: the band and the P99 spike under
// it are the same event, and seeing them together is what tells a reader whether
// a tall p99 was one bad frame or a second of them.
const stutterMarks = computed<ChartBand[]>(() => {
  if (!observes('stutter', caps.value)) return []
  return stutterSeconds(buckets.value).map((s) => ({
    kind: 'stutter' as const,
    from: s.from,
    to: s.to,
    // A continuation second carries cost but no event of its own — the freeze
    // began before it. Printing "0 stutters" over a shaded band would have the
    // tooltip contradict the shading.
    text:
      s.kind === 'start'
        ? t('gameRuns.stutterMarkTip', { count: s.count, ms: Math.round(s.excessMs) })
        : t('gameRuns.stutterMarkTipCont', { ms: Math.round(s.excessMs) }),
  }))
})

// The stretches the game presented nothing in, shaded on EVERY chart rather
// than on one.
//
// That is the whole point of them. A blank stretch appears identically on the
// frame charts, the machine charts and the network timeline, and a reader
// looking at any one of them has to be able to tell "the game was minimized"
// from "the data is missing". Shading it in one place would answer the question
// only for whoever happened to be looking at that chart.
//
// A reason this build does not recognize is still drawn, unlabelled. The stretch
// happened either way, and hiding it puts back the blank the record removes.
const gapBands = computed<ChartBand[]>(() =>
  gaps.value.map((g) => {
    const from = new Date(g.started_at).getTime()
    const to = new Date(g.ended_at).getTime()
    const seconds = Math.max(1, Math.round((to - from) / 1000))
    if (g.reason === GAP_BACKGROUND) {
      return { kind: 'gapBackground' as const, from, to, text: t('gameRuns.gapBackgroundTip', { seconds }) }
    }
    if (g.reason === GAP_NO_FRAMES) {
      return { kind: 'gapNoFrames' as const, from, to, text: t('gameRuns.gapNoFramesTip', { seconds }) }
    }
    return { kind: 'gapUnknown' as const, from, to, text: t('gameRuns.gapUnknownTip', { seconds }) }
  }),
)

// Every chart shades the gaps; the frame-time chart additionally shades the
// seconds that hitched, because a stutter IS a long frame and the band and the
// P99 spike under it are the same event.
const allBands = computed<ChartBand[]>(() => gapBands.value)
const frameTimeBands = computed<ChartBand[]>(() => [...gapBands.value, ...stutterMarks.value])

// What the shading means, said once above the charts rather than repeated in
// every caption. Only the kinds actually present are explained: a legend
// entry for a band that is not on screen sends a reader hunting for it.
const gapLegend = computed(() => {
  const kinds = new Set(gapBands.value.map((b) => b.kind))
  const parts: string[] = []
  if (kinds.has('gapBackground')) parts.push(t('gameRuns.gapLegendBackground'))
  if (kinds.has('gapNoFrames')) parts.push(t('gameRuns.gapLegendNoFrames'))
  if (kinds.has('gapUnknown')) parts.push(t('gameRuns.gapLegendUnknown'))
  if (!parts.length) return ''
  return t('gameRuns.gapLegend', { kinds: parts.join(t('gameRuns.listSep')) })
})

// An unshaded chart has several meanings and only one of them is "the run was
// smooth". Reading the loaded buckets alone would declare a clipped run smooth
// while the cards above it count hundreds of hitches that happened past the last
// second on screen, so the state comes off the whole-run count instead.
const frameTimeCaption = computed(() => {
  const base = t('gameRuns.frameTimeCaption')
  const r = run.value
  if (!r) return base
  switch (stutterMarkState(r, stutterMarks.value.length, caps.value)) {
    case 'unwatched':
      return base
    case 'marked':
      return `${base} ${t('gameRuns.stutterMarkCaption')}`
    case 'smooth':
      return `${base} ${t('gameRuns.stutterMarkNone')}`
    case 'elsewhere':
      // Clipping is the ordinary cause and the actionable one — the rest of the
      // run is a fetch away. Without it, the seconds are simply gone.
      return `${base} ${truncated.value ? t('gameRuns.stutterMarkOutsideSegment') : t('gameRuns.stutterMarkNoDetail')}`
    default:
      return `${base} ${t('gameRuns.stutterMarkNotRecorded')}`
  }
})

// ---- process resources ----
// What the frame data cannot answer: whether a bad second was the game running
// out of room, or something else on the machine taking it.
const procCpuSeries = computed<GameChartSeries[]>(() => [
  { key: 'cpu', label: t('gameRuns.seriesProcCpu'), color: '#f472b6', data: points((b) => b.proc_res?.cpu_pct) },
])
const procMemSeries = computed<GameChartSeries[]>(() => [
  { key: 'ws', label: t('gameRuns.seriesWorkingSet'), color: '#38bdf8', data: points((b) => b.proc_res?.ws_bytes) },
  { key: 'priv', label: t('gameRuns.seriesPrivBytes'), color: '#a78bfa', data: points((b) => b.proc_res?.priv_bytes) },
])
const showProcCpu = computed(() => observes('procCpu', caps.value))
const showProcMem = computed(() => observes('procWs', caps.value))

// A declared capability that no second filled still gets a chart — the axis is
// the evidence that it was asked for — but the caption says why it is empty
// rather than leaving a blank plot to be read as a flat zero.
//
// seriesHasValue can only see the seconds this page fetched, so on a clipped run
// "no second of this run carried it" is a claim the page is not entitled to
// make: the hours it did not load may be full of readings. The wording narrows
// to the loaded segment exactly when the coverage does.
const chartEmptyText = () =>
  truncated.value ? t('gameRuns.chartNotRecordedSegment') : t('gameRuns.chartNotRecorded')

// The caption under a chart the source declared it could fill: the sentence
// explaining what the lines mean when they are there, and the reason for the
// blank when they are not. A chart missing only SOME of its lines names them,
// because a legend entry above an undrawn line is read as a line at zero that
// the eye missed.
function chartCaption(series: readonly GameChartSeries[], text: string): string {
  const gone = series.filter((s) => !seriesHasValue(s.data))
  if (!gone.length) return text
  if (gone.length === series.length) return chartEmptyText()
  const names = gone.map((s) => s.label).join(t('gameRuns.listSep'))
  return truncated.value
    ? t('gameRuns.seriesNotRecordedSegment', { series: names })
    : t('gameRuns.seriesNotRecorded', { series: names })
}

const procCpuCaption = computed(() => chartCaption(procCpuSeries.value, t('gameRuns.procCpuCaption')))
const procMemCaption = computed(() => chartCaption(procMemSeries.value, t('gameRuns.procMemCaption')))

// With neither capability there is no chart at all, and an unexplained gap
// between the frame charts and the network timeline reads as a page that forgot
// something. The capture-source panel above lists them; this says it where the
// charts would have been.
const procUnavailable = computed(() => {
  const missing: string[] = []
  if (!showProcCpu.value) missing.push(capLabel(CAP_PROC_CPU))
  if (!showProcMem.value) missing.push(capLabel(CAP_PROC_MEM))
  if (!missing.length) return ''
  return t('gameRuns.chartUnavailable', { series: missing.join(t('gameRuns.listSep')) })
})

// ---- diagnostic detail ----
// Only a run captured at the diagnostic depth carries any of this, and every
// family is gated on its own capability rather than on one "diag" flag. The
// mixed case is the ordinary one: a machine whose driver publishes no adapter
// telemetry still produced the per-frame breakdown, and drawing neither would
// blame a working sensor for a missing driver.
//
// The frame-derived breakdowns below aggregate the same frames `ft` does, so
// they line up second for second with the frame-time chart above them — which is
// the entire point of reading them together.
const cpuSplitSeries = computed<GameChartSeries[]>(() => [
  { key: 'busyAvg', label: t('gameRuns.seriesCpuBusyAvg'), color: '#38bdf8', data: points((b) => b.cpu_split?.busy_avg) },
  { key: 'busyP95', label: t('gameRuns.seriesCpuBusyP95'), color: '#f472b6', data: points((b) => b.cpu_split?.busy_p95) },
  { key: 'waitAvg', label: t('gameRuns.seriesCpuWaitAvg'), color: '#a78bfa', data: points((b) => b.cpu_split?.wait_avg) },
  { key: 'waitP95', label: t('gameRuns.seriesCpuWaitP95'), color: '#fbbf24', data: points((b) => b.cpu_split?.wait_p95) },
])
const gpuSplitSeries = computed<GameChartSeries[]>(() => [
  { key: 'timeAvg', label: t('gameRuns.seriesGpuTimeAvg'), color: '#38bdf8', data: points((b) => b.gpu_split?.time_avg) },
  { key: 'timeP95', label: t('gameRuns.seriesGpuTimeP95'), color: '#f472b6', data: points((b) => b.gpu_split?.time_p95) },
  { key: 'busyAvg', label: t('gameRuns.seriesGpuBusyAvg'), color: '#34d399', data: points((b) => b.gpu_split?.busy_avg) },
  { key: 'busyP95', label: t('gameRuns.seriesGpuBusyP95'), color: '#fbbf24', data: points((b) => b.gpu_split?.busy_p95) },
  { key: 'latencyAvg', label: t('gameRuns.seriesGpuLatencyAvg'), color: '#a78bfa', data: points((b) => b.gpu_split?.latency_avg) },
  { key: 'waitAvg', label: t('gameRuns.seriesGpuWaitAvg'), color: '#fb923c', data: points((b) => b.gpu_split?.wait_avg) },
])
// The present path, charted apart from the GPU breakdown it travels with: these
// two answer "what did the presentation path cost" rather than "how long did the
// GPU work", and six lines plus these two on one axis would be unreadable.
const presentChainSeries = computed<GameChartSeries[]>(() => [
  { key: 'inPresent', label: t('gameRuns.seriesInPresent'), color: '#38bdf8', data: points((b) => b.gpu_split?.in_present_avg) },
  { key: 'renderLatency', label: t('gameRuns.seriesRenderLatency'), color: '#a78bfa', data: points((b) => b.gpu_split?.render_latency_avg) },
])
const latencySeries = computed<GameChartSeries[]>(() => [
  { key: 'display', label: t('gameRuns.seriesDisplayLatency'), color: '#38bdf8', data: points((b) => b.lat?.display_avg) },
  { key: 'animAvg', label: t('gameRuns.seriesAnimErrAvg'), color: '#a78bfa', data: points((b) => b.lat?.anim_err_avg) },
  { key: 'animP95', label: t('gameRuns.seriesAnimErrP95'), color: '#f472b6', data: points((b) => b.lat?.anim_err_p95) },
])
// The game's own dedicated video memory against the budget the OS grants it.
// Budget is optional even on a source that reports usage, so the caption names
// it when it is missing rather than leaving a legend entry with no line.
const procVramSeries = computed<GameChartSeries[]>(() => [
  { key: 'used', label: t('gameRuns.seriesProcVramUsed'), color: '#38bdf8', data: points((b) => b.proc_vram?.used) },
  { key: 'budget', label: t('gameRuns.seriesProcVramBudget'), color: '#94a3b8', data: points((b) => b.proc_vram?.budget) },
])

const showCpuSplit = computed(() => observes('cpuSplit', caps.value))
// The presentation chain travels in the GPU breakdown block, so one capability
// decides both charts.
const showGpuSplit = computed(() => observes('gpuSplit', caps.value))
const showLatency = computed(() => observes('displayLatency', caps.value))
const showProcVram = computed(() => observes('procVram', caps.value))

const cpuSplitCaption = computed(() => chartCaption(cpuSplitSeries.value, t('gameRuns.cpuSplitCaption')))
const gpuSplitCaption = computed(() => chartCaption(gpuSplitSeries.value, t('gameRuns.gpuSplitCaption')))
const presentChainCaption = computed(() =>
  chartCaption(presentChainSeries.value, t('gameRuns.presentChainCaption')),
)
const latencyCaption = computed(() => chartCaption(latencySeries.value, t('gameRuns.latencyCaption')))
const procVramCaption = computed(() => chartCaption(procVramSeries.value, t('gameRuns.procVramCaption')))

// ---- the machine underneath the run ----
//
// These come from a different stream and are drawn on a different rule from
// everything above. They are keyed by (agent, second) rather than by this run, so
// they exist for the seconds the game drew nothing in — the alt-tabbed minute,
// the loading screen — which is exactly where the frame charts go blank and a
// reader most wants to know what the box was doing.
//
// Whether to draw one is therefore NOT a capability question. There is no run
// capability that could promise or deny them, so the test is whether the window
// actually holds a reading: NULL means not measured, and a series of nothing but
// nulls means the machine never answered. That is a stronger test than a
// capability anyway — a capability says the sensor meant to collect something.
const hostAt = (h: GameHostSecond) => new Date(h.ts).getTime()
const hostPoints = (pick: (h: GameHostSecond) => number | null | undefined): GamePoint[] =>
  hostSeconds.value.map((h) => [hostAt(h), pick(h) ?? null])

// The two CPU figures are drawn together because either alone misleads. A
// single-threaded game pins one core at 100% while a sixteen-thread machine
// reads 6% busy: the total alone says the box is idle while the game is starved,
// and the busiest alone says it is saturated while fifteen cores sit free. The
// GAP between the lines is the finding.
const hostCpuSeries = computed<GameChartSeries[]>(() => [
  { key: 'total', label: t('gameRuns.seriesHostCpuTotal'), color: '#38bdf8', data: hostPoints((h) => h.cpu?.total_pct) },
  { key: 'busiest', label: t('gameRuns.seriesHostCpuBusiest'), color: '#f472b6', data: hostPoints((h) => h.cpu?.busiest_pct) },
])
// Installed capacity is drawn beside what is in use, because it is what makes
// the level readable: 12 GB in use means opposite things on a 16 GB and a 32 GB
// machine, and a flat capacity line is what a reader measures the other against.
const hostMemSeries = computed<GameChartSeries[]>(() => [
  { key: 'used', label: t('gameRuns.seriesHostMemUsed'), color: '#38bdf8', data: hostPoints((h) => h.mem?.used) },
  { key: 'total', label: t('gameRuns.seriesHostMemTotal'), color: '#94a3b8', data: hostPoints((h) => h.mem?.total) },
])
// Whole-adapter telemetry. Every label on these two charts says so, because the
// figure the reader will otherwise take away is "the game used 98% of the GPU" —
// a claim this reading cannot make about any single process.
const gpuUtilSeries = computed<GameChartSeries[]>(() => [
  { key: 'util', label: t('gameRuns.seriesGpuUtil'), color: '#34d399', data: hostPoints((h) => h.gpu?.util_pct) },
])
const gpuMemSeries = computed<GameChartSeries[]>(() => [
  { key: 'used', label: t('gameRuns.seriesGpuMemUsed'), color: '#38bdf8', data: hostPoints((h) => h.gpu?.mem_used) },
  { key: 'size', label: t('gameRuns.seriesGpuMemSize'), color: '#94a3b8', data: hostPoints((h) => h.gpu?.mem_size) },
])

// The clocks, all three on one chart.
//
// Together rather than apart because the reading is a comparison: a frame rate
// that fell while the GPU core clock fell with it is a card that ran out of
// headroom, and one that fell while every clock held is something else entirely.
// Splitting them across three charts would put the three lines a reader has to
// compare on three different axes.
//
// The processor's nominal maximum is drawn as a flat reference rather than left
// to a caption, because that is what makes the current clock mean something: a
// line at 3.2 GHz is a processor coasting or one pinned at its ceiling, and only
// the pair says which. A current line ABOVE it is boost, not an error.
const clockSeries = computed<GameChartSeries[]>(() => [
  { key: 'cpu', label: t('gameRuns.seriesCpuClock'), color: '#f472b6', data: hostPoints((h) => h.cpu_clock?.current_mhz) },
  { key: 'cpuMax', label: t('gameRuns.seriesCpuClockMax'), color: '#94a3b8', data: hostPoints((h) => h.cpu_clock?.max_mhz) },
  { key: 'gpuCore', label: t('gameRuns.seriesGpuClock'), color: '#34d399', data: hostPoints((h) => h.gpu?.core_mhz) },
  { key: 'gpuMem', label: t('gameRuns.seriesGpuMemClock'), color: '#a78bfa', data: hostPoints((h) => h.gpu?.mem_mhz) },
])

const drawn = (series: readonly GameChartSeries[]) => series.some((s) => seriesHasValue(s.data))
const showHostCpu = computed(() => drawn(hostCpuSeries.value))
const showHostMem = computed(() => drawn(hostMemSeries.value))
const showGpuTel = computed(() => drawn(gpuUtilSeries.value) || drawn(gpuMemSeries.value))
const showClocks = computed(() => drawn(clockSeries.value))

const hostCpuCaption = computed(() => chartCaption(hostCpuSeries.value, t('gameRuns.hostCpuCaption')))
const hostMemCaption = computed(() => chartCaption(hostMemSeries.value, t('gameRuns.hostMemCaption')))
const gpuUtilCaption = computed(() => chartCaption(gpuUtilSeries.value, t('gameRuns.gpuUtilCaption')))
const gpuMemCaption = computed(() => chartCaption(gpuMemSeries.value, t('gameRuns.gpuMemCaption')))
const clockCaption = computed(() => chartCaption(clockSeries.value, t('gameRuns.clockCaption')))

// Nothing at all from the machine stream. It is a different sentence from an
// empty chart: the readings are not a run capability, so the capture-source panel
// above says nothing about them and a reader has no other way to learn why the
// section is absent. The likeliest causes are an agent too old to send them and a
// window whose seconds have aged out of the retention.
const hostUnavailable = computed(() => {
  if (showHostCpu.value || showHostMem.value || showGpuTel.value || showClocks.value) return ''
  return t('gameRuns.hostUnavailable')
})

// A run whose machine seconds hit the request cap. The curves then cover the
// first day of a longer window while the axis spans all of it, so they stop
// partway across and the chart looks like a machine that went quiet.
//
// It is its own note rather than the buckets' `truncated`, because the two clip
// at different points: a run left minimised overnight holds a day of machine
// seconds and only minutes of frames, so the frame charts are complete on
// exactly the run where these are not.
const hostTruncated = computed(() => hostSeconds.value.length >= HOST_LIMIT)

// A run recorded at the base depth loses six chart rows at once, and six
// unexplained gaps between the frame charts and the network timeline read as a
// page that failed to load rather than as a run that was never asked for this.
//
// The notice gets its own sentences rather than the chartUnavailable one used
// above, which blames the capture source — the wrong culprit here. It then
// branches on what the run's caps say, because the remediation is different in
// each case and only one of the three is a tier setting. Promising "switch the
// profile to Diagnostic" to a run that WAS captured at the diagnostic depth
// sends the reader to change a setting that is already right, and leaves the
// actual cause — an ungranted game.gpu.read, or a source that did not come up on
// that machine — unmentioned.
const diagUnavailable = computed(() => {
  const state = diagAbsence(caps.value)
  if (state === 'none') return ''
  const series = DIAG_CAPS.filter((c) => !caps.value.includes(c))
    .map(capLabel)
    .join(t('gameRuns.listSep'))
  if (state === 'tier') return t('gameRuns.diagUnavailableTier', { series })
  if (state === 'gpu') return t('gameRuns.diagUnavailableGpu', { series })
  return t('gameRuns.diagUnavailablePartial', { series })
})

// ---- the selected span ----
//
// One ref, owned here and prop-drilled into every chart, which is what makes the
// highlight appear on all of them at once. It matches the chartWindow precedent
// exactly and introduces no state mechanism to a codebase that has deliberately
// avoided one — and its lifetime is the page's, so walking to another run does
// not carry a selection along with it.
const selection = ref<TimeSelection>(null)
watch(runId, () => (selection.value = null))

// Which cards the panel below has, decided by what this RUN holds rather than by
// what the current selection covers.
//
// That distinction is the whole of it. Deciding per selection made the card set
// grow and shrink as the pointer moved — dragging across a gap added two cards,
// dragging past the first machine second added seven — so the grid reflowed on
// every mousemove, the panel changed height, and the charts underneath moved out
// from under the pointer that was drawing the selection.
//
// It is also the rule the rest of this page already follows: a figure the data
// cannot support is a dash carrying its reason, never a removed row. A selection
// holding no machine second says so in the card; it does not delete it.
const hasHostData = computed(() => hostSeconds.value.length > 0)
const hasClockData = computed(() =>
  hostSeconds.value.some((h) => h.cpu_clock != null || h.gpu?.core_mhz != null || h.gpu?.mem_mhz != null),
)
const hasGapData = computed(() => gaps.value.length > 0)

// The span the panel reports on: the reader's selection, or everything loaded.
//
// The panel is permanent rather than appearing with the first drag, so it needs
// something to say when nothing is selected — and "the whole session" is the
// answer that makes the same figures comparable against a stretch picked out of
// it. It also means the panel never changes height, which is the point: one that
// appeared on drag start pushed the charts down under the pointer drawing the
// selection.
//
// The whole-session span is NOT chartWindow. A gap can end after the run's last
// frame, and a live run's machine seconds run past it too; the axis clips both,
// and the figures should not. Reporting a fifty-minute absence as however much
// of it the charts happened to draw is the same mistake as clipping the band.
const statsSpan = computed<[number, number]>(() => {
  if (selection.value) return selection.value
  const ms = (iso: string) => new Date(iso).getTime()
  let [lo, hi] = chartWindow.value
  // Buckets and machine seconds arrive in time order, so the two ends are the
  // whole extent. The floor reaches a second further back because a span is
  // half-open at the start — a record exactly at `lo` would fall outside it.
  const ends = <T extends { ts: string }>(xs: readonly T[]) =>
    xs.length ? ([ms(xs[0].ts) - 1000, ms(xs[xs.length - 1].ts)] as const) : null
  for (const e of [ends(buckets.value), ends(hostSeconds.value)]) {
    if (e) {
      lo = Math.min(lo, e[0])
      hi = Math.max(hi, e[1])
    }
  }
  // Gaps are ordered by start, but a long one can end after a later short one
  // does, so the end has to be searched rather than taken from the last.
  for (const g of gaps.value) {
    lo = Math.min(lo, ms(g.started_at))
    hi = Math.max(hi, ms(g.ended_at))
  }
  return [lo, hi]
})

const selectionCards = computed<GameCard[]>(() => {
  if (!run.value) return []
  const s = selectionStats(statsSpan.value, buckets.value, hostSeconds.value, gaps.value)
  const fps = (v: number | null): string | null => (v === null ? null : fmtFps(v))
  // Why a figure is absent, said once per family. The FPS three share a reason
  // and it is not "the source could not measure it": either the span holds too
  // few frames for the fraction to mean anything, or a second in it used a
  // histogram layout this console cannot read.
  const fpsReason = s.layoutUnknown ? t('gameRuns.selection.layoutUnknown') : t('gameRuns.selection.tooFewFrames')
  const cards: GameCard[] = [
    {
      key: 'span',
      label: t('gameRuns.selection.span'),
      value: fmtRunDuration(s.spanSeconds),
      hint: t('gameRuns.selection.spanHint'),
    },
    {
      key: 'frameSeconds',
      label: t('gameRuns.selection.frameSeconds'),
      value: fmtCount(s.frameSeconds),
      hint: t('gameRuns.selection.frameSecondsFoot', { span: s.spanSeconds }),
    },
    { key: 'mean', label: t('gameRuns.meanFps'), value: fps(s.meanFps), unit: 'FPS', reason: fpsReason },
    { key: 'low1', label: t('gameRuns.low1'), value: fps(s.low1PctFps), unit: 'FPS', reason: fpsReason },
    { key: 'low01', label: t('gameRuns.low01'), value: fps(s.low01PctFps), unit: 'FPS', reason: fpsReason },
    {
      key: 'worst',
      label: t('gameRuns.selection.worstFrame'),
      value: s.worstFrameMs === null ? null : `${s.worstFrameMs.toFixed(1)}`,
      unit: 'ms',
      reason: t('gameRuns.selection.noFrames'),
      hint: t('gameRuns.selection.worstFrameFoot'),
    },
    { key: 'presented', label: t('gameRuns.presented'), value: fmtCount(s.presented) },
  ]
  if (observes('stutter', caps.value)) {
    cards.push({
      key: 'stutter',
      label: t('gameRuns.stutterCount'),
      value: s.stutterCount === null ? null : fmtCount(s.stutterCount),
      reason: reason('stutter'),
      // Always a sentence, never sometimes-absent. A foot that appears and
      // disappears takes a line with it, which changes the row's height for the
      // same reason a changing card count changed the grid's.
      hint:
        s.stutterExcessMs === null
          ? t('gameRuns.selection.stutterExcessUnknown')
          : t('gameRuns.selection.stutterExcess', { ms: Math.round(s.stutterExcessMs) }),
    })
  }
  // The machine's side of the same span. Present whenever the RUN has machine
  // seconds, even where the selection covers none of them — a card that came and
  // went with the pointer is what made the panel jump.
  if (hasHostData.value) {
    cards.push(
      {
        key: 'hostCpu',
        label: t('gameRuns.selection.hostCpuMean'),
        value: s.hostCpuMeanPct === null ? null : s.hostCpuMeanPct.toFixed(1),
        unit: '%',
        reason: t('gameRuns.selection.hostNotRecorded'),
        hint: t('gameRuns.selection.hostCpuMeanFoot'),
      },
      {
        key: 'hostCpuPeak',
        label: t('gameRuns.selection.hostCpuPeak'),
        value: s.hostCpuPeakPct === null ? null : s.hostCpuPeakPct.toFixed(1),
        unit: '%',
        reason: t('gameRuns.selection.hostNotRecorded'),
      },
      {
        key: 'hostGpuPeak',
        label: t('gameRuns.selection.hostGpuPeak'),
        value: s.hostGpuPeakPct === null ? null : s.hostGpuPeakPct.toFixed(1),
        unit: '%',
        reason: t('gameRuns.selection.hostNotRecorded'),
      },
      {
        key: 'hostMemPeak',
        label: t('gameRuns.selection.hostMemPeak'),
        value: s.hostMemPeakUsed === null ? null : fmtByUnit('bytes', s.hostMemPeakUsed),
        reason: t('gameRuns.selection.hostNotRecorded'),
      },
    )
  }
  // The clocks, reported as the LOWEST seen in the span rather than the mean or
  // the peak. A peak says the hardware was capable of it, which is never the
  // question when a reader has just dragged out a stretch where the frame rate
  // dropped; the floor is.
  if (hasClockData.value) {
    const mhz = (v: number | null) => (v === null ? null : Math.round(v).toString())
    cards.push(
      {
        key: 'cpuMin',
        label: t('gameRuns.selection.cpuClockMin'),
        value: mhz(s.cpuMinMHz),
        unit: 'MHz',
        reason: t('gameRuns.selection.hostNotRecorded'),
        hint: t('gameRuns.selection.clockMinFoot'),
      },
      {
        key: 'gpuMin',
        label: t('gameRuns.selection.gpuClockMin'),
        value: mhz(s.gpuMinMHz),
        unit: 'MHz',
        reason: t('gameRuns.selection.hostNotRecorded'),
      },
      {
        key: 'gpuMemMin',
        label: t('gameRuns.selection.gpuMemClockMin'),
        value: mhz(s.gpuMemMinMHz),
        unit: 'MHz',
        reason: t('gameRuns.selection.hostNotRecorded'),
      },
    )
  }
  // Interruptions, shown whenever the run had any at all — including as a zero
  // for a span that holds none.
  //
  // A zero IS the measurement here, not an absence: the gaps are all loaded, so
  // "no time was spent out of the game in this stretch" is something the page
  // knows rather than something it failed to observe. That is what makes it
  // right to keep the card rather than hide it, quite apart from the reflow.
  if (hasGapData.value) {
    cards.push(
      {
        key: 'gapBackground',
        label: t('gameRuns.selection.gapBackground'),
        value: fmtRunDuration(s.gapBackgroundSeconds),
      },
      {
        key: 'gapNoFrames',
        label: t('gameRuns.selection.gapNoFrames'),
        value: fmtRunDuration(s.gapNoFramesSeconds),
      },
    )
  }
  return cards
})

// A span the reader dragged over seconds this page has NOTHING for — past the
// six-hour clip, or before the run began.
//
// All three sources are consulted, not just the buckets. Selecting an alt-tab is
// the case that makes this matter: by definition it holds no bucket, and it is
// also exactly the span whose machine curves and interruption breakdown a reader
// dragged it out to read. A bucket-only test would compute those figures and then
// hide them behind "nothing here", which is both wrong and the opposite of the
// reason gaps are recorded at all.
const selectionEmpty = computed(() => {
  const sel = selection.value
  if (!sel) return false
  if (buckets.value.some((b) => coversSelection(sel, new Date(b.ts).getTime()))) return false
  if (hostSeconds.value.some((h) => coversSelection(sel, new Date(h.ts).getTime()))) return false
  // A gap OVERLAPPING the span counts, rather than one starting inside it: a
  // selection wholly inside a fifty-minute absence contains no gap boundary at
  // all, and that is the most ordinary case there is.
  return !gaps.value.some(
    (g) => new Date(g.started_at).getTime() < sel[1] && new Date(g.ended_at).getTime() > sel[0],
  )
})

// The panel's single subtitle line. It is always exactly one line, whatever it
// says, which is what lets the panel keep one height across every state.
const selectionNote = computed(() => {
  if (!selection.value) return t('gameRuns.selection.hint')
  if (selectionEmpty.value) return t('gameRuns.selection.empty')
  const [from, to] = selection.value
  return `${fmtTime(new Date(from).toISOString())} → ${fmtTime(new Date(to).toISOString())}`
})

// ---- delete ----
const askDelete = ref(false)
async function confirmDelete() {
  const r = run.value
  if (!r) return
  busy.value = true
  try {
    await api.deleteGameRun(r.id)
    pushToast({ tone: 'info', title: t('gameRuns.deleted', { name: runTitle.value || r.proc }) })
    router.push({ path: '/game-performance', query: { agent: r.agent_id } })
  } catch (e) {
    error.value = String((e as Error).message || e)
    askDelete.value = false
  } finally {
    busy.value = false
  }
}

// ---- refreshing ----
//
// Off until asked for, on every run including one still being recorded.
//
// Refreshing this page is not cheap — it re-reads the run, its seconds, its
// silences and the machine's seconds beside them — and it moves what is under
// the reader's pointer: on a live run the axis's right edge is now, so every
// pass shifts fourteen charts. Neither is something to start doing to someone
// who only opened a page. The state the toggle holds is theirs from the first
// press and nothing takes it back, which is the whole reason it is a button
// rather than a rule about running sessions.
const REFRESH_MS = 5000
const autoRefresh = ref(false)

let timer: number | undefined
onMounted(() => {
  load()
  timer = window.setInterval(() => {
    if (autoRefresh.value) load({ quiet: true })
  }, REFRESH_MS)
})
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
// The toggle carries across, unreset: it is a decision about how the reader
// wants to work, not a fact about the run they happen to be on.
watch(runId, () => load())
</script>

<template>
  <main class="page data-workbench">
    <RouterLink class="back-link" :to="backLocation">← {{ t('gameRuns.backToList') }}</RouterLink>

    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <div v-if="loading" class="card page-message">{{ t('common.loading') }}</div>

    <div v-else-if="notFound" class="card page-message">
      <h2>{{ t('gameRuns.notFound') }}</h2>
      <p>{{ t('gameRuns.notFoundHint') }}</p>
      <RouterLink class="btn btn-primary" to="/game-performance">{{ t('gameRuns.backToList') }}</RouterLink>
    </div>

    <template v-else-if="run">
      <header class="page-head run-head">
        <div class="run-id">
          <p class="eyebrow">{{ t('gameRuns.eyebrow') }}</p>
          <h1>{{ runTitle || t('gameRuns.untitled') }}</h1>
          <p class="profile-line">
            <span class="profile-key">{{ t('gameRuns.profileLabel') }}</span>
            <span v-if="run.profile_name" class="profile-name">{{ run.profile_name }}</span>
            <span v-else-if="profileDeleted" class="profile-missing">
              {{ t('gameRuns.profileDeleted') }}<InfoTip :text="t('gameRuns.profileDeletedHint')" />
            </span>
            <span v-else class="profile-missing">
              {{ t('gameRuns.profileNone') }}<InfoTip :text="t('gameRuns.profileNoneHint')" />
            </span>
          </p>
          <p class="sub">
            <span class="mono">{{ run.proc }}</span>
            <span class="sep">·</span>
            <span>{{ fmtTime(run.started_at) }}</span>
            <span class="sep">→</span>
            <span v-if="run.ended_at">{{ fmtTime(run.ended_at) }}</span>
            <span v-else class="live">{{ t('gameRuns.stillRunning') }}</span>
          </p>
        </div>
        <div class="run-actions">
          <span class="badge" :class="running ? 'up' : 'neutral'">
            {{ running ? t('gameRuns.stateRunning') : t('gameRuns.stateFinished') }}
          </span>
          <!-- A run still being recorded cannot be removed: the agent keeps
               uploading the live session and the server upserts the row straight
               back, so the delete would appear to work and then hand back the
               same run holding only its last few seconds. -->
          <button class="btn" :disabled="loading" @click="load()">
            {{ t('common.refresh') }}
          </button>
          <button
            class="btn auto-refresh"
            :class="{ active: autoRefresh }"
            :aria-pressed="autoRefresh"
            @click="autoRefresh = !autoRefresh"
          >
            {{ autoRefresh ? t('gameRuns.autoRefreshOn') : t('gameRuns.autoRefreshOff') }}
          </button>
          <InfoTip :text="t('gameRuns.autoRefreshHint')" />
          <button class="btn btn-danger" :disabled="busy || running" @click="askDelete = true">
            {{ t('common.delete') }}
          </button>
          <InfoTip v-if="running" :text="t('gameRuns.deleteWhileRunning')" />
        </div>
      </header>

      <p v-if="truncated" class="hint notice">{{ t('gameRuns.truncated', { n: buckets.length }) }}</p>

      <GameStatCards :cards="summaryCards" />

      <section class="panel counts-panel" aria-labelledby="game-counts-title">
        <div class="panel-head">
          <h3 id="game-counts-title">{{ t('gameRuns.frameCounts') }}</h3>
        </div>
        <p class="hint panel-hint">{{ t('gameRuns.frameCountsHint') }}</p>
        <GameStatCards :cards="frameCards" />
      </section>

      <section class="panel counts-panel" aria-labelledby="game-stutter-title">
        <div class="panel-head">
          <h3 id="game-stutter-title">{{ t('gameRuns.stutterTitle') }}</h3>
        </div>
        <p class="hint panel-hint">{{ t('gameRuns.stutterHint') }}</p>
        <GameStatCards :cards="stutterCards" />
      </section>

      <section class="panel source-panel" aria-labelledby="game-source-title">
        <div class="panel-head">
          <h3 id="game-source-title">{{ t('gameRuns.captureSource') }}</h3>
          <span class="source-name">{{ run.source ? sourceLabel(run.source) : t('gameRuns.sourceUnknown') }}</span>
        </div>
        <p class="hint panel-hint">{{ t('gameRuns.captureSourceHint') }}</p>
        <ul class="cap-list">
          <li v-for="c in capRows" :key="c.cap" :class="{ off: !c.on }">
            <span class="cap-mark" aria-hidden="true">{{ c.on ? '✓' : '×' }}</span>
            <span class="cap-name">{{ c.label }}<InfoTip :text="c.desc" /></span>
            <span class="cap-state">{{ c.on ? t('gameRuns.capObserved') : t('gameRuns.capNotObserved') }}</span>
          </li>
        </ul>
        <h4 class="sub-head">{{ presentHeading }}</h4>
        <p v-if="truncated" class="hint present-note">{{ t('gameRuns.presentSegmentHint', { n: buckets.length }) }}</p>
        <p v-if="presentMixed" class="hint present-note">
          <span class="mixed-flag">{{ t('gameRuns.presentMixed') }}</span>
          {{ t('gameRuns.presentMixedHint') }}
        </p>
        <dl class="present-grid">
          <template v-for="p in presentRows" :key="p.key">
            <dt>{{ p.label }}</dt>
            <dd><GameValue :value="p.value" :reason="p.reason" /></dd>
          </template>
        </dl>
        <p v-if="quality.length" class="hint quality">
          {{ t('gameRuns.qualityNote') }}
          <span v-for="q in quality" :key="q" class="quality-flag">
            {{ qualityLabel(q) }}<InfoTip :text="qualityDesc(q)" />
          </span>
        </p>
      </section>

      <!-- What the shading means, said once. It belongs above the charts rather
           than in each caption because the bands are on ALL of them — that is
           the point of them: a blank stretch looks identical on the frame
           charts, the machine charts and the network timeline, and a reader
           looking at any one has to be able to tell "the game was minimised"
           from "the data is missing". -->
      <p v-if="gapLegend" class="hint">{{ gapLegend }}</p>

      <!-- The figures for whatever the reader has picked out, or for the whole
           session when they have picked nothing.

           Permanent rather than appearing with the first drag, and above the
           charts rather than below them: it has to be on screen while the
           selection is still being adjusted, and a panel that appeared at drag
           start pushed the charts down under the pointer drawing on them. Every
           part of it holds one fixed height for the same reason — the card set
           comes from the run rather than the span, the explanations hover, and
           the note below is one line in all three of its states. -->
      <section class="card selection-panel">
        <div class="selection-head">
          <h2>{{ selection ? t('gameRuns.selection.title') : t('gameRuns.selection.titleAll') }}</h2>
          <!-- Hidden rather than removed when there is nothing to clear, so the
               header keeps its height. visibility also takes it out of the tab
               order, which a disabled button that does nothing would not. -->
          <button type="button" class="btn ghost" :class="{ hidden: !selection }" @click="selection = null">
            {{ t('gameRuns.selection.clear') }}
          </button>
        </div>
        <p class="hint selection-note">{{ selectionNote }}</p>
        <GameStatCards :cards="selectionCards" />
      </section>

      <template v-if="buckets.length">
        <div class="card chart-card">
          <GameRunChart
            :title="t('gameRuns.fpsChart')"
            unit="FPS"
            :series="fpsSeries"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
            :bands="allBands"
            v-model:selection="selection"
          />
          <p v-if="fpsCaption" class="chart-caption">{{ fpsCaption }}</p>
        </div>

        <div class="card chart-card">
          <GameRunChart
            :title="t('gameRuns.frameTimeChart')"
            unit="ms"
            :series="frameTimeSeries"
            :bands="frameTimeBands"
            v-model:selection="selection"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
          />
          <p class="chart-caption">{{ frameTimeCaption }}</p>
        </div>

        <!-- The diagnostic breakdown of the frame times above. Same seconds,
             same frames, one axis apart — which is what lets a spike in the
             chart above be read off against what the CPU and the GPU were each
             doing in that second. -->
        <div v-if="showCpuSplit" class="card chart-card">
          <GameRunChart
            :title="t('gameRuns.cpuSplitChart')"
            unit="ms"
            :series="cpuSplitSeries"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
            :bands="allBands"
            v-model:selection="selection"
          />
          <p class="chart-caption">{{ cpuSplitCaption }}</p>
        </div>

        <div v-if="showGpuSplit" class="card chart-card">
          <GameRunChart
            :title="t('gameRuns.gpuSplitChart')"
            unit="ms"
            :series="gpuSplitSeries"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
            :bands="allBands"
            v-model:selection="selection"
          />
          <p class="chart-caption">{{ gpuSplitCaption }}</p>
        </div>

        <div v-if="showGpuSplit" class="card chart-card">
          <GameRunChart
            :title="t('gameRuns.presentChainChart')"
            unit="ms"
            :series="presentChainSeries"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
            :bands="allBands"
            v-model:selection="selection"
          />
          <p class="chart-caption">{{ presentChainCaption }}</p>
        </div>

        <!-- Titled as an estimate everywhere it appears. It is derived from the
             presentation model rather than measured end to end, and a number
             this page presents as "latency" without that word is the exact
             overclaim the product rule forbids. -->
        <div v-if="showLatency" class="card chart-card">
          <GameRunChart
            :title="t('gameRuns.latencyChart')"
            unit="ms"
            :series="latencySeries"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
            :bands="allBands"
            v-model:selection="selection"
          />
          <p class="chart-caption">{{ latencyCaption }}</p>
        </div>

        <div v-if="showProcCpu" class="card chart-card">
          <!-- Pinned to 0-100 because the figure is a share of the whole
               machine: auto-scaling a game using 12% of it to fill the plot
               would draw the same picture as one using 90%. -->
          <GameRunChart
            :title="t('gameRuns.procCpuChart')"
            unit="%"
            :series="procCpuSeries"
            :y-min="0"
            :y-max="100"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
            :bands="allBands"
            v-model:selection="selection"
          />
          <p class="chart-caption">{{ procCpuCaption }}</p>
        </div>

        <div v-if="showProcMem" class="card chart-card">
          <GameRunChart
            :title="t('gameRuns.procMemChart')"
            unit="bytes"
            :series="procMemSeries"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
            :bands="allBands"
            v-model:selection="selection"
          />
          <p class="chart-caption">{{ procMemCaption }}</p>
        </div>

        <!-- The other video-memory question, and a separate reading: what this
             game is holding, against the budget the OS grants it. A full card
             says nothing about which process filled it. -->
        <div v-if="showProcVram" class="card chart-card">
          <GameRunChart
            :title="t('gameRuns.procVramChart')"
            unit="bytes"
            :series="procVramSeries"
            :x-min="chartWindow[0]"
            :x-max="chartWindow[1]"
            :bands="allBands"
            v-model:selection="selection"
          />
          <p class="chart-caption">{{ procVramCaption }}</p>
        </div>

        <p v-if="procUnavailable" class="hint notice">{{ procUnavailable }}</p>
        <p v-if="diagUnavailable" class="hint notice">{{ diagUnavailable }}</p>
      </template>
      <p v-else class="hint notice">{{ bucketsNote }}</p>

      <!-- The machine underneath the run.
           Outside the buckets template on purpose: these seconds are the agent's
           rather than this run's, so a run whose own seconds aged out — or one
           spent mostly minimized, which produces no buckets at all — can still be
           read against what the box was doing. -->
      <h2 class="section-title">{{ t('gameRuns.hostTitle') }}</h2>
      <p class="hint">{{ t('gameRuns.hostHint') }}</p>
      <p v-if="hostTruncated" class="hint notice">{{ t('gameRuns.hostTruncated') }}</p>

      <div v-if="showHostCpu" class="card chart-card">
        <!-- Pinned to 0-100 because the figure is a share of the whole machine:
             auto-scaling a box at 12% to fill the plot would draw the same
             picture as one at 90%. -->
        <GameRunChart
          :title="t('gameRuns.hostCpuChart')"
          unit="%"
          :series="hostCpuSeries"
          :y-min="0"
          :y-max="100"
          :x-min="chartWindow[0]"
          :x-max="chartWindow[1]"
          :bands="allBands"
            v-model:selection="selection"
        />
        <p class="chart-caption">{{ hostCpuCaption }}</p>
      </div>

      <div v-if="showHostMem" class="card chart-card">
        <GameRunChart
          :title="t('gameRuns.hostMemChart')"
          unit="bytes"
          :series="hostMemSeries"
          :x-min="chartWindow[0]"
          :x-max="chartWindow[1]"
          :bands="allBands"
            v-model:selection="selection"
        />
        <p class="chart-caption">{{ hostMemCaption }}</p>
      </div>

      <!-- Whole-GPU, and the title says so. Pinned to 0-100 for the same reason
           the machine CPU chart is. -->
      <div v-if="showGpuTel" class="card chart-card">
        <GameRunChart
          :title="t('gameRuns.gpuUtilChart')"
          unit="%"
          :series="gpuUtilSeries"
          :y-min="0"
          :y-max="100"
          :x-min="chartWindow[0]"
          :x-max="chartWindow[1]"
          :bands="allBands"
            v-model:selection="selection"
        />
        <p class="chart-caption">{{ gpuUtilCaption }}</p>
      </div>

      <div v-if="showGpuTel" class="card chart-card">
        <GameRunChart
          :title="t('gameRuns.gpuMemChart')"
          unit="bytes"
          :series="gpuMemSeries"
          :x-min="chartWindow[0]"
          :x-max="chartWindow[1]"
          :bands="allBands"
            v-model:selection="selection"
        />
        <p class="chart-caption">{{ gpuMemCaption }}</p>
      </div>

      <!-- All three clocks on one axis, because the reading is the comparison
           between them: a frame rate that fell while the GPU core clock fell
           with it is a card out of headroom, and one that fell while every clock
           held is something else. -->
      <div v-if="showClocks" class="card chart-card">
        <GameRunChart
          :title="t('gameRuns.clockChart')"
          unit="MHz"
          :series="clockSeries"
          :x-min="chartWindow[0]"
          :x-max="chartWindow[1]"
          :bands="allBands"
          v-model:selection="selection"
        />
        <p class="chart-caption">{{ clockCaption }}</p>
      </div>

      <p v-if="hostUnavailable" class="hint notice">{{ hostUnavailable }}</p>

      <!-- Joint diagnosis: the same window, the same agent, the network side of
           it. Charted whether or not the frame charts have anything — a run whose
           seconds aged out can still be read against what the network was doing. -->
      <NetworkTimeline
        :agent-id="run.agent_id"
        :start-ms="chartWindow[0]"
        :end-ms="chartWindow[1]"
        :monitor-ids="profileMonitorIds"
        :bands="allBands"
            v-model:selection="selection"
      />

      <ConfirmDialog
        :open="askDelete"
        :title="t('gameRuns.deleteTitle')"
        :message="[t('gameRuns.deleteBody', { name: runTitle || run.proc }), t('gameRuns.deleteIrreversible')]"
        :confirm-label="t('common.delete')"
        :cancel-label="t('gameRuns.cancel')"
        :busy="busy"
        tone="danger"
        @confirm="confirmDelete"
        @cancel="askDelete = false"
      />
    </template>
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Game run detail */
.data-workbench {
  font-variant-numeric: tabular-nums;
}
.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-bottom: var(--space-sm);
  color: var(--color-accent-text);
  font-size: var(--text-sm);
  text-decoration: none;
  white-space: nowrap;
}
.back-link:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
  border-radius: var(--radius-xs);
}
.run-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.run-id {
  flex: 1 1 320px;
  min-width: 0;
}
.eyebrow {
  margin: 0 0 var(--space-2xs);
  color: var(--color-accent-text);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.run-head h1 {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-style: normal;
  letter-spacing: -0.028em;
}
.run-head .sub {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  margin-top: var(--space-2xs);
  color: var(--text-dim);
  font-size: var(--text-sm);
}
.profile-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2xs);
  margin: var(--space-2xs) 0 0;
  font-size: var(--text-sm);
}
.profile-key {
  color: var(--text-muted);
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.profile-name {
  padding: 1px 9px;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-pill);
  background: var(--color-glass-subtle);
  font-weight: 600;
}
.profile-missing {
  color: var(--text-muted);
}
.sep {
  color: var(--text-muted);
}
.live {
  color: var(--color-success-text, var(--color-accent-text));
  font-weight: 600;
}
.run-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
/* The pressed state of the auto-refresh toggle. It reads its own state in words
 * as well, because colour alone would leave the button saying "auto-refresh"
 * whether it was on or off — and the whole question this button answers is
 * which. */
.auto-refresh.active {
  border-color: var(--color-success);
  color: var(--color-success);
}
.notice {
  margin-bottom: var(--space-sm);
  padding: var(--space-2xs) var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-glass-subtle);
}
.panel {
  margin: var(--space-md) 0;
}
.counts-panel,
.source-panel {
  padding-bottom: var(--space-sm);
  background: var(--color-glass-strong);
  border-color: var(--color-rule);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.panel-head h3 {
  font-family: var(--font-display);
  letter-spacing: -0.018em;
}
.source-name {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 13px;
}
.panel-hint {
  margin: 0 18px 10px;
  padding-top: 8px;
}
.panel :deep(.stat-grid) {
  margin: 0 18px;
}
/* As many columns as fit. Each entry is a name and one of two words, so a row
 * to itself left most of the width blank and pushed the eleven of them into a
 * column taller than the panel above it — a reader checking whether one
 * capability was collected had to scroll past the other ten.
 *
 * min(100%, 260px) rather than a bare 260px: below that width the track would
 * be wider than the grid and the pills would overflow the panel instead of
 * falling back to the single column they had before. */
.cap-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: var(--space-2xs) var(--space-xs);
  margin: 0 18px var(--space-sm);
  padding: 0;
  list-style: none;
}
.cap-list li {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-glass-subtle);
  font-size: 13px;
}
.cap-list li.off {
  color: var(--text-muted);
}
.cap-mark {
  width: 1.1em;
  color: var(--color-success);
  font-weight: 700;
}
.cap-list li.off .cap-mark {
  color: var(--text-muted);
}
.cap-name {
  flex: 1;
  min-width: 0;
}
.cap-state {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}
.sub-head {
  margin: 0 18px var(--space-2xs);
  color: var(--text-dim);
  font-size: 13px;
}
.present-note {
  margin: 0 18px var(--space-2xs);
}
.mixed-flag {
  margin-right: 6px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--color-glass-subtle);
  border: var(--rule-hair) solid var(--color-rule);
  font-size: 12px;
}
.present-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-2xs) var(--space-sm);
  margin: 0 18px;
}
.present-grid dt {
  color: var(--text-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.present-grid dd {
  margin: 0 0 var(--space-2xs);
  font-size: 14px;
}
.quality {
  margin: var(--space-sm) 18px 0;
}
.quality-flag {
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--color-glass-subtle);
  border: var(--rule-hair) solid var(--color-rule);
  font-size: 12px;
}
.chart-card {
  position: relative;
  margin-bottom: var(--space-sm);
  padding: var(--space-xs) var(--space-2xs) var(--space-2xs);
  overflow: hidden;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-panel);
  background: var(--color-paper-2);
  box-shadow: var(--shadow-card);
}
.chart-caption {
  margin: var(--space-3xs) var(--space-sm) var(--space-2xs);
  color: var(--color-ink-2);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
}
.page-message {
  padding: var(--space-xl) var(--space-md);
  border: var(--rule-hair) solid var(--color-rule);
  background: var(--color-paper-2);
  color: var(--color-muted);
  text-align: center;
}
.page-message h2 {
  margin-top: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-style: normal;
}
.page-message p {
  margin-bottom: var(--space-sm);
}

.selection-panel {
  padding: var(--space-md);
}
.selection-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.selection-head h2 {
  margin: 0;
  font-size: 1rem;
}
.selection-head .btn.hidden {
  visibility: hidden;
}
.selection-note {
  /* One line, always. The three things this can say are all short, and letting
     a long one wrap would put the height back on the panel's list of moving
     parts. */
  margin: 0 0 var(--space-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .run-head {
    align-items: flex-start;
  }
  .run-actions {
    flex-basis: 100%;
  }
  .panel-hint,
  .cap-list,
  .sub-head,
  .present-note,
  .present-grid,
  .quality,
  .panel :deep(.stat-grid) {
    margin-inline: 0;
    padding-inline: var(--space-sm);
  }
}
</style>
