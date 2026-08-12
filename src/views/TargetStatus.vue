<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type AgentGroup, type MonitorGroup, type TimeRange } from '../api'
import AgentStatusWorkspace from '../components/status/AgentStatusWorkspace.vue'
import TargetStatusBoard from '../components/status/TargetStatusBoard.vue'
import { agentStatus } from '../agentStatus'
import { setTargetStatusTimeRange, targetStatus } from '../targetStatus'
import {
  DISPLAY_STATE_ORDER,
  buildStatusGroups,
  countStatuses as countTargetStatuses,
  isStatusFilter,
  type StatusBucket,
  type StatusFilter,
} from '../lib/targetStatusPage'
import {
  filterAndSortAgents,
  isAgentFilter,
  type AgentFilter,
} from '../lib/agentStatusPage'
import {
  isAgentHistoryMode,
  isAgentWorkspaceTab,
  isTargetWorkspaceTab,
  isTargetStatusView,
  type AgentHistoryMode,
  type AgentWorkspaceTab,
  type TargetStatusView,
  type TargetWorkspaceTab,
} from '../lib/targetStatusAgentView'
import { toDateLocale } from '../i18n'

// A stable name so <KeepAlive :include> in App.vue caches this view: switching
// away and back must not remount/refetch (which would flash the loading card
// and collapse the list height, losing the user's scroll position).
defineOptions({ name: 'TargetStatus' })

const SITE = 'site_default'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()

const groups = ref<MonitorGroup[]>([])
const agentGroups = ref<AgentGroup[]>([])
const metaError = ref('')
const ready = ref(false)

const view = ref<TargetStatusView>('agents')
const search = ref('')
const groupFilter = ref('')
const statusFilter = ref<StatusFilter>('all')
const agentSearch = ref('')
const agentGroupFilter = ref('all')
const agentStatusFilter = ref<AgentFilter>('all')
const agentTab = ref<AgentWorkspaceTab>('overview')
const agentHistoryMode = ref<AgentHistoryMode>('connectivity')
const targetTab = ref<TargetWorkspaceTab>('overview')
const selectedTargetId = ref('')
const selectedAgentId = ref('')
const timeRanges: TimeRange[] = ['3h', '24h', '7d', '30d', '90d']
const timeRangeSeconds: Record<TimeRange, number> = {
  '3h': 3 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '90d': 90 * 86400,
}
let initialRouteQueryApplied = false
let applyingRoute = false

const queryText = (value: unknown): string => typeof value === 'string' ? value : ''
const isTimeRange = (value: string): value is TimeRange => timeRanges.includes(value as TimeRange)
const rangeSec = computed(() => timeRangeSeconds[targetStatus.requestedTimeRange])

function applyRouteQuery(): void {
  applyingRoute = true
  const rawView = queryText(route.query.view)
  const routeHasTarget = Object.prototype.hasOwnProperty.call(route.query, 'target')
  view.value = isTargetStatusView(rawView) ? rawView : routeHasTarget ? 'targets' : 'agents'
  search.value = queryText(route.query.q)
  groupFilter.value = queryText(route.query.group)
  const rawStatus = queryText(route.query.status)
  statusFilter.value = isStatusFilter(rawStatus) ? rawStatus : 'all'
  agentSearch.value = queryText(route.query.aq)
  agentGroupFilter.value = queryText(route.query.agroup) || 'all'
  const rawAgentStatus = queryText(route.query.astatus)
  agentStatusFilter.value = isAgentFilter(rawAgentStatus) ? rawAgentStatus : 'all'
  const rawAgentTab = queryText(route.query.tab)
  agentTab.value = isAgentWorkspaceTab(rawAgentTab) ? rawAgentTab : 'overview'
  const rawHistoryMode = queryText(route.query.history)
  agentHistoryMode.value = isAgentHistoryMode(rawHistoryMode) ? rawHistoryMode : 'connectivity'
  const rawTargetTab = queryText(route.query.ttab)
  targetTab.value = isTargetWorkspaceTab(rawTargetTab) ? rawTargetTab : 'overview'
  const targetFromRoute = queryText(route.query.target)
  if (initialRouteQueryApplied || routeHasTarget) {
    selectedTargetId.value = targetFromRoute
  }
  selectedAgentId.value = queryText(route.query.agent)
  const rawWindow = queryText(route.query.window)
  setTargetStatusTimeRange(isTimeRange(rawWindow) ? rawWindow : '24h')
  initialRouteQueryApplied = true
  applyingRoute = false
}

