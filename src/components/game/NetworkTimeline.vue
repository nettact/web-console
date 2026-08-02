<script setup lang="ts">
// The network beside the frames: probe RTT and loss, Wi-Fi, and host throughput
// for the same agent over the same seconds as the run's frame charts.
//
// This is the whole point of putting the two on one page — a frame-time spike
// with a matching RTT spike is a different problem from one with a flat network
// underneath it. So the time axis is pinned to the run's window, identical to the
// charts above: a reader compares by x position, and two axes fitted to their own
// data would make the same moment appear in two places.
//
// The request has to describe the run's window on BOTH sides. `since_seconds` is
// measured from now, so a two-day-old run asked for with that alone is a two-day
// query — and the server picks its rollup resolution from the span it is asked
// for, handing back hourly buckets for a half-hour session. `until` bounds the
// far end so the resolution matches what is being looked at.
//
// A series the agent never recorded is left off the page with a note — never
// drawn as a line at zero, which would claim a measured silence.
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type ProbeTarget, type Sample, type SeriesInfo } from '../../api'
import MetricChart from '../MetricChart.vue'
import type { ChartBand } from '../../lib/chartBands'
import type { TimeSelection } from '../../composables/useChartSelection'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { kindColor } from '../../lib/metricMeta'
import { targetLabel } from '../../lib/targetLabels'

const props = defineProps<{
  agentId: string
  // The run's window in epoch ms. `endMs` is the run's end, or now while it runs.
  startMs: number
  endMs: number
  // Monitors the run's profile links. Empty means the run had no profile, the
  // profile links none, or the profile has since been deleted — in every one of
  // those cases the section falls back to the agent's own gateway/ICMP monitors.
  monitorIds: string[]
  // The run's frameless stretches, shaded here as well as on the frame charts.
  // A blank in an RTT line and a blank in a frame-rate line look identical, and
  // "the game was minimised" has to be readable from either.
  bands?: ChartBand[]
}>()

// The page's shared time selection, passed straight through to every chart below.
//
// It is declared here rather than left to bubble because a model does not fall
// through a component: without this the network charts would each keep a private
// selection, so a drag on a frame chart would highlight nothing down here and a
// drag down here would highlight nothing up there — which is the one thing the
// feature is for.
const selection = defineModel<TimeSelection>('selection', { default: null })

const { t } = useI18n()
const { metricLabel } = useMetricMeta()

const RTT = 'probe.icmp.rtt_ms'
const LOSS = 'probe.icmp.loss_pct'
const SIGNAL = 'wifi.signal_dbm'
const QUALITY = 'wifi.quality_pct'
const RX = 'host.net.rx_bps'
const TX = 'host.net.tx_bps'

const UNITS: Record<string, string> = {
  [RTT]: 'ms',
  [LOSS]: 'pct',
  [SIGNAL]: 'dbm',
  [QUALITY]: 'pct',
  [RX]: 'bps',
  [TX]: 'bps',
}

// Samples are kept a minute either side of the run so the lines reach the edges
// of the axis instead of stopping short of them; the axis itself shows the run.
const CLAMP_MARGIN_MS = 60_000
// Asked for beyond the run's start, to cover clock skew between the agent that
// timed the run and the server that timestamped the samples.
const REQUEST_MARGIN_SEC = 300
// Two is enough to compare a first hop against an internet target without turning
// the section into a second monitoring page.
const FALLBACK_MONITORS = 2
// Points asked for beyond the arithmetic minimum, covering a probe that ran a
// little faster than its schedule and the partial buckets at either end.
const LIMIT_SLACK = 120
// A ceiling on what one chart may pull into the browser. A window that would need
// more than this is already coarser than the axis can show.
const MAX_POINTS = 10_000
// The densest cadence anything here records at. Probes are far slower, but asking
// for too many points costs nothing while asking for too few silently truncates.
const RAW_STEP_SEC = 1

