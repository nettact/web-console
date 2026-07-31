<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TargetAgentStatusRow } from '../../api'
import type { TargetStatusGroupView } from '../../lib/targetStatusPage'
import {
  agentTargetTone,
  type AgentTargetTone,
  type TargetWorkspaceTab,
} from '../../lib/targetStatusAgentView'
import { formatAvailability } from '../../lib/targetStatus'
import { toDateLocale } from '../../i18n'
import MonitorStateBadge from './MonitorStateBadge.vue'
import TargetStatusHistory from './TargetStatusHistory.vue'

const props = defineProps<{
  groups: TargetStatusGroupView[]
  selectedTargetId: string
  selectedAgentId: string
  tab: TargetWorkspaceTab
}>()

const emit = defineEmits<{
  'update:selectedTargetId': [value: string]
  'update:selectedAgentId': [value: string]
  'update:tab': [value: TargetWorkspaceTab]
}>()

const { t, locale } = useI18n()

const visibleTargetCount = computed(() =>
  props.groups.reduce((sum, group) => sum + group.targets.length, 0),
)
const selectedTarget = computed(() => {
  for (const group of props.groups) {
    const target = group.allTargets.find((row) => row.target_id === props.selectedTargetId)
    if (target) return target
  }
  return undefined
})
const selectedGroup = computed(() =>
  props.groups.find((group) => group.allTargets.some((row) => row.target_id === props.selectedTargetId)),
)
const sortedAgents = computed(() => {
  if (!selectedTarget.value) return []
  const rank: Record<AgentTargetTone, number> = {
    abnormal: 0,
    attention: 1,
    healthy: 2,
    inactive: 3,
  }
  return [...selectedTarget.value.agents].sort((a, b) =>
    rank[agentTargetTone(a)] - rank[agentTargetTone(b)]
    || (a.agent_name || a.agent_id).localeCompare(b.agent_name || b.agent_id),
  )
})
const priorityAgents = computed(() =>
  sortedAgents.value
    .filter((agent) => {
      const tone = agentTargetTone(agent)
      return tone === 'abnormal' || tone === 'attention'
    })
    .slice(0, 5),
)
const selectedAgent = computed(() =>
  sortedAgents.value.find((agent) => agent.agent_id === props.selectedAgentId),
)

function fmt(value?: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false })
}

function availability(value?: number | null): string {
  return formatAvailability(value ?? undefined) ?? t('targetStatus.availabilityUnknown')
}

function openTarget(targetID: string): void {
  if (props.selectedTargetId === targetID) {
    closeTarget()
    return
  }
  emit('update:selectedTargetId', targetID)
  emit('update:selectedAgentId', '')
  emit('update:tab', 'overview')
}

function closeTarget(): void {
  emit('update:selectedTargetId', '')
  emit('update:selectedAgentId', '')
  emit('update:tab', 'overview')
}

function openHistory(agentID: string): void {
  emit('update:selectedAgentId', agentID)
  emit('update:tab', 'history')
}

function updateTab(tab: TargetWorkspaceTab): void {
  if (tab === 'history' && !props.selectedAgentId) {
    emit('update:selectedAgentId', sortedAgents.value[0]?.agent_id || '')
  }
  emit('update:tab', tab)
}

function toneClass(agent: TargetAgentStatusRow): string {
  return `tone-${agentTargetTone(agent)}`
}

watch(
  [selectedTarget, sortedAgents, () => props.tab],
  () => {
    if (!selectedTarget.value) return
    if (props.selectedAgentId && sortedAgents.value.some((agent) => agent.agent_id === props.selectedAgentId)) return
    if (props.tab === 'history') emit('update:selectedAgentId', sortedAgents.value[0]?.agent_id || '')
  },
  { immediate: true },
)
</script>