applyRouteQuery()

const filters = computed(() => ({
  search: search.value,
  groupId: groupFilter.value,
  status: statusFilter.value,
  agentId: '',
}))

const statusGroups = computed(() => buildStatusGroups(groups.value, targetStatus.targets, agentGroups.value, filters.value))
const summary = computed(() => countTargetStatuses(targetStatus.targets))
const visibleAgents = computed(() => filterAndSortAgents(agentStatus.agents, {
  search: agentSearch.value,
  groupId: agentGroupFilter.value,
  status: agentStatusFilter.value,
}))
const donutStyle = computed(() => {
  if (!summary.value.total) return { background: 'var(--surface-2)' }
  const abnormalEnd = summary.value.abnormal / summary.value.total * 100
  const attentionEnd = abnormalEnd + summary.value.attention / summary.value.total * 100
  const healthyEnd = attentionEnd + summary.value.healthy / summary.value.total * 100
  return {
    background: `conic-gradient(var(--danger) 0 ${abnormalEnd}%, var(--warning) ${abnormalEnd}% ${attentionEnd}%, var(--success) ${attentionEnd}% ${healthyEnd}%, var(--text-muted) ${healthyEnd}% 100%)`,
  }
})
const selectedTarget = computed(() => targetStatus.targets.find((row) => row.target_id === selectedTargetId.value))
const selectedTargetAgent = computed(() => {
  if (!selectedAgentId.value) return undefined
  const inTarget = selectedTarget.value?.agents.find((agent) => agent.agent_id === selectedAgentId.value)
  if (inTarget) return inTarget
  for (const row of targetStatus.targets) {
    const agent = row.agents.find((item) => item.agent_id === selectedAgentId.value)
    if (agent) return agent
  }
  return undefined
})
const selectedAgentRow = computed(() => agentStatus.agents.find((agent) => agent.id === selectedAgentId.value))
const hasActiveFilter = computed(() => !!search.value.trim() || !!groupFilter.value || statusFilter.value !== 'all')

const bucketCards: Array<{ bucket: StatusBucket; tone: string }> = [
  { bucket: 'abnormal', tone: 'bad' },
  { bucket: 'attention', tone: 'warn' },
  { bucket: 'healthy', tone: 'good' },
  { bucket: 'inactive', tone: 'neutral' },
]

function fmtSnapshot(value: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false })
}

// The snapshot chip is the only "is this current?" signal on the page, so it must
// distinguish a frozen snapshot (tab was hidden, refresh still pending) from a
// live one. It deliberately stays a single fixed-height chip rather than a banner:
// a banner appearing/disappearing around the resume would shift the whole page and
// throw away the scroll position this view works to preserve.
const snapshotTone = computed(() => {
  const state = view.value === 'agents' ? agentStatus : targetStatus
  if (state.error && !state.loaded) return 'error'
  if (state.stale) return 'stale'
  if (state.loaded && state.syncing) return 'syncing'
  return 'live'
})
const snapshotText = computed(() => {
  const state = view.value === 'agents' ? agentStatus : targetStatus
  if (!state.loaded) return state.error ? t('targetStatus.errorBanner') : t('targetStatus.loading')
  const time = fmtSnapshot(state.generatedAt)
  return state.syncing ? t('targetStatus.resyncing', { time }) : t('targetStatus.updatedAt', { time })
})

function setView(next: TargetStatusView): void {
  view.value = next
  if (next === 'agents') applyDefaultAgentSelection()
}

function setBucket(bucket: StatusBucket): void {
  statusFilter.value = statusFilter.value === bucket ? 'all' : bucket
}

function clearFilters(): void {
  search.value = ''
  groupFilter.value = ''
  statusFilter.value = 'all'
  selectedAgentId.value = ''
  selectedTargetId.value = ''
}

