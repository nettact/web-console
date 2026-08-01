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
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  api,
  ApiError,
  CAP_DISPLAYED,
  CAP_FRAME_TYPE,
  CAP_PER_FRAME_COMPLETE,
  CAP_PRESENT_META,
  type GameBucket,
  type GameRun,
} from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import InfoTip from '../components/InfoTip.vue'
import GameRunChart from '../components/game/GameRunChart.vue'
import GameStatCards from '../components/game/GameStatCards.vue'
import GameValue from '../components/game/GameValue.vue'
import { useGameMeta } from '../composables/useGameMeta'
import { useMetricMeta } from '../composables/useMetricMeta'
import {
  bucketsAbsence,
  bucketsTruncated,
  isRunning,
  missingCause,
  observes,
  presentCause,
  qualityFlags,
  type GameCard,
  type GameChartSeries,
  type GameField,
  type GamePoint,
} from '../lib/gameRun'
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

const runId = computed(() => String(route.params.id || ''))
const run = ref<GameRun | null>(null)
const buckets = ref<GameBucket[]>([])
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

async function load() {
  const mine = ++seq
  const id = runId.value
  if (!id) return
  loading.value = true
  notFound.value = false
  error.value = ''
  try {
    const r = await api.gameRun(id)
    const b = await api.gameRunBuckets(id, { limit: BUCKET_LIMIT })
    if (mine !== seq) return
    run.value = r
    buckets.value = b
  } catch (e) {
    if (mine !== seq) return
    // A deleted run — and one belonging to another site — is a 404 from both
    // calls. That is a missing page, not a failure to reach the server.
    if (e instanceof ApiError && e.status === 404) notFound.value = true
    else error.value = String((e as Error).message || e)
    run.value = null
    buckets.value = []
  } finally {
    if (mine === seq) loading.value = false
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
      foot: r.ended_at ? t('gameRuns.durationFoot', { time: fmtTime(r.ended_at) }) : t('gameRuns.durationRunningFoot'),
    },
    { key: 'mean', label: t('gameRuns.meanFps'), value: fps(s.mean_fps), unit: 'FPS', reason: reason('fpsStat'), foot: t('gameRuns.meanFpsFoot') },
    { key: 'low1', label: t('gameRuns.low1'), value: fps(s.low_1pct_fps), unit: 'FPS', reason: reason('fpsStat'), foot: t('gameRuns.low1Foot') },
    { key: 'low01', label: t('gameRuns.low01'), value: fps(s.low_0_1pct_fps), unit: 'FPS', reason: reason('fpsStat'), foot: t('gameRuns.low01Foot') },
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
    { key: 'presented', label: t('gameRuns.presented'), value: fmtCount(s.presented), foot: t('gameRuns.presentedFoot') },
    {
      key: 'displayed',
      label: t('gameRuns.displayed'),
      value: s.displayed === null ? null : fmtCount(s.displayed),
      reason: reason('displayed'),
      foot: t('gameRuns.displayedFoot'),
    },
    {
      key: 'dropped',
      label: t('gameRuns.dropped'),
      value: s.dropped === null ? null : fmtCount(s.dropped),
      reason: reason('dropped'),
      foot: dropRate === null ? t('gameRuns.droppedFoot') : t('gameRuns.droppedRateFoot', { rate: dropRate }),
    },
  ]
})

// ---- capture source ----
const CAPS = [CAP_DISPLAYED, CAP_FRAME_TYPE, CAP_PRESENT_META, CAP_PER_FRAME_COMPLETE]
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
const points = (pick: (b: GameBucket) => number | null | undefined): GamePoint[] =>
  buckets.value.map((b) => [at(b), pick(b) ?? null])

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

onMounted(load)
watch(runId, load)
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

      <template v-if="buckets.length">
        <div class="card chart-card">
          <GameRunChart :title="t('gameRuns.fpsChart')" unit="FPS" :series="fpsSeries" />
          <p v-if="fpsCaption" class="chart-caption">{{ fpsCaption }}</p>
        </div>

        <div class="card chart-card">
          <GameRunChart :title="t('gameRuns.frameTimeChart')" unit="ms" :series="frameTimeSeries" />
          <p class="chart-caption">{{ t('gameRuns.frameTimeCaption') }}</p>
        </div>
      </template>
      <p v-else class="hint notice">{{ bucketsNote }}</p>

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
.cap-list {
  display: grid;
  gap: var(--space-2xs);
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