<template>
  <section class="target-board" :aria-label="t('targetStatus.targetBoardAria')">
    <p class="board-result" aria-live="polite">
      {{ t('targetStatus.targetBoardResult', { targets: visibleTargetCount, groups: groups.length }) }}
    </p>

    <div v-if="groups.length" class="target-groups">
      <section v-for="group in groups" :key="group.id" class="target-board-group">
        <header class="board-group-head">
          <div>
            <h3>{{ group.name }}</h3>
            <span>{{ t('targetStatus.targetCount', { n: group.targets.length }) }}</span>
          </div>
          <div class="group-health" aria-hidden="true">
            <span v-if="group.counts.abnormal" class="is-bad">{{ group.counts.abnormal }}</span>
            <span v-if="group.counts.attention" class="is-warn">{{ group.counts.attention }}</span>
            <span v-if="group.counts.healthy" class="is-good">{{ group.counts.healthy }}</span>
          </div>
        </header>

        <div v-if="group.targets.length" class="target-table">
          <div class="target-table-head" aria-hidden="true">
            <span>{{ t('targetStatus.targetColumn') }}</span>
            <span>{{ t('targetStatus.currentState') }}</span>
            <span>{{ t('targetStatus.agentImpact') }}</span>
            <span>{{ t('targetStatus.availability24h') }}</span>
            <span>{{ t('targetStatus.lastObserved') }}</span>
            <span></span>
          </div>
          <template v-for="target in group.targets" :key="target.target_id">
            <button
              type="button"
              class="target-board-row"
              :class="{ selected: selectedTargetId === target.target_id }"
              :aria-label="t('targetStatus.openTargetDetailsAria', { target: target.name || target.target })"
              :aria-expanded="selectedTargetId === target.target_id"
              :aria-controls="`target-workspace-${target.target_id}`"
              @click="openTarget(target.target_id)"
            >
              <span class="board-target-identity">
                <span class="kind-chip">{{ target.kind.toUpperCase() }}</span>
                <span>
                  <strong>{{ target.name || target.target }}</strong>
                  <small>{{ target.target }}</small>
                </span>
              </span>
              <span><MonitorStateBadge dim="display" :state="target.display_state" /></span>
              <span class="board-impact">
                {{ t('targetStatus.affected', { affected: target.affected_agents, total: target.applicable_agents }) }}
              </span>
              <span class="board-availability">{{ availability(target.availability_24h) }}</span>
              <time :datetime="target.last_observed_at">{{ fmt(target.last_observed_at) }}</time>
              <span class="board-open" aria-hidden="true">›</span>
            </button>

            <section
              v-if="selectedTargetId === target.target_id && selectedTarget"
              :id="`target-workspace-${target.target_id}`"
              class="target-detail-workspace"
              :aria-label="t('targetStatus.targetWorkspaceAria')"
            >
              <header class="workspace-head">
                <div class="workspace-identity">
                  <span class="kind-chip">{{ selectedTarget.kind.toUpperCase() }}</span>
                  <div>
                    <h3>{{ selectedTarget.name || selectedTarget.target }}</h3>
                    <p>{{ selectedGroup?.name }} · {{ selectedTarget.target }}</p>
                  </div>
                </div>
                <button type="button" class="workspace-back" @click="closeTarget">
                  <span aria-hidden="true">←</span>
                  <span>{{ t('targetStatus.backToTargetBoard') }}</span>
                </button>
              </header>

              <nav class="target-tabs" role="tablist" :aria-label="t('targetStatus.targetTabsAria')">
                <button
                  v-for="item in ([
                    { id: 'overview', label: t('targetStatus.targetTabOverview') },
                    { id: 'agents', label: t('targetStatus.targetTabAgents', { n: sortedAgents.length }) },
                    { id: 'history', label: t('targetStatus.targetTabHistory') },
                  ] as Array<{ id: TargetWorkspaceTab; label: string }>)"
                  :key="item.id"
                  type="button"
                  role="tab"
                  :class="{ active: tab === item.id }"
                  :aria-selected="tab === item.id"
                  :disabled="item.id === 'history' && !sortedAgents.length"
                  @click="updateTab(item.id)"
                >
                  {{ item.label }}
                </button>
              </nav>

              <div class="workspace-body">
                <section v-if="tab === 'overview'" class="target-overview" role="tabpanel">
                  <div class="target-summary-grid">
                    <div>
                      <span>{{ t('targetStatus.currentState') }}</span>
                      <MonitorStateBadge dim="display" :state="selectedTarget.display_state" />
                    </div>
                    <div>
                      <span>{{ t('targetStatus.agentImpact') }}</span>
                      <strong>{{ selectedTarget.affected_agents }}/{{ selectedTarget.applicable_agents }}</strong>
                    </div>
                    <div>
                      <span>{{ t('targetStatus.availability24h') }}</span>
                      <strong>{{ availability(selectedTarget.availability_24h) }}</strong>
                    </div>
                    <div>
                      <span>{{ t('targetStatus.incidentsLabel') }}</span>
                      <strong>{{ selectedTarget.incident_ids.length }}</strong>
                    </div>
                  </div>

                  <dl class="target-facts">
                    <div><dt>{{ t('targetStatus.groupLabel') }}</dt><dd>{{ selectedGroup?.name || '—' }}</dd></div>
                    <div><dt>{{ t('targetStatus.kindLabel') }}</dt><dd>{{ selectedTarget.kind.toUpperCase() }}</dd></div>
                    <div><dt>{{ t('targetStatus.addressLabel') }}</dt><dd class="mono">{{ selectedTarget.target }}</dd></div>
                    <div><dt>{{ t('targetStatus.lastObserved') }}</dt><dd>{{ fmt(selectedTarget.last_observed_at) }}</dd></div>
                  </dl>

                  <section class="priority-agents">
                    <div class="workspace-section-head">
                      <div>
                        <h4>{{ t('targetStatus.priorityAgents') }}</h4>
                        <p>{{ t('targetStatus.priorityAgentsHint') }}</p>
                      </div>
                      <button type="button" class="text-action" @click="updateTab('agents')">
                        {{ t('targetStatus.viewAllAgents') }}
                      </button>
                    </div>
                    <div v-if="priorityAgents.length" class="priority-agent-list">
                      <button
                        v-for="agent in priorityAgents"
                        :key="agent.agent_id"
                        type="button"
                        @click="openHistory(agent.agent_id)"
                      >
                        <span class="agent-state-dot" :class="toneClass(agent)" aria-hidden="true"></span>
                        <span>
                          <strong>{{ agent.agent_name || agent.agent_id }}</strong>
                          <small>{{ t(`targetStatus.reason.${agent.reason_code}`) }}</small>
                        </span>
                        <MonitorStateBadge dim="probe" :state="agent.probe_state" />
                        <span class="text-action">{{ t('targetStatus.openHistory') }}</span>
                      </button>
                    </div>
                    <div v-else class="quiet-state">
                      <strong>{{ t('targetStatus.noPriorityAgents') }}</strong>
                      <span>{{ t('targetStatus.noPriorityAgentsHint') }}</span>
                    </div>
                  </section>
                </section>

                <section v-else-if="tab === 'agents'" class="target-agent-matrix" role="tabpanel">
                  <div class="workspace-section-head">
                    <div>
                      <h4>{{ t('targetStatus.agentMatrixTitle') }}</h4>
                      <p>{{ t('targetStatus.agentMatrixHint') }}</p>
                    </div>
                  </div>
                  <div v-if="sortedAgents.length" class="agent-matrix">
                    <article v-for="agent in sortedAgents" :key="agent.agent_id" class="agent-matrix-row">
                      <span class="agent-state-dot" :class="toneClass(agent)" aria-hidden="true"></span>
                      <div class="matrix-agent">
                        <strong>{{ agent.agent_name || agent.agent_id }}</strong>
                        <small>{{ agent.agent_id }}</small>
                      </div>
                      <div class="matrix-states">
                        <MonitorStateBadge dim="execution" :state="agent.execution_state" />
                        <MonitorStateBadge v-if="agent.probe_state !== 'not_applicable'" dim="probe" :state="agent.probe_state" />
                        <MonitorStateBadge dim="fault" :state="agent.fault_state" />
                      </div>
                      <span class="matrix-reason">{{ t(`targetStatus.reason.${agent.reason_code}`) }}</span>
                      <span class="matrix-availability">{{ availability(agent.availability_24h) }}</span>
                      <time :datetime="agent.last_observed_at">{{ fmt(agent.last_observed_at) }}</time>
                      <button type="button" class="history-action" @click="openHistory(agent.agent_id)">
                        {{ t('targetStatus.openHistory') }}
                      </button>
                    </article>
                  </div>
                  <div v-else class="quiet-state">
                    <strong>{{ t('targetStatus.noApplicableAgents') }}</strong>
                  </div>
                </section>

                <section v-else class="target-history-panel" role="tabpanel">
                  <label class="history-agent-picker">
                    <span>{{ t('targetStatus.historyAgentLabel') }}</span>
                    <select
                      :value="selectedAgent?.agent_id || ''"
                      @change="emit('update:selectedAgentId', ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="agent in sortedAgents" :key="agent.agent_id" :value="agent.agent_id">
                        {{ agent.agent_name || agent.agent_id }}
                      </option>
                    </select>
                  </label>
                  <TargetStatusHistory
                    v-if="selectedAgent"
                    :target="selectedTarget"
                    :agent-id="selectedAgent.agent_id"
                  />
                </section>
              </div>
            </section>
          </template>
        </div>
        <p v-else class="board-group-empty">
          {{ group.allTargets.length ? t('targetStatus.noFilterResultsInGroup') : t('targetStatus.emptyGroup') }}
        </p>
      </section>
    </div>

    <div v-else class="board-empty">
      <strong>{{ t('targetStatus.noFilterResults') }}</strong>
      <span>{{ t('targetStatus.noFilterResultsHint') }}</span>
    </div>

  </section>