function validateDeepLink(): void {
  if (!ready.value || !targetStatus.loaded) return
  const validGroupIDs = new Set([...groups.value.map((group) => group.id), ...targetStatus.targets.map((row) => row.group_id)])
  if (groupFilter.value && !validGroupIDs.has(groupFilter.value)) groupFilter.value = ''

  if (selectedTargetId.value && !selectedTarget.value) {
    selectedTargetId.value = ''
  }
  if (
    selectedAgentId.value
    && agentStatus.loaded
    && !selectedAgentRow.value
    && !selectedTargetAgent.value
  ) {
    selectedAgentId.value = ''
  }

}

function applyDefaultAgentSelection(): void {
  if (view.value !== 'agents') return
  if (visibleAgents.value.some((agent) => agent.id === selectedAgentId.value)) return
  selectedAgentId.value = visibleAgents.value[0]?.id || ''
}

function querySnapshot(): Record<string, string> {
  const query: Record<string, string> = { view: view.value }
  if (targetStatus.requestedTimeRange !== '24h') query.window = targetStatus.requestedTimeRange
  if (selectedAgentId.value) query.agent = selectedAgentId.value
  if (view.value === 'agents') {
    if (agentSearch.value.trim()) query.aq = agentSearch.value.trim()
    if (agentGroupFilter.value !== 'all') query.agroup = agentGroupFilter.value
    if (agentStatusFilter.value !== 'all') query.astatus = agentStatusFilter.value
    if (agentTab.value !== 'overview') query.tab = agentTab.value
    if (agentTab.value === 'history' && agentHistoryMode.value !== 'connectivity') query.history = agentHistoryMode.value
    if (agentTab.value === 'history' && agentHistoryMode.value === 'target' && selectedTargetId.value) {
      query.target = selectedTargetId.value
    }
  } else {
    if (search.value.trim()) query.q = search.value.trim()
    if (groupFilter.value) query.group = groupFilter.value
    if (statusFilter.value !== 'all') query.status = statusFilter.value
    if (selectedTargetId.value) query.target = selectedTargetId.value
    if (selectedTargetId.value && targetTab.value !== 'overview') query.ttab = targetTab.value
  }
  return query
}

function sameQuery(a: Record<string, unknown>, b: Record<string, string>): boolean {
  const current = Object.fromEntries(Object.entries(a).filter(([, value]) => typeof value === 'string' && value !== '')) as Record<string, string>
  const keys = new Set([...Object.keys(current), ...Object.keys(b)])
  for (const key of keys) if (current[key] !== b[key]) return false
  return true
}

watch(() => route.query, () => {
  // Ignore the destination route update while this page is being unmounted;
  // navigating to history/configuration must not erase the remembered target.
  if (route.path !== '/target-status') return
  applyRouteQuery()
  validateDeepLink()
  applyDefaultAgentSelection()
}, { deep: true })

watch([
  view,
  search,
  groupFilter,
  statusFilter,
  agentSearch,
  agentGroupFilter,
  agentStatusFilter,
  agentTab,
  agentHistoryMode,
  targetTab,
  selectedTargetId,
  selectedAgentId,
  () => targetStatus.requestedTimeRange,
], () => {
  if (!ready.value || applyingRoute) return
  const query = querySnapshot()
  if (!sameQuery(route.query, query)) router.replace({ query })
})

watch([statusGroups, selectedTarget], () => {
  validateDeepLink()
}, { deep: true })

watch([search, groupFilter, statusFilter], () => {
  if (!ready.value || !selectedTargetId.value) return
  const visible = statusGroups.value.some((group) => group.targets.some((row) => row.target_id === selectedTargetId.value))
  if (!visible) {
    selectedTargetId.value = ''
    selectedAgentId.value = ''
  }
})

watch(
  [visibleAgents, view, selectedAgentId, () => agentStatus.loaded],
  applyDefaultAgentSelection,
  { immediate: true },
)

async function loadMetadata(): Promise<void> {
  metaError.value = ''
  try {
    ;[groups.value, agentGroups.value] = await Promise.all([
      api.monitorGroups(SITE),
      api.agentGroups(SITE),
    ])
  } catch (error) {
    metaError.value = String((error as Error).message || error)
  } finally {
    ready.value = true
    validateDeepLink()
    applyDefaultAgentSelection()
    const query = querySnapshot()
    if (!sameQuery(route.query, query)) router.replace({ query })
  }
}

