<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type AgentGroup, type MonitorGroup, type TargetStatusRow } from '../api'
import TargetStatusGroup from '../components/status/TargetStatusGroup.vue'
import { targetStatus } from '../targetStatus'
import {
  DISPLAY_STATE_ORDER,
  buildStatusGroups,
  countStatuses,
  isStatusFilter,
  type StatusBucket,
  type StatusFilter,
} from '../lib/targetStatusPage'
import { toDateLocale } from '../i18n'
import { loadTargetStatusExpansion, saveTargetStatusExpansion } from '../lib/targetStatusExpansion'

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

const search = ref('')
const groupFilter = ref('')
const statusFilter = ref<StatusFilter>('all')
const storedExpansion = loadTargetStatusExpansion()
const selectedTargetId = ref(storedExpansion?.expandedTargetId ?? '')
const selectedAgentId = ref('')
const expandedGroups = ref<Set<string>>(new Set(storedExpansion?.expandedGroupIds ?? []))
let initialExpansionApplied = storedExpansion !== null
let initialRouteQueryApplied = false
// A URL target should reveal its group once when the user first enters that
// deep link. It must not be re-applied by every target-status batch refresh.
let pendingRouteTargetReveal = ''
let applyingRoute = false

const queryText = (value: unknown): string => typeof value === 'string' ? value : ''

function applyRouteQuery(): void {
  applyingRoute = true
  search.value = queryText(route.query.q)
  groupFilter.value = queryText(route.query.group)
  const rawStatus = queryText(route.query.status)
  statusFilter.value = isStatusFilter(rawStatus) ? rawStatus : 'all'
  const targetFromRoute = queryText(route.query.target)
  const routeHasTarget = Object.prototype.hasOwnProperty.call(route.query, 'target')
  const firstRouteApplication = !initialRouteQueryApplied
  if (initialRouteQueryApplied || routeHasTarget) {
    if (targetFromRoute && ((firstRouteApplication && routeHasTarget) || targetFromRoute !== selectedTargetId.value)) {
      pendingRouteTargetReveal = targetFromRoute
    }
    selectedTargetId.value = targetFromRoute
  }
  selectedAgentId.value = queryText(route.query.agent)
  initialRouteQueryApplied = true
  applyingRoute = false
}

applyRouteQuery()

const filters = computed(() => ({
  search: search.value,
  groupId: groupFilter.value,
  status: statusFilter.value,
  agentId: selectedAgentId.value,
}))

const statusGroups = computed(() => buildStatusGroups(groups.value, targetStatus.targets, agentGroups.value, filters.value))
const summary = computed(() => countStatuses(targetStatus.targets))
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
const selectedAgent = computed(() => {
  if (!selectedAgentId.value) return undefined
  const inTarget = selectedTarget.value?.agents.find((agent) => agent.agent_id === selectedAgentId.value)
  if (inTarget) return inTarget
  for (const row of targetStatus.targets) {
    const agent = row.agents.find((item) => item.agent_id === selectedAgentId.value)
    if (agent) return agent
  }
  return undefined
})
const hasActiveFilter = computed(() => !!search.value.trim() || !!groupFilter.value || statusFilter.value !== 'all' || !!selectedAgentId.value)
const visibleTargetCount = computed(() => statusGroups.value.reduce((sum, group) => sum + group.targets.length, 0))

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
  if (targetStatus.error && !targetStatus.loaded) return 'error'
  if (targetStatus.stale) return 'stale'
  if (targetStatus.loaded && targetStatus.syncing) return 'syncing'
  return 'live'
})
const snapshotText = computed(() => {
  if (!targetStatus.loaded) return targetStatus.error ? t('targetStatus.errorBanner') : t('targetStatus.loading')
  const time = fmtSnapshot(targetStatus.generatedAt)
  return targetStatus.syncing ? t('targetStatus.resyncing', { time }) : t('targetStatus.updatedAt', { time })
})