</template>

<style scoped>
/* Hallmark · genre: custom application · macrostructure: Global Status Board + Single-Open Inline Accordion
 * design-system: design.md · designed-as-app
 * post-emit critique: P5 H5 E4 S5 R5 V5
 * contrast: pass (40–41) · honest: pass (46) · chrome: pass (47) · tokens: pass (48)
 * responsive: pass (34, 49, 50–57) · icons: pass (30)
 */
.target-board {
  min-width: 0;
}

.board-result {
  margin: 0 var(--space-3xs) var(--space-xs);
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.target-groups,
.target-table,
.priority-agent-list,
.agent-matrix {
  display: grid;
}

.target-board-group {
  overflow: hidden;
  margin-bottom: var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-panel);
  background: var(--color-glass);
  box-shadow: var(--shadow-card);
}

.board-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  min-height: 52px;
  padding: var(--space-2xs) var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-strong);
}

.board-group-head > div:first-child,
.workspace-section-head > div,
.workspace-identity > div {
  min-width: 0;
}

.board-group-head h3,
.workspace-section-head h4,
.workspace-head h3 {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-style: normal;
}

.board-group-head h3 {
  font-size: var(--text-sm);
}

.board-group-head > div:first-child span,
.workspace-head p,
.workspace-section-head p {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.group-health {
  display: flex;
  gap: var(--space-2xs);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.group-health span {
  min-width: 24px;
  padding: var(--space-3xs);
  border-radius: var(--radius-xs);
  text-align: center;
}

.group-health .is-bad { color: var(--color-danger); background: var(--color-glass-subtle); }
.group-health .is-warn { color: var(--color-warning); background: var(--color-glass-subtle); }
.group-health .is-good { color: var(--color-success); background: var(--color-glass-subtle); }

.target-table-head,
.target-board-row {
  display: grid;
  grid-template-columns: minmax(230px, 1.45fr) minmax(112px, 0.75fr) minmax(120px, 0.8fr) minmax(95px, 0.55fr) minmax(145px, 0.9fr) 28px;
  align-items: center;
  gap: var(--space-xs);
}

.target-table-head {
  min-height: 36px;
  padding-inline: var(--space-sm);
  color: var(--color-muted);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  font-size: var(--text-xs);
}

.target-board-row {
  width: 100%;
  min-height: 62px;
  padding: var(--space-2xs) var(--space-sm);
  border: 0;
  border-bottom: var(--rule-hair) solid var(--color-rule);
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-out);
}

.target-board-row:last-of-type {
  border-bottom: 0;
}

.target-board-row.selected {
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-strong);
}

