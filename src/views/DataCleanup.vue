<script setup lang="ts">
// History data cleanup (DATA-001, simplified UI): pick a cleanup unit — a monitor
// target or the merged "system status" of an agent — scoped to all agents or one,
// then Clean it; or Delete all data outright. Running targets are cleanable (the
// explicit selection is the consent); a time-range delete is kept as an advanced
// option. Deletion runs as an async job whose progress is polled.
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  api,
  type CleanupInventory,
  type CleanupItemKey,
  type CleanupJob,
  type CleanupPreview,
  type CleanupSelection,
} from '../api'
import { usePolling } from '../composables/usePolling'
import { pushToast } from '../toasts'

const SITE = 'site_default'
const { t, locale } = useI18n()

const inventory = ref<CleanupInventory | null>(null)
const loading = ref(false)
const error = ref('')

const agentScope = ref('') // '' = all agents, else agent_id
const selectedUnit = ref('') // unit key, e.g. "mon:probe_x" or "sys"
const advancedOpen = ref(false)
const fromLocal = ref('')
const toLocal = ref('')

const preview = ref<CleanupPreview | null>(null)
const previewing = ref(false)
const pendingSel = ref<CleanupSelection | null>(null)
const pendingLabel = ref('')
// Idempotency token minted when a preview is built and retained until the create
// succeeds or is cancelled, so a lost create response can be retried without the
// server re-executing the delete.
const pendingToken = ref('')
const creating = ref(false)

const jobId = ref('')
const job = ref<CleanupJob | null>(null)

