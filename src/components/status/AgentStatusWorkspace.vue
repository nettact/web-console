<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentGroup, AgentStatusRow, MonitorGroup, TargetStatusRow } from '../../api'
import type { AgentFilter } from '../../lib/agentStatusPage'
import { agentLabel } from '../../lib/agentLabel'
import {
  buildAgentTargetViews,
  countAgentTargets,
  defaultAgentHistoryTarget,
  type AgentHistoryMode,
  type AgentTargetView,
  type AgentWorkspaceTab,
} from '../../lib/targetStatusAgentView'
import { toDateLocale } from '../../i18n'
import OsIcon from '../agents/OsIcon.vue'
import MonitorStateBadge from './MonitorStateBadge.vue'
import TargetStatusHistory from './TargetStatusHistory.vue'
import { formatAvailability, formatAvailabilityRounds } from '../../lib/targetStatus'
import AgentConnectivityHistory from './AgentConnectivityHistory.vue'
import HostMetrics from '../../views/HostMetrics.vue'
import Processes from '../../views/Processes.vue'

const props = defineProps<{
  agents: AgentStatusRow[]
  targets: TargetStatusRow[]
  groups: MonitorGroup[]
  agentGroups: AgentGroup[]
  selectedAgentId: string
  selectedTargetId: string
  search: string
  groupFilter: string
  statusFilter: AgentFilter
  tab: AgentWorkspaceTab
  historyMode: AgentHistoryMode
  rangeSec: number
}>()

const emit = defineEmits<{
  'update:selectedAgentId': [value: string]
  'update:selectedTargetId': [value: string]
  'update:search': [value: string]
  'update:groupFilter': [value: string]
  'update:statusFilter': [value: AgentFilter]
  'update:tab': [value: AgentWorkspaceTab]
  'update:historyMode': [value: AgentHistoryMode]
}>()

const { t, locale } = useI18n()
const mobilePane = ref<'list' | 'detail'>(props.selectedAgentId ? 'detail' : 'list')
const AGENT_LIST_COLLAPSED_KEY = 'nettact.targetStatus.agentListCollapsed'
const agentListCollapsed = ref(localStorage.getItem(AGENT_LIST_COLLAPSED_KEY) === 'true')
const tabsEl = ref<HTMLElement | null>(null)
const connectionFilter = ref<{ name: string; pid: number } | null>(null)
let tabsResizeObserver: ResizeObserver | undefined

const selectedAgent = computed(() => props.agents.find((agent) => agent.id === props.selectedAgentId))
const selectedTargets = computed(() => buildAgentTargetViews(props.targets, props.selectedAgentId, props.groups))
const selectedSummary = computed(() => countAgentTargets(selectedTargets.value))
const selectedHistoryTarget = computed(() =>
  selectedTargets.value.find((row) => row.target.target_id === props.selectedTargetId)?.target,
)