onMounted(loadMetadata)

// The document (window) is the scroll container. Because this view is kept alive,
// its DOM survives navigation at full height, so we just stash the offset on the
// way out and restore it on return — vue-router gives no savedPosition for the
// push navigations triggered by clicking a sidebar link.
let savedScrollY = 0
onDeactivated(() => {
  savedScrollY = window.scrollY
})
onActivated(() => {
  nextTick(() => window.scrollTo(0, savedScrollY))
})
</script>

<template>
  <main class="page">
    <div class="page-head status-head">
      <div>
        <h2>{{ t('targetStatus.title') }}</h2>
        <p class="sub">{{ t('targetStatus.sub') }}</p>
      </div>
      <div class="status-head-actions">
        <div class="availability-control">
          <span class="availability-control-label">{{ t('targetStatus.timeRange') }}</span>
          <div class="availability-window" role="group" :aria-label="t('targetStatus.timeRange')">
            <button
              v-for="range in timeRanges"
              :key="range"
              type="button"
              :class="{ active: targetStatus.requestedTimeRange === range }"
              :aria-pressed="targetStatus.requestedTimeRange === range"
              :disabled="targetStatus.syncing && targetStatus.requestedTimeRange === range"
              @click="setTargetStatusTimeRange(range)"
            >
              {{ t(`targetStatus.range${range}`) }}
            </button>
          </div>
        </div>
        <div class="view-switch" role="tablist" :aria-label="t('targetStatus.viewSwitchAria')">
          <button
            type="button"
            role="tab"
            :class="{ active: view === 'agents' }"
            :aria-selected="view === 'agents'"
            @click="setView('agents')"
          >
            {{ t('targetStatus.viewAgents') }}
          </button>
          <button
            type="button"
            role="tab"
            :class="{ active: view === 'targets' }"
            :aria-selected="view === 'targets'"
            @click="setView('targets')"
          >
            {{ t('targetStatus.viewTargets') }}
          </button>
        </div>
        <div class="snapshot" :class="snapshotTone">
          <span class="snapshot-dot" :class="snapshotTone"></span>
          <span>{{ snapshotText }}</span>
        </div>
      </div>
    </div>

    <p v-if="metaError" class="err" role="alert">{{ t('targetStatus.groupLoadError') }} {{ metaError }}</p>
    <p
      v-if="view === 'agents' && ((!agentStatus.loaded && agentStatus.error) || (!targetStatus.loaded && targetStatus.error))"
      class="err"
      role="alert"
    >
      {{ t('targetStatus.errorBanner') }}
    </p>
    <p
      v-else-if="view === 'targets' && targetStatus.error && !targetStatus.loaded"
      class="err"
      role="alert"
    >
      {{ t('targetStatus.errorBanner') }}
    </p>
    <p
      v-else-if="view === 'agents' && (agentStatus.stale || targetStatus.stale)"
      class="status-banner stale"
      role="status"
    >
      {{ t('targetStatus.staleBanner', { time: fmtSnapshot(agentStatus.generatedAt) }) }}
    </p>
    <p v-else-if="view === 'targets' && targetStatus.stale" class="status-banner stale" role="status">
      {{ t('targetStatus.staleBanner', { time: fmtSnapshot(targetStatus.generatedAt) }) }}
    </p>

    <template v-if="view === 'agents'">
      <div
        v-if="!ready || (!agentStatus.loaded && !agentStatus.error) || (!targetStatus.loaded && !targetStatus.error)"
        class="card loading-card"
      >
        {{ t('targetStatus.loading') }}
      </div>

      <AgentStatusWorkspace
        v-else-if="ready && agentStatus.loaded && targetStatus.loaded && !metaError"
        :agents="visibleAgents"
        :targets="targetStatus.targets"
        :groups="groups"
        :agent-groups="agentGroups"
        :selected-agent-id="selectedAgentId"
        :selected-target-id="selectedTargetId"
        :search="agentSearch"
        :group-filter="agentGroupFilter"
        :status-filter="agentStatusFilter"
        :tab="agentTab"
        :history-mode="agentHistoryMode"
        :range-sec="rangeSec"
        @update:selected-agent-id="selectedAgentId = $event"
        @update:selected-target-id="selectedTargetId = $event"
        @update:search="agentSearch = $event"
        @update:group-filter="agentGroupFilter = $event"
        @update:status-filter="agentStatusFilter = $event"
        @update:tab="agentTab = $event"
        @update:history-mode="agentHistoryMode = $event"
      />
    </template>

    <template v-else>
    <section v-if="targetStatus.loaded" class="summary-grid" :aria-label="t('targetStatus.summaryAria')">
      <div class="summary-card overview-card">
        <div class="donut" :style="donutStyle" aria-hidden="true"><span>{{ summary.total }}</span></div>
        <div>
          <span>{{ t('targetStatus.siteSummary') }}</span>
          <strong>{{ t('targetStatus.groupCount', { n: groups.length }) }}</strong>
          <small>{{ t('targetStatus.totalTargetsAndAgents', { targets: summary.total, agents: new Set(targetStatus.targets.flatMap((row) => row.agents.map((agent) => agent.agent_id))).size }) }}</small>
        </div>
      </div>
      <button
        v-for="card in bucketCards"
        :key="card.bucket"
        type="button"
        class="summary-card bucket-card"
        :class="[card.tone, { active: statusFilter === card.bucket }]"
        :aria-pressed="statusFilter === card.bucket"
        @click="setBucket(card.bucket)"
      >
        <span>{{ t(`targetStatus.bucket.${card.bucket}`) }}</span>
        <strong>{{ summary[card.bucket] }}</strong>
        <small>{{ t(`targetStatus.bucketHint.${card.bucket}`) }}</small>
      </button>
    </section>

    <section v-if="targetStatus.loaded" class="filter-bar" :aria-label="t('targetStatus.filtersAria')">
      <label class="search-control">
        <span aria-hidden="true">⌕</span>
        <input v-model="search" type="search" :placeholder="t('targetStatus.searchPlaceholder')" />
      </label>
      <label>
        <span class="sr-only">{{ t('targetStatus.groupFilter') }}</span>
        <select v-model="groupFilter">
          <option value="">{{ t('targetStatus.allGroups') }}</option>
          <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>
      </label>
      <label>
        <span class="sr-only">{{ t('targetStatus.statusFilter') }}</span>
        <select v-model="statusFilter">
          <option value="all">{{ t('targetStatus.allStates') }}</option>
          <optgroup :label="t('targetStatus.summaryCategories')">
            <option v-for="card in bucketCards" :key="card.bucket" :value="card.bucket">{{ t(`targetStatus.bucket.${card.bucket}`) }}</option>
          </optgroup>
          <optgroup :label="t('targetStatus.detailedStates')">
            <option v-for="state in DISPLAY_STATE_ORDER" :key="state" :value="state">{{ t(`targetStatus.display.${state}`) }}</option>
          </optgroup>
        </select>
      </label>
      <button type="button" class="btn btn-ghost reset-filter" :disabled="!hasActiveFilter" @click="clearFilters">
        {{ t('targetStatus.resetFilters') }}
      </button>
    </section>

    <div v-if="!ready || (!targetStatus.loaded && !targetStatus.error)" class="card loading-card">
      {{ t('targetStatus.loading') }}
    </div>

    <TargetStatusBoard
      v-else-if="targetStatus.loaded && !metaError"
      :groups="statusGroups"
      :selected-target-id="selectedTargetId"
      :selected-agent-id="selectedAgentId"
      :tab="targetTab"
      :range-sec="rangeSec"
      @update:selected-target-id="selectedTargetId = $event"
      @update:selected-agent-id="selectedAgentId = $event"
      @update:tab="targetTab = $event"
    />
    </template>
  </main>
