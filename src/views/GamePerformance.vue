<script setup lang="ts">
// Game Performance: the runs one agent has captured — a run being one continuous
// stretch of a game presenting frames. This is not a time-series page: a second of
// rendering is a distribution rather than a scalar, so runs and their per-second
// buckets have their own model and their own endpoints.
//
// Every figure in the table can legitimately be missing. A source that cannot
// measure something reports nothing, and the whole-run FPS figures are declined
// outright for a run too short to support them, so the cells go through GameValue
// rather than defaulting to 0.
import { computed, onMounted, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type GameRun } from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import InfoTip from '../components/InfoTip.vue'
import RangePicker from '../components/RangePicker.vue'
import GameValue from '../components/game/GameValue.vue'
import { useGameMeta } from '../composables/useGameMeta'
import { useMetricMeta } from '../composables/useMetricMeta'
import { isRunning, missingCause } from '../lib/gameRun'
import { agentLabel } from '../lib/agentLabel'
import { pushToast } from '../toasts'

const { t } = useI18n()
const route = useRoute()
const { fmtTime } = useMetricMeta()
const { fmtFps, fmtRunDuration, missingText } = useGameMeta()

const agents = ref<Agent[]>([])
const agentId = ref('')
const runs = ref<GameRun[]>([])
const total = ref(0)
const rangeSec = ref(24 * 3600)
const loading = ref(false)
const loaded = ref(false)
const busy = ref(false)
const error = ref('')
// Monotonic token: a slow response for a previous agent or range must not land on
// top of the current selection.
let seq = 0

const LIMIT = 200