// Mirrors server-core metrics.pickTier: which resolution the server serves for a
// window of this length. It is mirrored rather than guessed because the server
// returns points in ASCENDING order and cuts at `limit` — a limit sized for the
// wrong granularity drops the NEWEST end of the window, which is the half of a
// run a reader is usually chasing, and does it without any error to notice.
function tierStepSeconds(windowSec: number): number {
  if (windowSec <= 2 * 3600) return RAW_STEP_SEC
  if (windowSec <= 2 * 86400) return 60
  if (windowSec <= 90 * 86400) return 3600
  return 86400
}

const SITE = 'site_default'

const series = ref<SeriesInfo[]>([])
const targets = ref<ProbeTarget[]>([])
const samples = ref<Record<string, Sample[]>>({})
const loading = ref(true)
const error = ref('')
// Monotonic token: walking from one run to the next reuses this component, and a
// late reply for the previous run would otherwise be charted against this one's
// window.
let seq = 0

interface PlanSeries {
  key: string
  label: string
  kind: string
  unit: string
  color: string
  monitor?: string
  target?: string
}
interface PlanChart {
  id: string
  title: string
  series: PlanSeries[]
}

const skey = (kind: string, scope: string) => `${kind} ${scope}`

const monitorName = (id: string): string => {
  const m = targets.value.find((x) => x.id === id)
  return m ? m.name?.trim() || targetLabel(m, t) : id
}

// Monitor ids this agent actually has RTT samples for. A profile may link a
// monitor no agent runs, one this agent is out of scope for, or one that has been
// deleted; charting it would produce an empty panel that looks like an outage.
const rttMonitorIds = computed(
  () => new Set(series.value.filter((s) => s.kind === RTT && s.monitor_id).map((s) => s.monitor_id as string)),
)

const linkedMonitors = computed(() => props.monitorIds.filter((id) => rttMonitorIds.value.has(id)))

// The agent's own view of the path when the profile cannot supply one: the
// gateway first (it separates a local problem from an upstream one), then any
// other ICMP monitor.
const fallbackMonitors = computed(() => {
  const rank = (kind: string) => (kind === 'gateway' ? 0 : 1)
  return targets.value
    .filter((m) => m.id && rttMonitorIds.value.has(m.id) && (m.kind === 'gateway' || m.kind === 'icmp'))
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .slice(0, FALLBACK_MONITORS)
    .map((m) => m.id as string)
})

// A profile whose linked monitors resolve to nothing here falls back exactly like
// a run with no profile at all. Returning an empty list instead would leave the
// section blank while its own caption claimed the fallbacks were being charted.
const probeMonitors = computed(() => (linkedMonitors.value.length ? linkedMonitors.value : fallbackMonitors.value))
const usingProfileMonitors = computed(() => linkedMonitors.value.length > 0)
// True when the profile named monitors but none of them resolve to series here.
const linkedMonitorsUnavailable = computed(() => props.monitorIds.length > 0 && linkedMonitors.value.length === 0)

const wifiAdapters = computed(() => {
  const names = series.value.filter((s) => s.kind === SIGNAL || s.kind === QUALITY).map((s) => s.target)
  return [...new Set(names)].sort()
})

const hasKind = (kind: string) => series.value.some((s) => s.kind === kind)

const plan = computed<PlanChart[]>(() => {
  const charts: PlanChart[] = []
  for (const id of probeMonitors.value) {
    const one = (kind: string): PlanSeries => ({
      key: skey(kind, id),
      label: metricLabel(kind),
      kind,
      unit: UNITS[kind],
      color: kindColor(kind),
      monitor: id,
    })
    const list = [one(RTT)]
    if (series.value.some((s) => s.kind === LOSS && s.monitor_id === id)) list.push(one(LOSS))
    charts.push({ id: `probe-${id}`, title: `${monitorName(id)} · ${t('gameRuns.net.probeChart')}`, series: list })
  }
  for (const name of wifiAdapters.value) {
    const one = (kind: string): PlanSeries => ({
      key: skey(kind, name),
      label: metricLabel(kind),
      kind,
      unit: UNITS[kind],
      color: kindColor(kind),
      target: name,
    })
    const list: PlanSeries[] = []
    if (series.value.some((s) => s.kind === SIGNAL && s.target === name)) list.push(one(SIGNAL))
    if (series.value.some((s) => s.kind === QUALITY && s.target === name)) list.push(one(QUALITY))
    if (list.length) charts.push({ id: `wifi-${name}`, title: `${name} · ${t('gameRuns.net.wifiChart')}`, series: list })
  }
  const io: PlanSeries[] = []
  for (const kind of [RX, TX]) {
    if (!hasKind(kind)) continue
    io.push({
      key: skey(kind, 'host'),
      label: metricLabel(kind),
      kind,
      unit: UNITS[kind],
      color: kindColor(kind),
      target: 'host',
    })
  }
  if (io.length) charts.push({ id: 'netio', title: t('gameRuns.net.throughputChart'), series: io })
  return charts
})

