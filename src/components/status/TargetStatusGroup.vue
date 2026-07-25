<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ProbeTarget, TargetStatusRow } from '../../api'
import type { TargetStatusGroupView } from '../../lib/targetStatusPage'
import { targetLabel, typeLabel } from '../../lib/targetLabels'
import { toDateLocale } from '../../i18n'
import MonitorStateBadge from './MonitorStateBadge.vue'
import TargetStatusAgentDetails from './TargetStatusAgentDetails.vue'

const props = defineProps<{
  view: TargetStatusGroupView
  expanded: boolean
  selectedTargetId?: string
  selectedAgentId?: string
}>()

const emit = defineEmits<{
  toggleGroup: []
  toggleTarget: [target: TargetStatusRow]
}>()

const { t, locale } = useI18n()

function asProbeTarget(row: TargetStatusRow): ProbeTarget {
  return { id: row.target_id, group_id: row.group_id, kind: row.kind, name: row.name, target: row.target, enabled: row.enabled }
}

function scopeLabel(): string {
  if (!props.view.group) return t('targetStatus.unknownScope')
  if (props.view.group.all_agents) return t('targetStatus.scopeAll')
  return props.view.agentGroupNames.length ? props.view.agentGroupNames.join(', ') : t('targetStatus.scopeNone')
}

function mergeLabel(): string {
  if (!props.view.group) return t('targetStatus.unknownPolicy')
  return props.view.group.merge_enabled ? t('targetStatus.mergeEnabled') : t('targetStatus.mergeDisabled')
}