async function loadAgents() {
  try {
    agents.value = await api.agents()
    const requested = String(route.query.agent || '')
    if (requested && agents.value.some((a) => a.id === requested)) agentId.value = requested
    else if (!agentId.value && agents.value.length) agentId.value = agents.value[0].id
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

async function loadRuns() {
  const mine = ++seq
  if (!agentId.value) {
    runs.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const since = Math.floor(Date.now() / 1000) - rangeSec.value
    const page = await api.gameRuns(agentId.value, { since, limit: LIMIT })
    if (mine !== seq) return
    runs.value = page.items
    total.value = page.total
    error.value = ''
    loaded.value = true
  } catch (e) {
    if (mine === seq) error.value = String((e as Error).message || e)
  } finally {
    if (mine === seq) loading.value = false
  }
}

function onAgentChange() {
  runs.value = []
  total.value = 0
  loaded.value = false
  loadRuns()
}

const runTitle = (r: GameRun) => r.title?.trim() || ''
// The listing is capped, so a window holding more runs than the cap has to say
// what it is showing rather than let the reader assume it is everything.
const truncated = computed(() => total.value > runs.value.length)

// ---- delete ----
const pendingDelete = ref<GameRun | null>(null)

async function confirmDelete() {
  const r = pendingDelete.value
  if (!r) return
  busy.value = true
  error.value = ''
  try {
    await api.deleteGameRun(r.id)
    pendingDelete.value = null
    await loadRuns()
    pushToast({ tone: 'info', title: t('gameRuns.deleted', { name: runTitle(r) || r.proc }) })
  } catch (e) {
    error.value = String((e as Error).message || e)
    pendingDelete.value = null
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadAgents()
  await loadRuns()
})
</script>

<template>
  <main class="page data-workbench" aria-labelledby="game-runs-title">
    <div class="page-head workbench-head">
      <div class="head-copy">
        <h2 id="game-runs-title">{{ t('gameRuns.title') }}</h2>
        <p class="hint sub">{{ t('gameRuns.sub') }}</p>
      </div>
      <span class="spacer"></span>
      <div class="picker" v-if="agents.length">
        <label for="game-agent">Agent</label>
        <select id="game-agent" v-model="agentId" @change="onAgentChange">
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ agentLabel(a) }} ({{ a.platform }})</option>
        </select>
        <RangePicker v-model="rangeSec" @change="loadRuns" />
        <button class="btn" :disabled="loading" @click="loadRuns">
          {{ loading ? t('common.loading') : t('common.refresh') }}
        </button>
      </div>
    </div>

    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <div v-if="!agents.length" class="card empty">
      <h3>{{ t('common.noAgents') }}</h3>
      <p class="hint">{{ t('gameRuns.noAgentHint') }}</p>
    </div>

    <section v-else class="panel table-sheet" aria-labelledby="game-runs-list-title">
      <div class="panel-head">
        <h3 id="game-runs-list-title">{{ t('gameRuns.listTitle') }}</h3>
        <span class="count">{{ total }}</span>
        <span class="spacer"></span>
        <span v-if="truncated" class="hint tiny">{{ t('gameRuns.showingN', { n: runs.length, total }) }}</span>
      </div>
      <p class="hint panel-hint">{{ t('gameRuns.listHint') }}</p>

      <div class="table-wrap" role="region" tabindex="0" :aria-label="t('gameRuns.listTitle')">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ t('gameRuns.thTitle') }}</th>
              <th>{{ t('gameRuns.thProc') }}</th>
              <th>{{ t('gameRuns.thStarted') }}</th>
              <th class="num">{{ t('gameRuns.thDuration') }}</th>
              <th class="num">{{ t('gameRuns.thMeanFps') }}</th>
              <th class="num">{{ t('gameRuns.thLow1') }}</th>
              <th>{{ t('gameRuns.thState') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !runs.length">
              <td colspan="8" class="hint">{{ t('common.loading') }}</td>
            </tr>
            <tr v-else-if="!runs.length && loaded">
              <td colspan="8" class="hint">{{ t('gameRuns.emptyRange') }}</td>
            </tr>
            <tr v-for="r in runs" :key="r.id">
              <td>
                <RouterLink class="run-link" :to="`/game-performance/runs/${r.id}`">
                  {{ runTitle(r) || t('gameRuns.untitled') }}
                </RouterLink>
              </td>
              <td class="mono dim">{{ r.proc }}</td>
              <td>{{ fmtTime(r.started_at) }}</td>
              <td class="num">{{ fmtRunDuration(r.summary.duration_seconds) }}</td>
              <td class="num">
                <GameValue
                  :value="r.summary.mean_fps === null ? null : fmtFps(r.summary.mean_fps)"
                  :reason="missingText(missingCause('fpsStat', r.caps))"
                />
              </td>
              <td class="num">
                <GameValue
                  :value="r.summary.low_1pct_fps === null ? null : fmtFps(r.summary.low_1pct_fps)"
                  :reason="missingText(missingCause('fpsStat', r.caps))"
                />
              </td>
              <td>
                <span class="badge" :class="isRunning(r) ? 'up' : 'neutral'">
                  {{ isRunning(r) ? t('gameRuns.stateRunning') : t('gameRuns.stateFinished') }}
                </span>
              </td>
              <td class="actions">
                <RouterLink class="link-btn" :to="`/game-performance/runs/${r.id}`">
                  {{ t('gameRuns.detail') }}
                </RouterLink>
                <!-- A run still being recorded cannot be removed: the agent keeps
                     uploading the live session and the server upserts the row
                     straight back, so the delete would appear to work and then
                     hand back the same run holding only its last few seconds. -->
                <button class="link-btn danger" :disabled="busy || isRunning(r)" @click="pendingDelete = r">
                  {{ t('common.delete') }}
                </button>
                <InfoTip v-if="isRunning(r)" :text="t('gameRuns.deleteWhileRunning')" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ConfirmDialog
      :open="!!pendingDelete"
      :title="t('gameRuns.deleteTitle')"
      :message="[
        t('gameRuns.deleteBody', { name: pendingDelete ? runTitle(pendingDelete) || pendingDelete.proc : '' }),
        t('gameRuns.deleteIrreversible'),
      ]"
      :confirm-label="t('common.delete')"
      :cancel-label="t('gameRuns.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Game performance */
.data-workbench {
  font-variant-numeric: tabular-nums;
}
.workbench-head {
  align-items: flex-start;
}
.workbench-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.head-copy {
  min-width: 0;
}
.head-copy .sub {
  margin: var(--space-2xs) 0 0;
}
.picker {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: var(--space-2xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.picker select {
  min-width: 0;
  max-width: min(32vw, 320px);
}
.picker label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.panel {
  margin-bottom: var(--space-md);
}
.table-sheet {
  background: var(--color-glass-strong);
  border-color: var(--color-rule);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.table-sheet .panel-head {
  min-height: 56px;
  border-bottom-color: var(--color-rule);
}
.table-sheet .panel-head h3 {
  font-family: var(--font-display);
  letter-spacing: -0.018em;
}
.panel-hint {
  margin: 0 18px 6px;
  padding-top: 8px;
}
.count {
  min-width: 22px;
  padding: 1px 9px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  text-align: center;
}
.table-wrap {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-gutter: stable;
}
.table-wrap:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(-1 * var(--rule-fine));
}
.data-table {
  min-width: 900px;
}
.data-table thead th {
  background: var(--color-glass-subtle);
}
.data-table tbody tr:focus-within td {
  background: var(--color-glass-hover);
}
.num {
  text-align: right;
}
.dim {
  color: var(--text-muted);
}
.run-link {
  color: var(--color-accent-text);
  font-weight: 600;
}
.actions {
  white-space: nowrap;
}
.empty {
  text-align: center;
  padding: var(--space-xl) var(--space-md);
}
.tiny {
  font-size: 12px;
}

@media (max-width: 768px) {
  .workbench-head {
    align-items: stretch;
  }
  .picker {
    width: 100%;
    flex-wrap: wrap;
  }
  .picker select {
    flex: 1 1 200px;
    max-width: none;
  }
  .panel-hint {
    margin-inline: 0;
    padding-inline: var(--space-sm);
  }
}

@media (max-width: 414px) {
  .picker .btn {
    width: 100%;
  }
}
</style>