</template>

<style scoped>
/* Hallmark · genre: custom application · macrostructure: Workbench · design-system: design.md · designed-as-app
 * post-emit critique: P5 H5 E4 S5 R5 V5
 */
.status-head {
  align-items: flex-start;
}

.status-head > div:first-child {
  min-width: 0;
  flex: 1;
}

.status-head h2 {
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}

.status-head .sub {
  margin-top: var(--space-2xs);
}

.status-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-xs);
  min-width: 0;
}

.view-switch {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: var(--space-3xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
}

.availability-control {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: var(--space-3xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
}

.availability-control-label {
  padding-inline: var(--space-2xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  white-space: nowrap;
}

.availability-window {
  display: inline-grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  padding-left: var(--space-3xs);
  border-left: var(--rule-hair) solid var(--color-rule);
}

.availability-window button {
  min-width: 66px;
  min-height: 36px;
  padding-inline: var(--space-2xs);
  border: 0;
  border-radius: calc(var(--radius-input) - var(--space-3xs));
  color: var(--color-ink-2);
  background: transparent;
  font-size: var(--text-xs);
  cursor: pointer;
}

.availability-window button.active {
  color: var(--color-ink);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-card);
}

.availability-window button:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(var(--rule-fine) * -1);
}

.availability-window button:disabled {
  cursor: progress;
}

@media (hover: hover) and (pointer: fine) {
  .availability-window button:not(.active):hover {
    color: var(--color-ink);
    background: var(--color-glass-hover);
  }
}

.view-switch button {
  min-width: 92px;
  min-height: 44px;
  padding-inline: var(--space-xs);
  border: 0;
  border-radius: calc(var(--radius-input) - var(--space-3xs));
  color: var(--color-ink-2);
  background: transparent;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: color var(--dur-micro) var(--ease-out), background var(--dur-micro) var(--ease-out);
}

.view-switch button.active {
  color: var(--color-ink);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-card);
}