// What this agent could not contribute, named rather than silently omitted: an
// absent chart and a chart with no data look identical otherwise.
const absent = computed(() => {
  const out: string[] = []
  if (!probeMonitors.value.length) out.push(t('gameRuns.net.absentProbe'))
  if (!wifiAdapters.value.length) out.push(t('gameRuns.net.absentWifi'))
  if (!hasKind(RX) && !hasKind(TX)) out.push(t('gameRuns.net.absentThroughput'))
  return out
})

const charts = computed(() =>
  plan.value.map((c) => ({
    id: c.id,
    title: c.title,
    metrics: c.series.map((s) => ({
      key: s.key,
      label: s.label,
      kind: s.kind,
      unit: s.unit,
      color: s.color,
      samples: samples.value[s.key] ?? [],
    })),
  })),
)
const someData = (list: { samples: Sample[] }[]) => list.some((m) => m.samples.length)

// The chart window is the run itself; the extra minute of samples on each side
// only gives the lines somewhere to enter and leave the frame.
const clampLo = computed(() => props.startMs - CLAMP_MARGIN_MS)
const clampHi = computed(() => props.endMs + CLAMP_MARGIN_MS)

// The spacing the server actually served, from the returned points rather than
// from what was asked for — the resolution can be coarser than the request
// implies (raw retention having passed, say). It is a lower-median so one long
// outage in an otherwise regular series cannot redefine the cadence.
function servedStepMs(times: number[]): number {
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap > 0) gaps.push(gap)
  }
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor((gaps.length - 1) / 2)]
}

// Cut the series back to the run, but never drop a point ONLY because the
// resolution is coarser than the margin: an hourly bucket covering the run's
// first minutes has its timestamp well outside a ±60 s window, and discarding it
// leaves the reader with an empty chart rather than a coarse one. So the bounds
// grow by one served interval — at most one boundary bucket on each side,
// whichever end of its interval the server timestamps it with. The bucket is
// still outside the pinned axis, so it anchors the line at the frame edge instead
// of pretending to be a reading from inside the run.
function clamp(list: Sample[]): Sample[] {
  const times = list.map((s) => new Date(s.ts).getTime()).filter((ts) => Number.isFinite(ts))
  times.sort((a, b) => a - b)
  const step = servedStepMs(times)
  const lo = clampLo.value - step
  const hi = clampHi.value + step
  return list.filter((s) => {
    const ts = new Date(s.ts).getTime()
    return Number.isFinite(ts) && ts >= lo && ts <= hi
  })
}

async function loadSeries() {
  const mine = ++seq
  loading.value = true
  try {
    const [ser, tgts] = await Promise.all([api.listSeries(props.agentId), api.listTargets(SITE)])
    if (mine !== seq) return
    series.value = ser
    targets.value = tgts
    error.value = ''
  } catch (e) {
    if (mine !== seq) return
    series.value = []
    targets.value = []
    error.value = String((e as Error).message || e)
    loading.value = false
    return
  }
  await loadSamples(mine)
}