.board-target-identity,
.workspace-identity {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.board-target-identity > span:last-child {
  min-width: 0;
}

.board-target-identity strong,
.board-target-identity small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-target-identity strong {
  font-size: var(--text-sm);
}

.board-target-identity small,
.target-board-row time,
.board-impact {
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
  min-height: 24px;
  padding-inline: var(--space-2xs);
  overflow: hidden;
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-pill);
  color: var(--color-ink-2);
  background: var(--color-paper-2);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-availability,
.target-board-row time,
.matrix-availability,
.agent-matrix-row time {
  font-family: var(--font-outlier);
  font-variant-numeric: tabular-nums;
}

.board-open {
  color: var(--color-muted);
  font-size: var(--text-xl);
  text-align: right;
  transition: transform var(--dur-micro) var(--ease-out);
}

.target-board-row.selected .board-open {
  transform: rotate(90deg);
}

.target-board-row:focus-visible,
.workspace-back:focus-visible,
.target-tabs button:focus-visible,
.text-action:focus-visible,
.priority-agent-list button:focus-visible,
.history-action:focus-visible {
  position: relative;
  z-index: var(--z-base);
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(var(--rule-fine) * -1);
}

.target-board-row:active,
.workspace-back:active,
.target-tabs button:active,
.text-action:active,
.priority-agent-list button:active,
.history-action:active {
  transform: translateY(var(--rule-fine));
}

.board-group-empty,
.board-empty,
.quiet-state {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.board-empty,
.quiet-state {
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
}

.board-empty strong,
.quiet-state strong {
  color: var(--color-ink);
  font-size: var(--text-sm);
}

.target-detail-workspace {
  display: grid;
  grid-template-rows: auto auto auto;
  container-type: inline-size;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-paper-2);
}

.target-detail-workspace:last-child {
  border-bottom: 0;
}

.workspace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.workspace-head h3 {
  font-size: var(--text-lg);
}

.workspace-head p,
.workspace-section-head p {
  margin: var(--space-3xs) 0 0;
}

.workspace-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2xs);
  flex: 0 0 auto;
  width: auto;
  min-height: 44px;
  padding-inline: var(--space-xs);
  border: 0;
  border-radius: var(--radius-input);
  color: var(--color-ink-2);
  background: transparent;
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
}