function toggleGroup(id: string): void {
  const next = new Set(expandedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedGroups.value = next
}

async function toggleTarget(row: TargetStatusRow): Promise<void> {
  if (selectedTargetId.value === row.target_id) {
    selectedTargetId.value = ''
    return
  }
  selectedTargetId.value = row.target_id
  const next = new Set(expandedGroups.value)
  next.add(row.group_id)
  expandedGroups.value = next
  await nextTick()
  document.getElementById(`target-status-${row.target_id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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

function clearFocus(): void {
  selectedAgentId.value = ''
  selectedTargetId.value = ''
}

function validateDeepLink(): void {
  if (!ready.value || !targetStatus.loaded) return
  const validGroupIDs = new Set([...groups.value.map((group) => group.id), ...targetStatus.targets.map((row) => row.group_id)])
  if (groupFilter.value && !validGroupIDs.has(groupFilter.value)) groupFilter.value = ''

  if (selectedTargetId.value && !selectedTarget.value) {
    if (pendingRouteTargetReveal === selectedTargetId.value) pendingRouteTargetReveal = ''
    selectedTargetId.value = ''
  }
  if (selectedAgentId.value && !selectedAgent.value) selectedAgentId.value = ''

  const next = new Set([...expandedGroups.value].filter((id) => validGroupIDs.has(id)))
  if (pendingRouteTargetReveal && selectedTarget.value?.target_id === pendingRouteTargetReveal) {
    next.add(selectedTarget.value.group_id)
    pendingRouteTargetReveal = ''
  }
  if (next.size !== expandedGroups.value.size || [...next].some((id) => !expandedGroups.value.has(id))) {
    expandedGroups.value = next
  }
}

function applyDefaultExpansion(): void {
  if (!ready.value || !targetStatus.loaded || initialExpansionApplied || !statusGroups.value.length) return
  const next = new Set<string>()
  for (const group of statusGroups.value) if (group.counts.abnormal > 0) next.add(group.id)
  if (!next.size) next.add(statusGroups.value[0].id)
  if (selectedTarget.value) next.add(selectedTarget.value.group_id)
  if (groupFilter.value) next.add(groupFilter.value)
  expandedGroups.value = next
  initialExpansionApplied = true
}

function querySnapshot(): Record<string, string> {
  const query: Record<string, string> = {}
  if (search.value.trim()) query.q = search.value.trim()
  if (groupFilter.value) query.group = groupFilter.value
  if (statusFilter.value !== 'all') query.status = statusFilter.value
  if (selectedTargetId.value) query.target = selectedTargetId.value
  if (selectedAgentId.value) query.agent = selectedAgentId.value
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
}, { deep: true })

watch([expandedGroups, selectedTargetId], () => {
  saveTargetStatusExpansion({
    expandedGroupIds: [...expandedGroups.value],
    expandedTargetId: selectedTargetId.value,
  })
})

watch([search, groupFilter, statusFilter, selectedTargetId, selectedAgentId], () => {
  if (!ready.value || applyingRoute) return
  const query = querySnapshot()
  if (!sameQuery(route.query, query)) router.replace({ query })
})

watch([statusGroups, selectedTarget], () => {
  validateDeepLink()
  applyDefaultExpansion()
}, { deep: true })

watch([search, groupFilter, statusFilter], () => {
  if (!ready.value || !selectedTargetId.value) return
  const visible = statusGroups.value.some((group) => group.targets.some((row) => row.target_id === selectedTargetId.value))
  if (!visible) {
    selectedTargetId.value = ''
    selectedAgentId.value = ''
  }
})

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
    applyDefaultExpansion()
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
  <main class="page target-status-page">
    <div class="page-head status-head">
      <div>
        <h2>{{ t('targetStatus.title') }}</h2>
        <p class="sub">{{ t('targetStatus.sub') }}</p>
      </div>
      <div class="snapshot" :class="snapshotTone">
        <span class="snapshot-dot" :class="snapshotTone"></span>
        <span>{{ snapshotText }}</span>
      </div>
    </div>

    <p v-if="metaError" class="err" role="alert">{{ t('targetStatus.groupLoadError') }} {{ metaError }}</p>
    <p v-if="targetStatus.error && !targetStatus.loaded" class="err" role="alert">{{ t('targetStatus.errorBanner') }}</p>
    <p v-else-if="targetStatus.stale" class="status-banner stale" role="status">
      {{ t('targetStatus.staleBanner', { time: fmtSnapshot(targetStatus.generatedAt) }) }}
    </p>

    <div v-if="selectedTarget || selectedAgent" class="focus-banner">
      <span>{{ t('targetStatus.focusedOn') }}</span>
      <strong v-if="selectedTarget">{{ selectedTarget.name || selectedTarget.target }}</strong>
      <span v-if="selectedTarget && selectedAgent">/</span>
      <strong v-if="selectedAgent">{{ selectedAgent.agent_name || selectedAgent.agent_id }}</strong>
      <button type="button" @click="clearFocus">{{ t('targetStatus.clearFocus') }}</button>
    </div>

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

    <template v-else-if="targetStatus.loaded && !metaError">
      <p v-if="hasActiveFilter" class="filter-result">
        {{ t('targetStatus.filterResult', { targets: visibleTargetCount, groups: statusGroups.length }) }}
      </p>

      <TargetStatusGroup
        v-for="view in statusGroups"
        :id="`target-status-group-${view.id}`"
        :key="view.id"
        :view="view"
        :expanded="expandedGroups.has(view.id)"
        :selected-target-id="selectedTargetId"
        :selected-agent-id="selectedAgentId"
        @toggle-group="toggleGroup(view.id)"
        @toggle-target="toggleTarget"
      />

      <div v-if="!statusGroups.length" class="card empty-state">
        <h3>{{ hasActiveFilter ? t('targetStatus.noFilterResults') : t('targetStatus.noGroups') }}</h3>
        <p>{{ hasActiveFilter ? t('targetStatus.noFilterResultsHint') : t('targetStatus.noGroupsHint') }}</p>
        <button v-if="hasActiveFilter" type="button" class="btn" @click="clearFilters">{{ t('targetStatus.resetFilters') }}</button>
        <router-link v-else class="btn btn-primary" to="/monitoring/groups/new">{{ t('targetStatus.createGroup') }}</router-link>
      </div>
    </template>
  </main>
</template>

<style scoped>
.target-status-page { max-width: 1240px; }
.status-head { align-items: flex-start; }
.status-head > div:first-child { min-width: 0; flex: 1; }
.status-head .sub { margin-top: 7px; }
.snapshot {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  background: var(--surface);
  font-size: 11px;
}
.snapshot.stale { color: var(--warning); border-color: rgba(251, 191, 36, 0.3); }
.snapshot.syncing { color: var(--text-muted); }
.snapshot-dot { width: 7px; height: 7px; border-radius: 50%; }
.snapshot-dot.live { background: var(--success); }
.snapshot-dot.stale { background: var(--warning); }
.snapshot-dot.syncing { background: var(--text-muted); animation: snapshot-blink 1.1s ease-in-out infinite; }
.snapshot-dot.error { background: var(--danger); }
@keyframes snapshot-blink {
  50% { opacity: 0.3; }
}
.status-banner,
.focus-banner {
  margin-bottom: 14px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.status-banner.stale { color: var(--warning); border: 1px solid rgba(251, 191, 36, 0.3); background: var(--warning-soft); }
.focus-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  border: 1px solid rgba(56, 189, 248, 0.28);
  background: var(--primary-soft);
}
.focus-banner button { margin-left: auto; padding: 0; border: 0; color: var(--primary); background: none; cursor: pointer; }
.summary-grid {
  display: grid;
  grid-template-columns: 1.2fr repeat(4, minmax(120px, 1fr));
  gap: 11px;
  margin-bottom: 14px;
}
.summary-card {
  min-height: 92px;
  padding: 14px 15px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: inherit;
  background: linear-gradient(155deg, var(--surface-2), var(--surface));
  box-shadow: var(--shadow-soft);
  text-align: left;
}
.overview-card { display: flex; align-items: center; gap: 16px; }
.overview-card > div:last-child,
.bucket-card { display: flex; flex-direction: column; }
.summary-card span { color: var(--text-muted); font-size: 10.5px; }
.summary-card strong { margin-top: 7px; font-size: 24px; line-height: 1.1; }
.overview-card strong { font-size: 19px; }
.summary-card small { margin-top: 6px; color: var(--text-muted); font-size: 9.5px; }
.bucket-card { cursor: pointer; }
.bucket-card.bad strong { color: var(--danger); }
.bucket-card.warn strong { color: var(--warning); }
.bucket-card.good strong { color: var(--success); }
.bucket-card.neutral strong { color: var(--text-dim); }
.bucket-card.active { border-color: currentColor; box-shadow: 0 0 0 2px var(--primary-soft); }
.donut {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--surface-2);
  position: relative;
}
.donut::after { content: ''; position: absolute; inset: 10px; border-radius: 50%; background: var(--surface-solid); }
.donut span { position: relative; z-index: 1; color: var(--text); font-size: 15px; font-weight: 700; }
.filter-bar {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 210px 210px auto;
  gap: 10px;
  padding: 12px;
  margin-bottom: 15px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.filter-bar select { width: 100%; height: 39px; }
.search-control {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-left: 11px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
}
.search-control:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.search-control > span { color: var(--text-muted); }
.search-control input { width: 100%; height: 37px; padding-left: 0; border: 0; box-shadow: none; background: transparent; }
.reset-filter { min-height: 39px; }
.filter-result { margin: -3px 2px 11px; color: var(--text-muted); font-size: 11px; }
.loading-card,
.empty-state { padding: 44px 20px; color: var(--text-muted); text-align: center; }
.empty-state h3 { margin: 0; color: var(--text); }
.empty-state p { margin: 8px 0 16px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 920px) {
  .summary-grid { grid-template-columns: repeat(4, 1fr); }
  .overview-card { grid-column: 1 / -1; }
  .filter-bar { grid-template-columns: 1fr 1fr; }
  .search-control { grid-column: 1 / -1; }
}

@media (max-width: 620px) {
  .target-status-page { padding-left: 14px; padding-right: 14px; }
  .status-head { gap: 10px; }
  .snapshot { flex-basis: 100%; width: max-content; }
  .summary-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .overview-card { display: none; }
  .summary-card { min-height: 78px; padding: 11px; }
  .summary-card strong { font-size: 20px; }
  .filter-bar { grid-template-columns: 1fr 1fr; }
  .search-control { grid-column: 1 / -1; }
  .reset-filter { grid-column: 1 / -1; padding: 7px 10px; }
  .focus-banner { flex-wrap: wrap; }
}
</style>