// uuid returns a v4 UUID. crypto.randomUUID is only defined in secure contexts
// (https or loopback), so fall back on a plain-HTTP LAN origin.
function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
  }
  return `cj-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function fmtNum(n: number): string {
  return n.toLocaleString(locale.value === 'zh' ? 'zh-CN' : 'en-US')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    inventory.value = await api.cleanupSeries(SITE)
    // Keep the selection valid after a reload.
    if (!units.value.some((u) => u.key === selectedUnit.value)) {
      selectedUnit.value = units.value[0]?.key ?? ''
    }
  } catch (e) {
    error.value = t('cleanup.loadErr') + ': ' + String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

// A cleanup unit: a monitor target (all its series) or the merged system status,
// scoped to the selected agent(s). keys are the concrete series to delete.
interface Unit {
  key: string
  label: string
  status: 'live' | 'deleted' | 'system'
  keys: CleanupItemKey[]
  est: number
}

const scopedAgents = computed(() => {
  const inv = inventory.value
  if (!inv) return []
  return agentScope.value ? inv.agents.filter((a) => a.agent_id === agentScope.value) : inv.agents
})

// Build the unit list from the inventory: monitor targets aggregate across the
// scoped agents by monitor_id; every system series (monitor_id='') merges into one
// "system status" unit.
const units = computed<Unit[]>(() => {
  const monitors = new Map<string, Unit>()
  const systemKeys: CleanupItemKey[] = []
  let systemEst = 0
  for (const a of scopedAgents.value) {
    for (const g of a.groups) {
      if (g.monitor_id === '') {
        for (const s of g.series) {
          systemKeys.push({ agent_id: a.agent_id, monitor_id: '', kind: s.kind, target: s.target })
          systemEst += s.est_samples
        }
        continue
      }
      const key = `mon:${g.monitor_id}`
      let u = monitors.get(key)
      if (!u) {
        const base = g.monitor_name || g.series[0]?.target || g.monitor_id
        const label = g.status === 'deleted' ? `${base}${t('cleanup.deletedSuffix')}` : base
        u = { key, label, status: g.status, keys: [], est: 0 }
        monitors.set(key, u)
      }
      for (const s of g.series) {
        u.keys.push({ agent_id: a.agent_id, monitor_id: g.monitor_id, kind: s.kind, target: s.target })
        u.est += s.est_samples
      }
    }
  }
  const list = [...monitors.values()].sort((x, y) => x.label.localeCompare(y.label))
  if (systemKeys.length > 0) {
    list.push({
      key: 'sys',
      label: t('cleanup.systemStatus'),
      status: 'system',
      keys: systemKeys,
      est: systemEst,
    })
  }
  return list
})

const selectedUnitObj = computed(() => units.value.find((u) => u.key === selectedUnit.value) ?? null)

const fromTs = computed(() => (fromLocal.value ? Math.floor(new Date(fromLocal.value).getTime() / 1000) : 0))
const toTs = computed(() => (toLocal.value ? Math.floor(new Date(toLocal.value).getTime() / 1000) : 0))
// The range delete needs both endpoints with from strictly before to (the server
// rejects one-sided or inverted ranges); gate the button on that so the form can't
// submit a request that only fails after the round-trip.
const rangeValid = computed(() => fromTs.value > 0 && toTs.value > 0 && fromTs.value < toTs.value)
const orphans = computed(() => inventory.value?.orphans ?? { series: 0, monitors: 0, est_samples: 0 })

async function runPreview(sel: CleanupSelection, label: string) {
  error.value = ''
  // Invalidate any visible confirmation immediately so its (now stale) Delete
  // button can't submit the previous selection while this preview is loading.
  preview.value = null
  pendingSel.value = null
  pendingToken.value = ''
  previewing.value = true
  try {
    const p = await api.cleanupPreview(SITE, sel)
    preview.value = p
    // Submit only the deletable (non-blocked) subset for an explicit selection; the
    // "orphans"/"all" modes resolve their key set server-side.
    const deletable = p.items.filter((i) => !i.blocked)
    pendingSel.value = {
      mode: sel.mode,
      items:
        sel.mode === 'selection'
          ? deletable.map((i) => ({ agent_id: i.agent_id, monitor_id: i.monitor_id, kind: i.kind, target: i.target }))
          : [],
      from_ts: sel.from_ts,
      to_ts: sel.to_ts,
      allow_live: sel.allow_live,
    }
    pendingLabel.value = label
    pendingToken.value = uuid()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    previewing.value = false
  }
}

function cleanUnit(range: boolean) {
  const u = selectedUnitObj.value
  if (!u) return
  runPreview(
    { mode: 'selection', items: u.keys, from_ts: range ? fromTs.value : 0, to_ts: range ? toTs.value : 0, allow_live: true },
    u.label,
  )
}
function cleanOrphans() {
  runPreview({ mode: 'orphans', items: [], from_ts: 0, to_ts: 0, allow_live: false }, t('cleanup.orphanButton'))
}
function deleteAll() {
  runPreview({ mode: 'all', items: [], from_ts: 0, to_ts: 0, allow_live: true }, t('cleanup.deleteAllBtn'))
}

function cancelPreview() {
  preview.value = null
  pendingSel.value = null
  pendingToken.value = ''
}

async function confirmDelete() {
  if (!pendingSel.value) return
  if (!pendingToken.value) pendingToken.value = uuid()
  creating.value = true
  error.value = ''
  try {
    const { job_id } = await api.createCleanupJob(SITE, { ...pendingSel.value, client_token: pendingToken.value })
    preview.value = null
    pendingSel.value = null
    pendingToken.value = ''
    jobId.value = job_id
    job.value = null
    pushToast({ tone: 'info', title: t('cleanup.startedToast') })
    startPoll()
  } catch (e) {
    const msg = String((e as Error).message || e)
    if (msg.toLowerCase().includes('already running')) {
      await attachActiveJob()
      pushToast({ tone: 'warn', title: t('cleanup.duplicateToast') })
    } else {
      error.value = msg
    }
  } finally {
    creating.value = false
  }
}

async function attachActiveJob() {
  try {
    const recent = await api.cleanupJobs(SITE, 5)
    const active = recent.find((j) => j.state === 'queued' || j.state === 'running')
    if (active) {
      preview.value = null
      pendingSel.value = null
      pendingToken.value = ''
      jobId.value = active.id
      job.value = null
      startPoll()
    }
  } catch {
    /* best-effort */
  }
}

async function retryFailed() {
  if (!job.value) return
  // A job-level 'failed' can leave items still 'pending' (the loop aborted before
  // reaching them), so retry both failed and unprocessed items to finish the work.
  const retryable = job.value.items.filter((i) => i.state === 'failed' || i.state === 'pending')
  if (retryable.length === 0) return
  pendingSel.value = {
    mode: 'selection',
    items: retryable.map((i) => ({ agent_id: i.agent_id, monitor_id: i.monitor_id, kind: i.kind, target: i.target })),
    from_ts: job.value.from_ts,
    to_ts: job.value.to_ts,
    allow_live: true,
  }
  pendingLabel.value = t('cleanup.retryFailed')
  pendingToken.value = uuid()
  await confirmDelete()
}

function dismissJob() {
  jobId.value = ''
  job.value = null
  load()
}

const { start: startPoll } = usePolling(
  async () => {
    if (!jobId.value) return false
    job.value = await api.cleanupJob(jobId.value)
    const active = job.value.state === 'queued' || job.value.state === 'running'
    if (!active) await load()
    return active
  },
  { intervalMs: 1500 },
)

const jobActive = computed(() => job.value?.state === 'queued' || job.value?.state === 'running')
const jobProcessed = computed(() => (job.value ? job.value.done_items + job.value.failed_items : 0))
const jobProgressPct = computed(() => {
  const j = job.value
  if (!j || j.total_items === 0) return 0
  // Failed items are processed too — count them so a job with failures still
  // reaches 100% instead of stalling at the done-only fraction.
  return Math.round((jobProcessed.value / j.total_items) * 100)
})
// A job-level failure can leave items unprocessed (pending); those plus failed
// items are retryable.
const retryableItems = computed(() => job.value?.items.filter((i) => i.state === 'failed' || i.state === 'pending') ?? [])

onMounted(async () => {
  await load()
  try {
    const recent = await api.cleanupJobs(SITE, 1)
    const last = recent[0]
    if (last && (last.state === 'queued' || last.state === 'running')) {
      jobId.value = last.id
      startPoll()
    }
  } catch {
    /* resume is best-effort */
  }
})

function unitStatusLabel(s: string): string {
  return s === 'deleted' ? t('cleanup.badgeDeleted') : s === 'system' ? t('cleanup.badgeSystem') : t('cleanup.badgeLive')
}
</script>

<template>
  <main class="page">
    <div class="page-head">
      <div>
        <h2>{{ t('cleanup.title') }}</h2>
        <p class="hint">{{ t('cleanup.sub') }}</p>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <!-- Job progress / result panel. -->
    <section v-if="job" class="panel" :class="{ 'job-done': !jobActive }">
      <div class="panel-head">
        <h3>{{ jobActive ? t('cleanup.progressTitle') : t('cleanup.resultTitle') }}</h3>
        <button v-if="!jobActive" class="link-btn" @click="dismissJob">✕</button>
      </div>
      <div class="panel-body">
        <template v-if="jobActive">
          <p class="hint">{{ job.state === 'queued' ? t('cleanup.queued') : t('cleanup.running') }}</p>
          <div class="progress-track"><div class="progress-fill" :style="{ width: jobProgressPct + '%' }" /></div>
          <p class="progress-count">{{ t('cleanup.progressCount', { done: jobProcessed, total: job.total_items }) }}</p>
        </template>
        <template v-else>
          <p v-if="job.state === 'failed'" class="err">{{ t('cleanup.jobFailed', { error: job.error }) }}</p>
          <p v-else-if="job.state === 'interrupted'" class="hint">{{ t('cleanup.interruptedNote') }}</p>
          <p class="ok-line">
            {{
              t('cleanup.resultDeleted', {
                samples: fmtNum(job.deleted.samples),
                rollups: fmtNum(job.deleted.rollups),
                series: fmtNum(job.deleted.series),
              })
            }}
          </p>
          <div v-if="retryableItems.length > 0" class="failed">
            <strong>{{ t('cleanup.failedTitle') }}</strong>
            <ul>
              <li v-for="fi in retryableItems" :key="fi.idx">
                {{ fi.label }}<span v-if="fi.state === 'failed' && fi.detail"> — {{ fi.detail }}</span>
              </li>
            </ul>
            <button class="btn btn-danger" :disabled="creating" @click="retryFailed">{{ t('cleanup.retryFailed') }}</button>
          </div>
        </template>
      </div>
    </section>

    <!-- Preview / confirm panel. -->
    <section v-if="preview" class="panel confirm">
      <div class="panel-head">
        <h3>{{ t('cleanup.previewTitle') }}</h3>
        <span class="preview-subject">{{ pendingLabel }}</span>
      </div>
      <div class="panel-body">
        <p class="totals">
          {{
            t('cleanup.previewTotals', {
              series: preview.totals.series,
              samples: fmtNum(preview.totals.samples),
              rollups: fmtNum(preview.totals.rollups),
            })
          }}
        </p>
        <p v-if="pendingSel && (pendingSel.from_ts || pendingSel.to_ts)" class="hint">{{ t('cleanup.bucketAlignNote') }}</p>
        <p class="hint cascade">{{ t('cleanup.notCascadedNote') }}</p>
        <p class="warn-line">{{ t('cleanup.irreversibleNote') }}</p>
        <div class="row">
          <button class="btn btn-danger" :disabled="creating || preview.totals.series === 0" @click="confirmDelete">
            {{ t('cleanup.confirmBtn') }}
          </button>
          <button class="btn btn-ghost" :disabled="creating" @click="cancelPreview">{{ t('cleanup.cancelBtn') }}</button>
        </div>
      </div>
    </section>

    <!-- Simple cleanup: pick a unit, clean it. -->
    <section class="panel">
      <div class="panel-body clean-row">
        <label class="ctl">
          <span class="ctl-label">{{ t('cleanup.scopeAgent') }}</span>
          <select v-model="agentScope">
            <option value="">{{ t('cleanup.allAgents') }}</option>
            <option v-for="a in inventory?.agents ?? []" :key="a.agent_id" :value="a.agent_id">
              {{ a.agent_name || a.agent_id }}
            </option>
          </select>
        </label>
        <label class="ctl grow">
          <span class="ctl-label">{{ t('cleanup.unit') }}</span>
          <select v-model="selectedUnit">
            <option v-if="units.length === 0" value="">{{ t('cleanup.empty') }}</option>
            <option v-for="u in units" :key="u.key" :value="u.key">
              {{ u.label }} · {{ unitStatusLabel(u.status) }} · {{ t('cleanup.estPrefix') }} {{ fmtNum(u.est) }}
            </option>
          </select>
        </label>
        <button class="btn btn-danger" :disabled="!selectedUnitObj || previewing || jobActive" @click="cleanUnit(false)">
          {{ t('cleanup.cleanBtn') }}
        </button>
      </div>

      <details class="advanced" :open="advancedOpen">
        <summary @click.prevent="advancedOpen = !advancedOpen">{{ t('cleanup.advanced') }}</summary>
        <div class="panel-body adv-body">
          <p class="hint">{{ t('cleanup.advancedHint') }}</p>
          <div class="scope-range">
            <label>{{ t('cleanup.from') }} <input v-model="fromLocal" type="datetime-local" /></label>
            <label>{{ t('cleanup.to') }} <input v-model="toLocal" type="datetime-local" /></label>
            <button
              class="btn btn-danger"
              :disabled="!selectedUnitObj || !rangeValid || previewing || jobActive"
              @click="cleanUnit(true)"
            >
              {{ t('cleanup.rangeCleanBtn') }}
            </button>
          </div>
          <p v-if="(fromLocal || toLocal) && !rangeValid" class="err">{{ t('cleanup.rangeInvalid') }}</p>
          <p class="hint">{{ t('cleanup.bucketAlignNote') }}</p>
        </div>
      </details>
    </section>

    <!-- Danger: bulk actions. -->
    <section class="panel danger">
      <div class="panel-body danger-row">
        <div>
          <strong>{{ t('cleanup.dangerTitle') }}</strong>
          <p v-if="orphans.series > 0" class="hint">
            {{ t('cleanup.orphanBody', { series: orphans.series, monitors: orphans.monitors, est: fmtNum(orphans.est_samples) }) }}
          </p>
        </div>
        <div class="danger-btns">
          <button v-if="orphans.series > 0" class="btn btn-danger" :disabled="jobActive || previewing" @click="cleanOrphans">
            {{ t('cleanup.orphanButton') }}
          </button>
          <button class="btn btn-danger" :disabled="jobActive || previewing || units.length === 0" @click="deleteAll">
            {{ t('cleanup.deleteAllBtn') }}
          </button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.clean-row {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.ctl {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ctl.grow {
  flex: 1;
  min-width: 240px;
}
.ctl-label {
  font-size: 12px;
  color: var(--text-dim);
}
.advanced {
  border-top: 1px solid var(--border);
}
.advanced summary {
  cursor: pointer;
  padding: 12px 18px;
  font-size: 13px;
  color: var(--text-dim);
  user-select: none;
}
.adv-body {
  padding-top: 0;
}
.scope-range {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.scope-range label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.confirm {
  border-color: rgba(248, 113, 113, 0.4);
}
.preview-subject {
  margin-left: auto;
  font-size: 13px;
  color: var(--text-dim);
}
.job-done {
  border-color: var(--border);
}
.danger {
  border-color: rgba(248, 113, 113, 0.28);
}
.danger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.danger-btns {
  display: flex;
  gap: 10px;
}
.totals {
  font-weight: 600;
}
.cascade {
  color: var(--warn, #b4841f);
}
.warn-line {
  color: var(--danger);
  font-weight: 600;
}
.ok-line {
  font-weight: 600;
}
.failed ul {
  margin: 6px 0 10px;
  padding-left: 18px;
  font-size: 13px;
}
.progress-track {
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  overflow: hidden;
  margin: 8px 0;
}
.progress-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.4s ease;
}
.progress-count {
  font-size: 13px;
  color: var(--text-dim);
}
</style>