.target-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding-inline: var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.target-tabs button {
  min-height: 48px;
  padding-inline: var(--space-2xs);
  border: 0;
  border-bottom: var(--rule-fine) solid transparent;
  color: var(--color-muted);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.target-tabs button.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.target-tabs button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.target-board-row:disabled,
.workspace-back:disabled,
.text-action:disabled,
.priority-agent-list button:disabled,
.history-action:disabled {
  color: var(--color-muted);
  cursor: not-allowed;
  opacity: 0.55;
}

.workspace-body {
  min-height: 0;
  overflow: visible;
  padding: var(--space-sm);
  background: var(--color-paper-2);
}

.target-overview,
.target-agent-matrix,
.target-history-panel,
.priority-agents {
  display: grid;
  gap: var(--space-sm);
}

.target-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass);
}

.target-summary-grid > div {
  display: grid;
  align-content: center;
  gap: var(--space-2xs);
  min-height: 88px;
  padding: var(--space-xs);
  border-right: var(--rule-hair) solid var(--color-rule);
}

.target-summary-grid > div:last-child {
  border-right: 0;
}

.target-summary-grid span,
.target-facts dt {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.target-summary-grid strong {
  font-family: var(--font-outlier);
  font-size: var(--text-lg);
  font-variant-numeric: tabular-nums;
}

.target-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  border-block: var(--rule-hair) solid var(--color-rule);
}

.target-facts > div {
  min-width: 0;
  padding: var(--space-xs);
}

.target-facts dd {
  margin: var(--space-3xs) 0 0;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
}

.mono {
  font-family: var(--font-outlier);
}

.workspace-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
}

.workspace-section-head h4 {
  font-size: var(--text-md);
}

.text-action,
.history-action {
  min-height: 44px;
  padding-inline: var(--space-2xs);
  border: 0;
  color: var(--color-accent);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.priority-agent-list {
  border-block: var(--rule-hair) solid var(--color-rule);
}

.priority-agent-list > button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-xs);
  min-height: 58px;
  padding: var(--space-2xs);
  border: 0;
  border-bottom: var(--rule-hair) solid var(--color-rule);
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.priority-agent-list > button:last-child {
  border-bottom: 0;
}