.view-switch button:focus-visible {
  position: relative;
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(var(--rule-fine) * -1);
}

.view-switch button:active {
  transform: translateY(var(--rule-fine));
}

.view-switch button:disabled {
  color: var(--color-muted);
  cursor: not-allowed;
  opacity: 0.55;
}

@media (hover: hover) and (pointer: fine) {
  .view-switch button:not(.active):not(:disabled):hover {
    color: var(--color-ink);
    background: var(--color-glass-hover);
  }
}

.snapshot {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 44px;
  padding: var(--space-2xs) var(--space-xs);
  border: var(--rule-hair) solid var(--glass-border);
  border-radius: var(--radius-input);
  color: var(--color-ink-2);
  background: var(--color-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.snapshot.stale {
  color: var(--color-warning-text);
  border-color: var(--color-warning);
}

.snapshot.syncing {
  color: var(--color-muted);
}

.snapshot-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
}

.snapshot-dot.live {
  background: var(--color-success);
}

.snapshot-dot.stale {
  background: var(--color-warning);
}

.snapshot-dot.syncing {
  background: var(--color-muted);
  animation: snapshot-blink var(--dur-long) var(--ease-in-out) infinite alternate;
}

.snapshot-dot.error {
  background: var(--color-danger);
}

@keyframes snapshot-blink {
  to { opacity: 0.35; }
}

.status-banner,
.focus-banner {
  margin-bottom: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-input);
  font-size: var(--text-sm);
}

.status-banner.stale {
  color: var(--color-warning-text);
  border: var(--rule-hair) solid var(--color-warning);
  background: var(--color-paper-2);
}

.focus-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-ink-2);
  border: var(--rule-hair) solid var(--color-rule-2);
  background: var(--color-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.focus-banner button {
  min-height: 44px;
  margin-left: auto;
  padding: 0 var(--space-2xs);
  border: 0;
  color: var(--color-accent-text);
  background: none;
  cursor: pointer;
  white-space: nowrap;
}

.focus-banner button:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
  border-radius: var(--radius-xs);
}