const agentGroupOptions = computed(() => {
  return props.agentGroups
    .map((group) => ({ id: group.id, name: group.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const agentTargetSummaries = computed(() => {
  const summaries = new Map<string, ReturnType<typeof countAgentTargets>>()
  for (const agent of props.agents) {
    summaries.set(agent.id, countAgentTargets(buildAgentTargetViews(props.targets, agent.id, props.groups)))
  }
  return summaries
})

const priorityTargets = computed(() =>
  selectedTargets.value.filter((row) => row.tone === 'abnormal' || row.tone === 'attention').slice(0, 5),
)

function fmt(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
}

function showAgent(agentID: string, tab?: AgentWorkspaceTab): void {
  emit('update:selectedAgentId', agentID)
  if (tab) emit('update:tab', tab)
  mobilePane.value = 'detail'
}

function openTargetHistory(row: AgentTargetView): void {
  emit('update:selectedTargetId', row.target.target_id)
  emit('update:tab', 'history')
  emit('update:historyMode', 'target')
  mobilePane.value = 'detail'
}

function updateTab(tab: AgentWorkspaceTab): void {
  emit('update:tab', tab)
}

function openProcessConnections(_mode: 'connections', filter: { name: string; pid: number }): void {
  connectionFilter.value = filter
  emit('update:tab', 'connections')
}

function scrollActiveTabIntoView(): void {
  nextTick(() => {
    const activeTab = tabsEl.value?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (typeof activeTab?.scrollIntoView !== 'function') return
    activeTab.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    })
  })
}

function updateHistoryMode(mode: AgentHistoryMode): void {
  emit('update:historyMode', mode)
}

function updateHistoryTarget(targetID: string): void {
  emit('update:selectedTargetId', targetID)
}

function reasonText(agent: AgentStatusRow): string {
  if (agent.status === 'offline' && agent.connectivity_alert) {
    return t('agentStatus.offlineReason', { reason: t(`agentStatus.reason.${agent.connectivity_alert.reason}`) })
  }
  if (agent.status === 'offline' && agent.last_disconnect_kind) {
    return t(`agentStatus.disconnect.${agent.last_disconnect_kind}`)
  }
  if (agent.status === 'abnormal') {
    const reasons: string[] = []
    if (agent.firing_faults) reasons.push(t('agentStatus.reasonFaults', { n: agent.firing_faults }))
    if (agent.active_issues) reasons.push(t('agentStatus.reasonIssues', { n: agent.active_issues }))
    return reasons.join(' · ')
  }
  return ''
}

watch(
  [() => props.tab, () => props.historyMode, selectedTargets],
  () => {
    if (props.tab !== 'history' || props.historyMode !== 'target') return
    if (selectedHistoryTarget.value) return
    emit('update:selectedTargetId', defaultAgentHistoryTarget(selectedTargets.value))
  },
  { immediate: true },
)

watch(() => props.tab, scrollActiveTabIntoView, { immediate: true })
watch(agentListCollapsed, (collapsed) => {
  localStorage.setItem(AGENT_LIST_COLLAPSED_KEY, String(collapsed))
})

onMounted(() => {
  if (typeof ResizeObserver !== 'function' || !tabsEl.value) return
  tabsResizeObserver = new ResizeObserver(scrollActiveTabIntoView)
  tabsResizeObserver.observe(tabsEl.value)
})

onBeforeUnmount(() => tabsResizeObserver?.disconnect())
</script>

<template>
  <section
    class="agent-workbench"
    :class="{ 'agent-list-collapsed': agentListCollapsed }"
    :data-mobile-pane="mobilePane"
  >
    <aside class="agent-list-pane" :aria-label="t('targetStatus.agentListAria')">
      <div class="agent-list-toolbar">
        <span>{{ t('targetStatus.viewAgents') }}</span>
        <button
          type="button"
          class="agent-list-toggle"
          :aria-label="t(agentListCollapsed ? 'targetStatus.expandAgentList' : 'targetStatus.collapseAgentList')"
          :title="t(agentListCollapsed ? 'targetStatus.expandAgentList' : 'targetStatus.collapseAgentList')"
          @click="agentListCollapsed = !agentListCollapsed"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path v-if="agentListCollapsed" d="m9 5 7 7-7 7" />
            <path v-else d="m15 5-7 7 7 7" />
          </svg>
        </button>
      </div>
      <div class="agent-filters">
        <label class="agent-search">
          <span class="sr-only">{{ t('targetStatus.agentSearchLabel') }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            :value="search"
            type="search"
            :placeholder="t('targetStatus.agentSearchPlaceholder')"
            @input="emit('update:search', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <div class="agent-filter-row">
          <label>
            <span class="sr-only">{{ t('agentStatus.allGroups') }}</span>
            <select
              :value="groupFilter"
              :aria-label="t('agentStatus.allGroups')"
              @change="emit('update:groupFilter', ($event.target as HTMLSelectElement).value)"
            >
              <option value="all">{{ t('agentStatus.allGroups') }}</option>
              <option value="ungrouped">{{ t('agentStatus.ungrouped') }}</option>
              <option v-for="group in agentGroupOptions" :key="group.id" :value="group.id">{{ group.name }}</option>
            </select>
          </label>
          <label>
            <span class="sr-only">{{ t('agentStatus.allStatuses') }}</span>
            <select
              :value="statusFilter"
              :aria-label="t('agentStatus.allStatuses')"
              @change="emit('update:statusFilter', ($event.target as HTMLSelectElement).value as AgentFilter)"
            >
              <option value="all">{{ t('agentStatus.allStatuses') }}</option>
              <option value="offline">{{ t('agentStatus.statusOffline') }}</option>
              <option value="abnormal">{{ t('agentStatus.statusAbnormal') }}</option>
              <option value="never_connected">{{ t('agentStatus.statusNeverConnected') }}</option>
              <option value="ok">{{ t('agentStatus.statusOk') }}</option>
              <option value="muted">{{ t('agentStatus.muted') }}</option>
            </select>
          </label>
        </div>

        <span class="agent-result-count" aria-live="polite">
          {{ t('targetStatus.agentResultCount', { n: agents.length }) }}
        </span>
      </div>

      <div v-if="!agents.length" class="agent-list-empty">
        <strong>{{ t('targetStatus.noAgentResults') }}</strong>
        <span>{{ t('targetStatus.noAgentResultsHint') }}</span>
      </div>

      <div v-else class="agent-list">
        <article
          v-for="agent in agents"
          :key="agent.id"
          class="agent-list-row"
          :class="{ selected: selectedAgentId === agent.id }"
        >
          <button
            type="button"
            class="agent-select"
            :aria-current="selectedAgentId === agent.id ? 'true' : undefined"
            :aria-label="agentLabel(agent)"
            :title="agentListCollapsed ? agentLabel(agent) : undefined"
            @click="showAgent(agent.id)"
          >
            <span class="agent-device"><OsIcon :platform="agent.platform" :size="19" /></span>
            <span class="agent-collapsed-label">{{ agentLabel(agent).slice(0, 4) }}</span>
            <span class="agent-row-copy">
              <strong>{{ agentLabel(agent) }}</strong>
              <small>{{ agent.hostname || agent.id }}</small>
              <span v-if="reasonText(agent)" class="agent-reason">{{ reasonText(agent) }}</span>
            </span>
            <span class="agent-row-status">
              <MonitorStateBadge dim="agent" :state="agent.status" />
              <small v-if="agentTargetSummaries.get(agent.id)?.abnormal">
                {{ t('targetStatus.abnormalTargetCount', { n: agentTargetSummaries.get(agent.id)?.abnormal }) }}
              </small>
            </span>
          </button>
          <button
            type="button"
            class="agent-history-shortcut"
            :aria-label="t('targetStatus.openAgentHistoryAria', { agent: agentLabel(agent) })"
            :title="t('targetStatus.agentTabHistory')"
            @click="showAgent(agent.id, 'history')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5M12 7v5l3 2" />
            </svg>
          </button>
        </article>
      </div>
    </aside>

    <section class="agent-detail-pane" :aria-label="t('targetStatus.agentWorkspaceAria')">
      <template v-if="selectedAgent">
        <button type="button" class="mobile-back" @click="mobilePane = 'list'">
          <span aria-hidden="true">←</span>{{ t('targetStatus.backToAgentList') }}
        </button>

        <header class="agent-detail-head">
          <div class="agent-detail-identity">
            <span class="agent-detail-device"><OsIcon :platform="selectedAgent.platform" :size="23" /></span>
            <div>
              <h3>{{ agentLabel(selectedAgent) }}</h3>
              <p>{{ selectedAgent.hostname || selectedAgent.id }}</p>
            </div>
          </div>
          <div class="agent-detail-state">
            <MonitorStateBadge dim="agent" :state="selectedAgent.status" />
            <span>{{ t('targetStatus.lastSeenAt', { time: fmt(selectedAgent.last_seen_at) }) }}</span>
          </div>
        </header>

        <nav ref="tabsEl" class="agent-tabs" role="tablist" :aria-label="t('targetStatus.agentTabsAria')">
          <button
            v-for="item in ([
              { id: 'overview', label: t('targetStatus.agentTabOverview') },
              { id: 'targets', label: t('targetStatus.agentTabTargets', { n: selectedSummary.total }) },
              { id: 'history', label: t('targetStatus.agentTabHistory') },
              { id: 'metrics', label: t('targetStatus.agentTabMetrics') },
              { id: 'processes', label: t('targetStatus.agentTabProcesses') },
              { id: 'connections', label: t('targetStatus.agentTabConnections') },
            ] as Array<{ id: AgentWorkspaceTab; label: string }>)"
            :key="item.id"
            type="button"
            role="tab"
            :class="{ active: tab === item.id }"
            :aria-selected="tab === item.id"
            @click="updateTab(item.id)"
          >
            {{ item.label }}
          </button>
        </nav>

        <div class="agent-tab-content">
          <section v-if="tab === 'overview'" class="agent-overview" role="tabpanel">
            <div class="agent-summary-grid">
              <div>
                <span>{{ t('targetStatus.agentTargetsTotal') }}</span>
                <strong>{{ selectedSummary.total }}</strong>
              </div>
              <div class="tone-bad">
                <span>{{ t('targetStatus.bucket.abnormal') }}</span>
                <strong>{{ selectedSummary.abnormal }}</strong>
              </div>
              <div class="tone-warn">
                <span>{{ t('targetStatus.bucket.attention') }}</span>
                <strong>{{ selectedSummary.attention }}</strong>
              </div>
              <div class="tone-good">
                <span>{{ t('targetStatus.bucket.healthy') }}</span>
                <strong>{{ selectedSummary.healthy }}</strong>
              </div>
            </div>

            <dl class="agent-overview-facts">
              <div><dt>{{ t('agentStatus.factStatusSince') }}</dt><dd>{{ fmt(selectedAgent.status_since) }}</dd></div>
              <div><dt>{{ t('agentStatus.thLastSeen') }}</dt><dd>{{ fmt(selectedAgent.last_seen_at) }}</dd></div>
              <div><dt>{{ t('agents.thVersion') }}</dt><dd class="mono">{{ selectedAgent.agent_version || '—' }}</dd></div>
              <div>
                <dt>{{ t('agentStatus.thGroups') }}</dt>
                <dd>{{ selectedAgent.groups.map((group) => group.name).join(' · ') || t('agentStatus.ungrouped') }}</dd>
              </div>
            </dl>

            <section class="priority-targets">
              <div class="section-heading">
                <div>
                  <h4>{{ t('targetStatus.priorityTargets') }}</h4>
                  <p>{{ t('targetStatus.priorityTargetsHint') }}</p>
                </div>
                <button type="button" class="text-action" @click="updateTab('targets')">
                  {{ t('targetStatus.viewAllAgentTargets') }}
                </button>
              </div>
              <div v-if="priorityTargets.length" class="priority-list">
                <button
                  v-for="row in priorityTargets"
                  :key="row.target.target_id"
                  type="button"
                  @click="openTargetHistory(row)"
                >
                  <span>
                    <strong>{{ row.target.name || row.target.target }}</strong>
                    <small>{{ row.groupName }} · {{ row.target.kind.toUpperCase() }}</small>
                  </span>
                  <MonitorStateBadge dim="probe" :state="row.agent.probe_state" />
                  <span class="priority-action">{{ t('targetStatus.openHistory') }} →</span>
                </button>
              </div>
              <div v-else class="quiet-state">
                <strong>{{ t('targetStatus.noPriorityTargets') }}</strong>
                <span>{{ t('targetStatus.noPriorityTargetsHint') }}</span>
              </div>
            </section>
          </section>

          <section v-else-if="tab === 'targets'" class="agent-targets" role="tabpanel">
            <div class="section-heading">
              <div>
                <h4>{{ t('targetStatus.agentTargetsTitle') }}</h4>
                <p>{{ t('targetStatus.agentTargetsHint') }}</p>
              </div>
            </div>

            <div v-if="selectedTargets.length" class="agent-target-list">
              <article v-for="row in selectedTargets" :key="row.target.target_id" class="agent-target-row">
                <div class="target-row-identity">
                  <span class="kind-chip">{{ row.target.kind.toUpperCase() }}</span>
                  <span>
                    <strong>{{ row.target.name || row.target.target }}</strong>
                    <small>{{ row.groupName }} · {{ row.target.target }}</small>
                  </span>
                </div>
                <div class="target-row-states">
                  <MonitorStateBadge dim="execution" :state="row.agent.execution_state" />
                  <MonitorStateBadge v-if="row.agent.probe_state !== 'not_applicable'" dim="probe" :state="row.agent.probe_state" />
                  <MonitorStateBadge dim="fault" :state="row.agent.fault_state" />
                </div>
                <span class="target-row-availability">
                  <strong>{{ formatAvailability(row.agent.availability) ?? '—' }}</strong>
                  <small>{{ formatAvailabilityRounds(row.agent.availability_ok_rounds, row.agent.availability_rounds) ?? t('targetStatus.noVerdictRounds') }}</small>
                </span>
                <time :datetime="row.agent.last_observed_at">{{ fmt(row.agent.last_observed_at) }}</time>
                <button type="button" class="history-row-action" @click="openTargetHistory(row)">
                  {{ t('targetStatus.openHistory') }}
                </button>
              </article>
            </div>
            <div v-else class="quiet-state">
              <strong>{{ t('targetStatus.noAgentTargets') }}</strong>
              <span>{{ t('targetStatus.noAgentTargetsHint') }}</span>
            </div>
          </section>

          <section v-else-if="tab === 'history'" class="agent-history" role="tabpanel">
            <div class="history-mode-switch" role="tablist" :aria-label="t('targetStatus.historyModeAria')">
              <button
                type="button"
                role="tab"
                :class="{ active: historyMode === 'connectivity' }"
                :aria-selected="historyMode === 'connectivity'"
                @click="updateHistoryMode('connectivity')"
              >
                {{ t('targetStatus.connectionHistory') }}
              </button>
              <button
                type="button"
                role="tab"
                :class="{ active: historyMode === 'target' }"
                :aria-selected="historyMode === 'target'"
                :disabled="!selectedTargets.length"
                @click="updateHistoryMode('target')"
              >
                {{ t('targetStatus.targetProbeHistory') }}
              </button>
            </div>

            <AgentConnectivityHistory
              v-if="historyMode === 'connectivity'"
              :agent-id="selectedAgent.id"
              active
              :range-sec="rangeSec"
            />

            <div v-else class="target-history">
              <label class="target-history-picker">
                <span>{{ t('targetStatus.historyTargetLabel') }}</span>
                <select
                  :value="selectedHistoryTarget?.target_id || ''"
                  @change="updateHistoryTarget(($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="row in selectedTargets" :key="row.target.target_id" :value="row.target.target_id">
                    {{ row.target.name || row.target.target }} · {{ row.groupName }}
                  </option>
                </select>
              </label>
              <TargetStatusHistory
                v-if="selectedHistoryTarget"
                :target="selectedHistoryTarget"
                :agent-id="selectedAgent.id"
                :range-sec="rangeSec"
              />
              <div v-else class="quiet-state">
                <strong>{{ t('targetStatus.noAgentTargets') }}</strong>
                <span>{{ t('targetStatus.noAgentTargetsHint') }}</span>
              </div>
            </div>
          </section>

          <section v-else-if="tab === 'metrics'" class="agent-embedded-view" role="tabpanel">
            <HostMetrics embedded :fixed-agent-id="selectedAgent.id" :fixed-range-sec="rangeSec" />
          </section>

          <section v-else class="agent-embedded-view" role="tabpanel">
            <Processes
              embedded
              :fixed-agent-id="selectedAgent.id"
              :fixed-mode="tab === 'connections' ? 'connections' : 'processes'"
              :connection-filter-name="connectionFilter?.name || ''"
              :connection-filter-pid="connectionFilter?.pid ?? null"
              @request-mode="openProcessConnections"
            />
          </section>
        </div>
      </template>

      <div v-else class="agent-detail-empty">
        <strong>{{ t('targetStatus.selectAgentTitle') }}</strong>
        <span>{{ t('targetStatus.selectAgentHint') }}</span>
      </div>
    </section>
  </section>
</template>

<style scoped>
/* Hallmark · genre: custom application · macrostructure: Workbench + Index-First
 * design-system: design.md · designed-as-app
 * pre-emit critique: P5 H5 E4 S5 R5 V5
 */
.agent-workbench {
  min-width: 0;
  overflow: hidden;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-panel);
  background: var(--color-glass);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.agent-list-pane,
.agent-detail-pane {
  min-width: 0;
}

.agent-list-pane {
  display: block;
  background: var(--color-glass-strong);
}

.agent-list-toolbar {
  display: none;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: var(--space-2xs) var(--space-xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.agent-list-toolbar > span {
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 650;
}

.agent-list-toggle {
  display: grid;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--color-ink-2);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-subtle);
  cursor: pointer;
  place-items: center;
}

.agent-list-toggle svg {
  width: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.agent-detail-pane {
  display: none;
  container-type: inline-size;
  background: var(--color-paper-2);
}

.agent-workbench[data-mobile-pane="detail"] .agent-list-pane {
  display: none;
}

.agent-workbench[data-mobile-pane="detail"] .agent-detail-pane {
  display: block;
}

.agent-filters {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.agent-search {
  position: relative;
  display: block;
}

.agent-search svg {
  position: absolute;
  top: 50%;
  left: var(--space-xs);
  width: 17px;
  fill: none;
  stroke: var(--color-muted);
  stroke-width: 1.8;
  transform: translateY(-50%);
  pointer-events: none;
}

.agent-search input {
  width: 100%;
  min-height: 44px;
  padding-inline: calc(var(--space-xl) + var(--space-3xs)) var(--space-xs);
}

.agent-filter-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2xs);
}

.agent-filter-row select {
  width: 100%;
  min-height: 44px;
}

.agent-result-count {
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.agent-list {
  display: grid;
}

.agent-list-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: transparent;
}

.agent-list-row:last-child {
  border-bottom: 0;
}

.agent-list-row.selected {
  background: var(--color-paper-3);
}

.agent-select {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  min-height: 76px;
  padding: var(--space-xs);
  color: var(--color-ink);
  text-align: left;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.agent-device,
.agent-detail-device {
  display: grid;
  flex: none;
  place-items: center;
  color: var(--color-ink-2);
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-input);
  background: var(--color-paper-3);
}

.agent-device {
  width: 36px;
  height: 36px;
}

.agent-collapsed-label {
  display: none;
  max-width: 3rem;
  overflow: hidden;
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  font-weight: 650;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-row-copy {
  display: grid;
  min-width: 0;
}

.agent-row-copy strong,
.agent-row-copy small,
.agent-reason {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-row-copy strong {
  font-size: var(--text-sm);
}

.agent-row-copy small,
.agent-reason {
  margin-top: var(--space-3xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.agent-reason {
  color: var(--color-warning-text);
}

.agent-row-status {
  display: grid;
  justify-items: end;
  gap: var(--space-3xs);
}

.agent-row-status small {
  color: var(--color-danger-text);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.agent-history-shortcut {
  display: grid;
  width: 44px;
  min-height: 44px;
  align-self: center;
  padding: 0;
  margin-right: var(--space-2xs);
  color: var(--color-ink-2);
  border: var(--rule-hair) solid transparent;
  border-radius: var(--radius-input);
  background: transparent;
  place-items: center;
  cursor: pointer;
}

.agent-history-shortcut svg {
  width: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.agent-list-empty,
.agent-detail-empty,
.quiet-state {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-lg);
  color: var(--color-ink-2);
}

.agent-list-empty strong,
.agent-detail-empty strong,
.quiet-state strong {
  color: var(--color-ink);
}

.agent-list-empty span,
.agent-detail-empty span,
.quiet-state span {
  font-size: var(--text-sm);
}

.mobile-back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 44px;
  padding: 0 var(--space-xs);
  margin: var(--space-2xs) var(--space-xs) 0;
  color: var(--color-accent-text);
  font: inherit;
  font-size: var(--text-sm);
  border: 0;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.agent-detail-head {
  display: grid;
  gap: var(--space-xs);
  padding: var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.agent-detail-identity {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.agent-detail-device {
  width: 44px;
  height: 44px;
}

.agent-detail-identity > div {
  min-width: 0;
}

.agent-detail-identity h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-detail-identity p,
.agent-detail-state span {
  margin: var(--space-3xs) 0 0;
  overflow: hidden;
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-detail-state {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.agent-tabs,
.history-mode-switch {
  display: flex;
  gap: var(--space-3xs);
  padding: var(--space-3xs) var(--space-xs);
  overflow-x: auto;
  border-bottom: var(--rule-hair) solid var(--color-rule);
  scrollbar-width: none;
}

.agent-tabs::-webkit-scrollbar,
.history-mode-switch::-webkit-scrollbar {
  display: none;
}

.agent-tabs button,
.history-mode-switch button {
  min-height: 44px;
  padding-inline: var(--space-xs);
  color: var(--color-ink-2);
  font: inherit;
  font-size: var(--text-sm);
  border: 0;
  border-radius: var(--radius-input);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.agent-tabs button.active,
.history-mode-switch button.active {
  color: var(--color-primary-action-text);
  background: var(--color-primary-action-bg);
}

.agent-tabs button:disabled,
.history-mode-switch button:disabled {
  opacity: .5;
  cursor: not-allowed;
}

.agent-tab-content {
  min-width: 0;
  padding: var(--space-sm);
}

.agent-overview,
.agent-targets,
.agent-history,
.agent-embedded-view,
.target-history {
  min-width: 0;
}

.agent-embedded-view {
  container-type: inline-size;
}

.agent-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rule-hair);
  overflow: hidden;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-rule);
}

.agent-summary-grid > div {
  display: grid;
  gap: var(--space-3xs);
  min-height: 78px;
  padding: var(--space-xs);
  background: var(--color-paper-3);
}

.agent-summary-grid span {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.agent-summary-grid strong {
  font-family: var(--font-outlier);
  font-size: var(--text-xl);
  font-variant-numeric: tabular-nums;
}

.agent-summary-grid .tone-bad strong {
  color: var(--color-danger-text);
}

.agent-summary-grid .tone-warn strong {
  color: var(--color-warning-text);
}

.agent-summary-grid .tone-good strong {
  color: var(--color-success-text);
}

.agent-overview-facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-xs);
  padding: var(--space-sm) 0;
  margin: 0;
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.agent-overview-facts div {
  min-width: 0;
}

.agent-overview-facts dt {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.agent-overview-facts dd {
  margin: var(--space-3xs) 0 0;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.section-heading h4 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-md);
  font-style: normal;
}

.section-heading p {
  margin: var(--space-3xs) 0 0;
  color: var(--color-ink-2);
  font-size: var(--text-sm);
}

.priority-targets {
  padding-top: var(--space-sm);
}

.text-action,
.history-row-action {
  min-height: 44px;
  padding-inline: var(--space-xs);
  color: var(--color-accent-text);
  font: inherit;
  font-size: var(--text-sm);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-subtle);
  cursor: pointer;
  white-space: nowrap;
}

.priority-list {
  display: grid;
  border-top: var(--rule-hair) solid var(--color-rule);
}

.priority-list button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-xs);
  min-height: 62px;
  padding: var(--space-xs) 0;
  color: var(--color-ink);
  text-align: left;
  border: 0;
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: transparent;
  cursor: pointer;
}

.priority-list button > span:first-child {
  display: grid;
  min-width: 0;
}

.priority-list strong,
.priority-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.priority-list strong {
  font-size: var(--text-sm);
}

.priority-list small {
  margin-top: var(--space-3xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.priority-action {
  color: var(--color-accent-text);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.agent-target-list {
  display: grid;
  border-top: var(--rule-hair) solid var(--color-rule);
}

.agent-target-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-xs);
  padding-block: var(--space-xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.target-row-identity {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.target-row-identity > span:last-child {
  display: grid;
  min-width: 0;
}

.target-row-identity strong,
.target-row-identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-row-identity strong {
  font-size: var(--text-sm);
}

.target-row-identity small {
  margin-top: var(--space-3xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.kind-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--space-2xl);
  width: var(--space-2xl);
  min-width: 0;
  padding: var(--space-3xs) var(--space-2xs);
  overflow: hidden;
  color: var(--color-accent-text);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-xs);
  background: var(--color-paper-3);
}

.target-row-states {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-3xs);
  flex-wrap: wrap;
}

.target-row-availability,
.agent-target-row time {
  color: var(--color-ink-2);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.target-row-availability {
  display: flex;
  flex-direction: column;
}

.target-row-availability small {
  color: var(--color-muted);
  font-size: 10px;
  white-space: nowrap;
}

.agent-target-row time {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-row-action {
  justify-self: end;
}

.history-mode-switch {
  padding: 0 0 var(--space-sm);
  margin-bottom: var(--space-sm);
}

.target-history-picker {
  display: grid;
  gap: var(--space-3xs);
  margin-bottom: var(--space-sm);
}

.target-history-picker span {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.target-history-picker select {
  width: 100%;
  min-height: 44px;
}

.agent-select:focus-visible,
.agent-history-shortcut:focus-visible,
.agent-list-toggle:focus-visible,
.mobile-back:focus-visible,
.agent-tabs button:focus-visible,
.history-mode-switch button:focus-visible,
.text-action:focus-visible,
.priority-list button:focus-visible,
.history-row-action:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(var(--rule-fine) * -1);
}

.agent-select:active,
.agent-history-shortcut:active,
.agent-list-toggle:active,
.mobile-back:active,
.agent-tabs button:active,
.history-mode-switch button:active,
.text-action:active,
.priority-list button:active,
.history-row-action:active {
  transform: translateY(var(--rule-fine));
}

@media (hover: hover) and (pointer: fine) {
  .agent-select:hover,
  .agent-history-shortcut:hover,
  .agent-list-toggle:hover,
  .mobile-back:hover,
  .agent-tabs button:not(.active):hover,
  .history-mode-switch button:not(.active):hover,
  .text-action:hover,
  .priority-list button:hover,
  .history-row-action:hover {
    background: var(--color-glass-hover);
  }

  .agent-tabs button.active:hover,
  .history-mode-switch button.active:hover {
    background: var(--color-primary-action-hover-bg);
  }

  .agent-history-shortcut:hover,
  .mobile-back:hover,
  .text-action:hover,
  .history-row-action:hover {
    color: var(--color-accent-text);
  }
}

@media (min-width: 40rem) {
  .agent-detail-head {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .agent-detail-state {
    justify-content: flex-end;
  }

  .agent-summary-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .agent-overview-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

}

@container (min-width: 32rem) {
  .agent-target-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .target-row-states {
    justify-content: flex-end;
  }
}

@container (min-width: 55rem) {
  .agent-target-row {
    grid-template-columns: minmax(210px, 1.2fr) minmax(240px, 1fr) var(--space-2xl) minmax(125px, auto) auto;
    align-items: center;
  }
}

@media (min-width: 72rem) {
  .agent-workbench {
    display: grid;
    grid-template-columns: minmax(290px, 340px) minmax(0, 1fr);
    min-height: 640px;
    transition: grid-template-columns var(--dur-short) var(--ease-out);
  }

  .agent-workbench.agent-list-collapsed {
    grid-template-columns: 5rem minmax(0, 1fr);
  }

  .agent-list-pane,
  .agent-detail-pane,
  .agent-workbench[data-mobile-pane="detail"] .agent-list-pane,
  .agent-workbench[data-mobile-pane="detail"] .agent-detail-pane {
    display: block;
  }

  .agent-list-pane {
    border-right: var(--rule-hair) solid var(--color-rule);
  }

  .agent-list-toolbar {
    display: flex;
  }

  .agent-list-collapsed .agent-list-toolbar {
    justify-content: center;
    padding-inline: var(--space-2xs);
  }

  .agent-list-collapsed .agent-list-toolbar > span,
  .agent-list-collapsed .agent-filters,
  .agent-list-collapsed .agent-row-copy,
  .agent-list-collapsed .agent-row-status,
  .agent-list-collapsed .agent-history-shortcut {
    display: none;
  }

  .agent-list-collapsed .agent-list-row {
    display: block;
  }

  .agent-list-collapsed .agent-select {
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    gap: var(--space-3xs);
    min-height: 76px;
    padding: var(--space-2xs);
  }

  .agent-list-collapsed .agent-collapsed-label {
    display: block;
    max-width: 100%;
  }

  .agent-list-collapsed .agent-list-row.selected {
    box-shadow: inset var(--rule-fine) 0 var(--color-accent);
  }

  .mobile-back {
    display: none;
  }
}

@media (min-width: 90rem) {
  .agent-workbench {
    grid-template-columns: minmax(330px, 380px) minmax(0, 1fr);
  }

  .agent-workbench.agent-list-collapsed {
    grid-template-columns: 5rem minmax(0, 1fr);
  }

  .agent-tab-content {
    padding: var(--space-md);
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-select,
  .agent-history-shortcut,
  .agent-list-toggle,
  .mobile-back,
  .agent-tabs button,
  .history-mode-switch button,
  .text-action,
  .priority-list button,
  .history-row-action {
    transition-duration: var(--dur-micro);
  }
}
</style>