function fmtTime(value?: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(toDateLocale(locale.value), {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

function targetName(row: TargetStatusRow): string {
  return row.name || t('targetStatus.unnamedTarget')
}
</script>

<template>
  <section class="group-panel" :class="{ 'has-abnormal': view.counts.abnormal > 0, orphaned: view.orphaned }">
    <header
      class="group-head"
      role="button"
      tabindex="0"
      :aria-expanded="expanded"
      :aria-label="t('targetStatus.toggleGroupAria', { name: view.name })"
      @click="emit('toggleGroup')"
      @keydown.enter.prevent="emit('toggleGroup')"
      @keydown.space.prevent="emit('toggleGroup')"
    >
      <div class="group-toggle">
        <span class="group-icon" aria-hidden="true">⌘</span>
        <span class="group-title">
          <span class="group-name">
            {{ view.name }}
            <span v-if="view.group?.is_default" class="default-tag">{{ t('targetStatus.defaultGroup') }}</span>
            <span v-if="view.orphaned" class="orphan-tag">{{ t('targetStatus.unknownGroup') }}</span>
          </span>
          <span>{{ t('targetStatus.targetCount', { n: view.allTargets.length }) }}</span>
        </span>
      </div>

      <div class="group-facts">
        <div><span>{{ t('targetStatus.executionScope') }}</span><strong>{{ scopeLabel() }}</strong></div>
        <div><span>{{ t('targetStatus.incidentPolicy') }}</span><strong>{{ mergeLabel() }}</strong></div>
      </div>

      <div class="group-counts">
        <span v-if="view.counts.abnormal" class="count-chip bad">{{ t('targetStatus.bucketCount', { n: view.counts.abnormal, label: t('targetStatus.bucket.abnormal') }) }}</span>
        <span v-if="view.counts.attention" class="count-chip warn">{{ t('targetStatus.bucketCount', { n: view.counts.attention, label: t('targetStatus.bucket.attention') }) }}</span>
        <span v-if="view.counts.healthy" class="count-chip good">{{ t('targetStatus.bucketCount', { n: view.counts.healthy, label: t('targetStatus.bucket.healthy') }) }}</span>
        <span v-if="view.counts.inactive" class="count-chip neutral">{{ t('targetStatus.bucketCount', { n: view.counts.inactive, label: t('targetStatus.bucket.inactive') }) }}</span>
      </div>

      <div class="group-actions">
        <router-link
          v-if="view.group"
          :to="`/monitoring/groups/${view.id}/edit`"
          @click.stop
          @keydown.enter.stop
          @keydown.space.stop
        >{{ t('targetStatus.manageGroup') }}</router-link>
        <span class="group-expand-cue" aria-hidden="true">
          {{ expanded ? t('targetStatus.collapseGroup') : t('targetStatus.expandGroup') }}
          <span class="detail-chevron" :class="{ open: expanded }">&rsaquo;</span>
        </span>
      </div>
    </header>

    <div v-if="expanded" class="group-body">
      <p v-if="view.orphaned" class="orphan-warning" role="alert">
        {{ t('targetStatus.orphanGroupWarning', { id: view.id }) }}
      </p>

      <div v-if="view.targets.length" class="target-list">
        <div class="target-columns" aria-hidden="true">
          <span>{{ t('targetStatus.targetColumn') }}</span>
          <span>{{ t('targetStatus.currentState') }}</span>
          <span>{{ t('targetStatus.agentImpact') }}</span>
          <span>{{ t('targetStatus.activeConditions') }}</span>
          <span>{{ t('targetStatus.lastObserved') }}</span>
          <span class="action-column">{{ t('targetStatus.detailAction') }}</span>
        </div>

        <article v-for="row in view.targets" :id="`target-status-${row.target_id}`" :key="row.target_id" class="target-item" :class="{ selected: selectedTargetId === row.target_id }">
          <div
            class="target-summary"
            role="button"
            tabindex="0"
            :aria-expanded="selectedTargetId === row.target_id"
            :aria-label="t('targetStatus.toggleDetailAria', { name: targetName(row) })"
            @click="emit('toggleTarget', row)"
            @keydown.enter.prevent="emit('toggleTarget', row)"
            @keydown.space.prevent="emit('toggleTarget', row)"
          >
            <div class="target-toggle">
              <span class="kind-icon">{{ row.kind.toUpperCase() }}</span>
              <span class="target-identity">
                <strong>{{ targetName(row) }}</strong>
                <span>{{ typeLabel(asProbeTarget(row), t) }} · {{ targetLabel(asProbeTarget(row), t) }}</span>
              </span>
            </div>

            <div class="state-cell" :data-label="t('targetStatus.currentState')">
              <MonitorStateBadge dim="display" :state="row.display_state" />
              <span v-if="row.display_state === 'breaching'" class="breaching-hint">{{ t('targetStatus.breachingShort') }}</span>
            </div>

            <div class="impact-cell" :data-label="t('targetStatus.agentImpact')">
              <strong :class="{ affected: row.affected_agents > 0 }">{{ row.affected_agents }}</strong>
              <span>/ {{ row.applicable_agents }}</span>
              <small>{{ t('targetStatus.agentsAffected') }}</small>
            </div>

            <div class="condition-cell" :data-label="t('targetStatus.activeConditions')">
              <template v-if="row.active_condition_count">
                <strong :class="`severity-${row.worst_severity || 'warn'}`">
                  {{ row.worst_severity ? t(`targetStatus.severity.${row.worst_severity}`) : t('targetStatus.severity.warn') }}
                </strong>
                <span>{{ t('targetStatus.conditionCount', { n: row.active_condition_count }) }}</span>
              </template>
              <span v-else class="muted">{{ t('targetStatus.noActiveConditions') }}</span>
            </div>

            <div class="observed-cell" :data-label="t('targetStatus.lastObserved')">{{ fmtTime(row.last_observed_at) }}</div>

            <div class="target-actions">
              <router-link
                v-if="row.incident_ids.length"
                :to="{ path: '/incidents', query: { incident: row.incident_ids[0] } }"
                class="incident-count"
                @click.stop
                @keydown.enter.stop
                @keydown.space.stop
              >
                {{ t('targetStatus.incidentCount', { n: row.incident_ids.length }) }}
              </router-link>
              <span class="target-detail-cue" aria-hidden="true">
                {{ selectedTargetId === row.target_id ? t('targetStatus.collapseTarget') : t('targetStatus.expandTarget') }}
                <span class="detail-chevron" :class="{ open: selectedTargetId === row.target_id }">&rsaquo;</span>
              </span>
            </div>
          </div>

          <TargetStatusAgentDetails
            v-if="selectedTargetId === row.target_id"
            :target="row"
            :selected-agent-id="selectedAgentId"
          />
        </article>
      </div>

      <div v-else class="empty-group">
        <template v-if="!view.allTargets.length">
          <p>{{ t('targetStatus.emptyGroup') }}</p>
          <router-link v-if="view.group" class="btn btn-primary" :to="`/monitoring/new?group=${view.id}`">
            {{ t('targetStatus.addFirstTarget') }}
          </router-link>
        </template>
        <p v-else>{{ t('targetStatus.noFilterResultsInGroup') }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.group-panel {
  margin-bottom: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}
.group-panel.has-abnormal { border-color: rgba(248, 113, 113, 0.28); }
.group-panel.orphaned { border-color: var(--danger); }
.group-head {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 70px;
  padding: 11px 14px;
  background: linear-gradient(90deg, var(--surface-2), var(--surface));
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.group-head:hover,
.group-head:focus-visible { background: var(--surface-2); outline: none; }
.group-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 215px;
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  text-align: left;
  cursor: pointer;
}
.group-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 9px;
  color: var(--primary);
  background: var(--primary-soft);
}
.group-title,
.target-identity {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.group-name {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 650;
}
.group-title > span:last-child {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 10.5px;
}
.default-tag,
.orphan-tag {
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 9px;
  font-weight: 500;
}
.default-tag { color: var(--text-dim); background: var(--surface-2); }
.orphan-tag { color: var(--danger); background: var(--danger-soft); }
.group-facts {
  display: flex;
  gap: 24px;
}
.group-facts div { min-width: 100px; }
.group-facts span,
.group-facts strong {
  display: block;
}
.group-facts span {
  color: var(--text-muted);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.group-facts strong {
  margin-top: 5px;
  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 500;
}
.group-counts {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.count-chip {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  font-size: 10.5px;
  white-space: nowrap;
}
.count-chip.bad { color: #fca5a5; border-color: rgba(248, 113, 113, 0.3); background: var(--danger-soft); }
.count-chip.warn { color: #fcd34d; border-color: rgba(251, 191, 36, 0.3); background: var(--warning-soft); }
.count-chip.good { color: #6ee7b7; border-color: rgba(52, 211, 153, 0.3); background: rgba(52, 211, 153, 0.1); }
.count-chip.neutral { color: var(--text-dim); background: var(--surface-2); }
.group-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: right;
}
.group-actions a,
.target-actions a {
  color: var(--primary);
  font-size: 10.5px;
  text-decoration: none;
}
.group-expand-cue,
.target-detail-cue {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  color: var(--primary);
  background: var(--primary-soft);
  font-size: 10.5px;
  font-weight: 650;
  white-space: nowrap;
}
.detail-chevron {
  display: inline-block;
  font-size: 17px;
  line-height: 0.7;
  transition: transform 0.15s;
}
.detail-chevron.open { transform: rotate(90deg); }
.group-head:hover .group-expand-cue,
.group-head:focus-visible .group-expand-cue,
.target-summary:hover .target-detail-cue,
.target-summary:focus-visible .target-detail-cue { border-color: var(--primary); }
.action-column { text-align: right; }
.target-list { border-top: 1px solid var(--border); }
.target-columns,
.target-summary {
  display: grid;
  grid-template-columns: minmax(230px, 1.45fr) 126px 140px 145px 135px minmax(160px, auto);
  gap: 12px;
  align-items: center;
}
.target-columns {
  min-height: 35px;
  padding: 0 17px;
  color: var(--text-muted);
  font-size: 9.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: var(--overlay-subtle);
}
.target-item { border-top: 1px solid var(--border); }
.target-item:first-of-type { border-top: 0; }
.target-item.selected { box-shadow: inset 3px 0 var(--primary); }
.target-summary {
  min-height: 66px;
  padding: 8px 17px;
  cursor: pointer;
  transition: background 0.15s;
}
.target-summary:hover,
.target-summary:focus-visible { background: var(--surface-2); outline: none; }
.target-item.selected > .target-summary { background: var(--primary-soft); }
.target-toggle {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  text-align: left;
}
.kind-icon {
  width: 35px;
  height: 35px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 8px;
  color: var(--primary);
  background: var(--primary-soft);
  font-size: 8.5px;
  font-weight: 700;
}
.target-identity strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.target-identity span {
  margin-top: 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.state-cell,
.condition-cell,
.impact-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.breaching-hint { color: var(--text-muted); font-size: 9.5px; }
.impact-cell strong { font-size: 14px; }
.impact-cell strong.affected { color: var(--danger); }
.impact-cell span { color: var(--text-dim); font-size: 11px; }
.impact-cell small { flex-basis: 100%; color: var(--text-muted); font-size: 9.5px; }
.condition-cell {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  font-size: 10.5px;
}
.condition-cell strong { color: var(--warning); font-size: 11px; }
.condition-cell .severity-error,
.condition-cell .severity-critical { color: var(--danger); }
.muted,
.observed-cell { color: var(--text-muted); font-size: 10.5px; }
.target-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.target-actions .incident-count {
  padding: 2px 6px;
  border: 1px solid rgba(248, 113, 113, 0.28);
  border-radius: 5px;
  color: var(--danger);
  background: var(--danger-soft);
}
.empty-group {
  padding: 20px 18px;
  color: var(--text-muted);
  font-size: 12.5px;
}
.empty-group p { margin: 0 0 10px; }
.orphan-warning {
  margin: 0;
  padding: 9px 17px;
  color: var(--danger);
  background: var(--danger-soft);
  font-size: 11.5px;
}

@media (max-width: 980px) {
  .group-head { flex-wrap: wrap; }
  .group-counts { margin-left: 0; }
  .group-actions { margin-left: auto; }
  .target-columns { display: none; }
  .target-summary {
    grid-template-columns: minmax(220px, 1fr) 130px 125px;
    padding: 12px 15px;
  }
  .condition-cell,
  .observed-cell,
  .target-actions { margin-left: 45px; }
  .condition-cell::before,
  .observed-cell::before {
    content: attr(data-label);
    color: var(--text-muted);
    font-size: 9px;
    text-transform: uppercase;
  }
}

@media (max-width: 680px) {
  .group-head { gap: 10px; padding: 10px; }
  .group-toggle { min-width: 0; flex: 1 1 220px; }
  .group-facts { order: 3; flex-basis: 100%; gap: 16px; padding-left: 27px; }
  .group-counts { margin-left: 27px; }
  .group-actions { flex-direction: row; margin-left: auto; }
  .target-summary { grid-template-columns: 1fr auto; gap: 10px; }
  .target-toggle { grid-column: 1; }
  .state-cell { grid-column: 2; justify-content: flex-end; }
  .impact-cell,
  .condition-cell,
  .observed-cell,
  .target-actions { grid-column: 1 / -1; margin-left: 45px; }
  .impact-cell::before,
  .condition-cell::before,
  .observed-cell::before {
    content: attr(data-label);
    min-width: 86px;
    color: var(--text-muted);
    font-size: 9px;
    text-transform: uppercase;
  }
  .impact-cell small { flex-basis: auto; }
  .condition-cell { flex-direction: row; align-items: center; }
  .target-actions { justify-content: flex-start; }
}
</style>