.summary-grid {
  display: grid;
  grid-template-columns: 1.2fr repeat(4, minmax(120px, 1fr));
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.summary-card {
  min-width: 0;
  min-height: 104px;
  padding: var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  color: inherit;
  background: var(--glass-specular), var(--color-glass-strong);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  text-align: left;
}

.overview-card {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.overview-card > div:last-child,
.bucket-card {
  display: flex;
  flex-direction: column;
}

.summary-card span {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.summary-card strong {
  margin-top: var(--space-2xs);
  font-family: var(--font-outlier);
  font-size: var(--text-xl);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.overview-card strong {
  font-family: var(--font-display);
  font-size: var(--text-md);
  letter-spacing: -0.018em;
}

.summary-card small {
  margin-top: var(--space-2xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.bucket-card {
  cursor: pointer;
  transition: transform var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out);
}

.bucket-card:hover {
  transform: translateY(-1px);
  border-color: var(--color-rule-2);
}

.bucket-card:active {
  transform: translateY(1px);
}

.bucket-card:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}

.bucket-card.bad strong {
  color: var(--color-danger-text);
}

.bucket-card.warn strong {
  color: var(--color-warning-text);
}

.bucket-card.good strong {
  color: var(--color-success-text);
}

.bucket-card.neutral strong {
  color: var(--color-ink-2);
}

.bucket-card.active {
  border-color: var(--color-accent);
}

.donut {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--color-paper-3);
  position: relative;
}

.donut::after {
  content: '';
  position: absolute;
  inset: 10px;
  border-radius: var(--radius-pill);
  background: var(--color-paper-2);
}

.donut span {
  position: relative;
  z-index: var(--z-base);
  color: var(--color-ink);
  font-family: var(--font-outlier);
  font-size: var(--text-sm);
  font-weight: 700;
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 210px 210px auto;
  gap: var(--space-xs);
  padding: var(--space-sm);
  margin-bottom: var(--space-sm);
  border: var(--rule-hair) solid var(--glass-border);
  border-radius: var(--radius-panel);
  background: var(--glass-specular-soft), var(--color-glass);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.filter-bar select {
  width: 100%;
  min-height: 44px;
}

.search-control {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  padding-left: var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
}

.search-control:focus-within {
  border-color: var(--color-focus);
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}

.search-control > span {
  color: var(--color-muted);
}

.search-control input {
  width: 100%;
  min-height: 44px;
  padding-left: 0;
  border: 0;
  box-shadow: none;
  background: transparent;
}

.reset-filter {
  min-height: 44px;
}

.filter-result {
  margin: 0 var(--space-3xs) var(--space-xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.loading-card,
.empty-state {
  padding: var(--space-xl) var(--space-md);
  border: var(--rule-hair) solid var(--color-rule);
  background: var(--color-paper-2);
  color: var(--color-muted);
  text-align: center;
}

.empty-state h3 {
  margin: 0;
  color: var(--color-ink);
}

.empty-state p {
  margin: var(--space-2xs) 0 var(--space-sm);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 960px) {
  .summary-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .overview-card {
    grid-column: 1 / -1;
  }

  .filter-bar {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .search-control {
    grid-column: 1 / -1;
  }
}

@media (max-width: 768px) {
  .status-head {
    gap: var(--space-xs);
  }

  .status-head-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .view-switch {
    flex: 1 1 240px;
  }

  .availability-control {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1 1 100%;
  }

  .availability-control-label {
    padding-block: var(--space-2xs);
  }

  .availability-window {
    width: 100%;
    padding-top: var(--space-3xs);
    padding-left: 0;
    border-top: var(--rule-hair) solid var(--color-rule);
    border-left: 0;
  }

  .availability-window button {
    min-width: 0;
  }

  .view-switch button {
    min-width: 0;
  }

  .snapshot {
    width: fit-content;
  }

  .summary-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-2xs);
  }

  .overview-card {
    grid-column: 1 / -1;
  }

  .summary-card {
    min-height: 92px;
    padding: var(--space-xs);
  }

  .summary-card strong {
    font-size: var(--text-lg);
  }

  .focus-banner {
    flex-wrap: wrap;
  }
}

@media (max-width: 414px) {
  .filter-bar {
    grid-template-columns: minmax(0, 1fr);
  }

  .search-control,
  .reset-filter {
    grid-column: 1;
  }

  .focus-banner button {
    flex-basis: 100%;
    justify-content: flex-start;
    margin-left: 0;
  }
}

@media (max-width: 375px) {
  .overview-card {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .snapshot-dot.syncing {
    animation-duration: var(--dur-micro);
  }

  .bucket-card {
    transition-duration: var(--dur-micro);
  }
}
</style>