async function loadSamples(mine: number) {
  const wanted = plan.value.flatMap((c) => c.series)
  if (!wanted.length) {
    samples.value = {}
    loading.value = false
    return
  }
  // since_seconds is measured from now, so it carries the run's age; `until`
  // brings the far end back to the run's end. The window the server then resolves
  // — and picks its rollup tier from — is the run itself plus the margins, which
  // is the only span whose resolution is worth anything here.
  const nowSec = Math.floor(Date.now() / 1000)
  const startSec = Math.floor(props.startMs / 1000)
  const endSec = Math.floor(props.endMs / 1000)
  const sinceSeconds = Math.max(REQUEST_MARGIN_SEC, nowSec - startSec + REQUEST_MARGIN_SEC)
  const until = endSec + REQUEST_MARGIN_SEC
  // Exactly the window the server will resolve, so the point budget below is
  // computed against the resolution it will actually serve.
  const windowSec = Math.max(1, Math.min(nowSec, until) - (nowSec - sinceSeconds))
  const limit = Math.min(MAX_POINTS, Math.ceil(windowSec / tierStepSeconds(windowSec)) + LIMIT_SLACK)
  try {
    const results = await Promise.all(
      wanted.map((s) =>
        api.metrics(props.agentId, s.kind, {
          monitor: s.monitor,
          target: s.target,
          limit,
          sinceSeconds,
          until,
        }),
      ),
    )
    if (mine !== seq) return
    const map: Record<string, Sample[]> = {}
    wanted.forEach((s, i) => (map[s.key] = clamp(results[i])))
    samples.value = map
    error.value = ''
  } catch (e) {
    if (mine !== seq) return
    samples.value = {}
    error.value = String((e as Error).message || e)
  } finally {
    if (mine === seq) loading.value = false
  }
}

onMounted(loadSeries)
watch(
  () => [props.agentId, props.startMs, props.endMs, props.monitorIds.join(',')],
  loadSeries,
)
</script>

<template>
  <section class="panel net-panel" aria-labelledby="game-net-title">
    <div class="panel-head">
      <h3 id="game-net-title">{{ t('gameRuns.net.title') }}</h3>
    </div>
    <p class="hint panel-hint">{{ t('gameRuns.net.hint') }}</p>
    <p class="hint panel-hint source-note">
      {{
        usingProfileMonitors
          ? t('gameRuns.net.sourceProfile')
          : linkedMonitorsUnavailable
            ? t('gameRuns.net.sourceLinkedMissing')
            : t('gameRuns.net.sourceFallback')
      }}
    </p>

    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <p v-if="loading" class="hint panel-hint">{{ t('common.loading') }}</p>

    <template v-else>
      <div class="card chart-card" v-for="c in charts" :key="c.id">
        <MetricChart
          :title="c.title"
          :metrics="c.metrics"
          :x-min="startMs"
          :x-max="endMs"
          :bands="bands"
          selectable
          v-model:selection="selection"
        />
        <p v-if="!someData(c.metrics)" class="empty-line hint">{{ t('metrics.noDataRange') }}</p>
      </div>

      <!-- Nothing charted at all is still an answer, and it is not "the network
           was fine". -->
      <p v-if="!charts.length" class="hint panel-hint">{{ t('gameRuns.net.nothing') }}</p>
      <p v-if="absent.length" class="hint panel-hint absent">
        {{ t('gameRuns.net.absentNote', { series: absent.join(t('gameRuns.listSep')) }) }}
      </p>
    </template>
  </section>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · section: Game run network timeline */
.net-panel {
  margin: var(--space-md) 0;
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
.panel-hint {
  margin: 0 18px 6px;
  padding-top: 8px;
}
.source-note {
  padding-top: 0;
}
.absent {
  margin-top: var(--space-2xs);
}
.chart-card {
  position: relative;
  margin: 0 18px var(--space-sm);
  padding: var(--space-xs) var(--space-2xs) var(--space-2xs);
  overflow: hidden;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-panel);
  background: var(--color-paper-2);
  box-shadow: var(--shadow-card);
}
.empty-line {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

@media (max-width: 768px) {
  .panel-hint {
    margin-inline: 0;
    padding-inline: var(--space-sm);
  }
  .chart-card {
    margin-inline: 0;
  }
}
</style>