.priority-agent-list strong,
.priority-agent-list small {
  display: block;
}

.priority-agent-list small {
  margin-top: var(--space-3xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.agent-state-dot {
  width: 9px;
  height: 9px;
  border-radius: var(--radius-pill);
  background: var(--color-neutral);
}

.agent-state-dot.tone-abnormal { background: var(--color-danger); }
.agent-state-dot.tone-attention { background: var(--color-warning); }
.agent-state-dot.tone-healthy { background: var(--color-success); }

.agent-matrix {
  border-top: var(--rule-hair) solid var(--color-rule);
}

.agent-matrix-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 64px;
  padding-block: var(--space-2xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.matrix-states,
.matrix-reason,
.matrix-availability,
.agent-matrix-row time {
  grid-column: 2 / -1;
}

.history-action {
  grid-column: 3;
  grid-row: 1;
}

.matrix-agent,
.matrix-reason {
  min-width: 0;
}

.matrix-agent strong,
.matrix-agent small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.matrix-agent small,
.matrix-reason,
.agent-matrix-row time {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.matrix-states {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3xs);
}

.history-agent-picker {
  display: grid;
  gap: var(--space-2xs);
}

.history-agent-picker span {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.history-agent-picker select {
  width: 100%;
  min-height: 44px;
}

@media (hover: hover) and (pointer: fine) {
  .target-board-row:hover,
  .workspace-back:hover,
  .target-tabs button:not(.active):not(:disabled):hover,
  .priority-agent-list > button:hover,
  .history-action:hover,
  .text-action:hover {
    background: var(--color-glass-hover);
  }
}

@media (max-width: 1100px) {
  .target-table-head,
  .target-board-row {
    grid-template-columns: minmax(220px, 1.4fr) minmax(108px, 0.7fr) minmax(110px, 0.7fr) 86px 28px;
  }

  .target-table-head > :nth-child(5),
  .target-board-row > time {
    display: none;
  }
}

@media (max-width: 768px) {
  .target-table-head {
    display: none;
  }

  .target-board-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2xs);
    min-height: 82px;
  }

  .target-board-row > span:nth-child(2),
  .target-board-row > span:nth-child(3),
  .target-board-row > span:nth-child(4) {
    grid-row: 2;
  }

  .target-board-row > span:nth-child(2) { grid-column: 1; }
  .target-board-row > span:nth-child(3) { display: none; }
  .target-board-row > span:nth-child(4) { grid-column: 2; }
  .board-open { grid-column: 2; grid-row: 1; }

  .target-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .target-summary-grid > div:nth-child(2) {
    border-right: 0;
  }

  .target-summary-grid > div:nth-child(-n + 2) {
    border-bottom: var(--rule-hair) solid var(--color-rule);
  }

  .target-facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .workspace-section-head {
    align-items: flex-start;
  }

}

@container (min-width: 55rem) {
  .agent-matrix-row {
    grid-template-columns: auto minmax(145px, 0.9fr) minmax(200px, 1.2fr) minmax(125px, 0.8fr) 64px minmax(130px, 0.8fr) auto;
    padding-block: 0;
  }

  .matrix-states,
  .matrix-reason,
  .matrix-availability,
  .agent-matrix-row time,
  .history-action {
    grid-column: auto;
    grid-row: auto;
  }
}

@media (max-width: 414px) {
  .board-group-head {
    align-items: flex-start;
  }

  .workspace-head {
    padding: var(--space-xs);
  }

  .workspace-body {
    padding: var(--space-xs);
  }

  .workspace-identity .kind-chip {
    display: none;
  }

  .target-tabs {
    padding-inline: var(--space-xs);
  }

  .target-tabs button {
    font-size: var(--text-xs);
  }

  .priority-agent-list > button {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .priority-agent-list :deep(.pill) {
    display: none;
  }

  .priority-agent-list .text-action {
    grid-column: 2 / -1;
    justify-self: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .target-board-row,
  .board-open,
  .workspace-back,
  .target-tabs button,
  .priority-agent-list button,
  .history-action,
  .text-action {
    transition-duration: var(--dur-micro);
  }
}
</style>
