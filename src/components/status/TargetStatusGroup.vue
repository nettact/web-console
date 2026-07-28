<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProbeTarget, TargetStatusRow } from '../../api'
import type { TargetStatusGroupView } from '../../lib/targetStatusPage'
import { targetLabel, typeLabel } from '../../lib/targetLabels'
import { availabilityTone, formatAvailability } from '../../lib/targetStatus'
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

// The built-in detector's state for the whole target row: a confirmed fault wins,
// otherwise the Agent whose failing streak is closest to its threshold is the one
// worth surfacing (that pair decides when the target flips to faulted).
interface FaultCell {
  kind: 'faulted' | 'confirming' | 'none'
  severity: string
  fail: number
  need: number
}

const faultCells = computed(() => {
  const out = new Map<string, FaultCell>()
  for (const row of props.view.targets) {
    if (row.agents.some((agent) => agent.fault_state === 'faulted')) {
      out.set(row.target_id, { kind: 'faulted', severity: row.worst_severity || 'error', fail: 0, need: 0 })
      continue
    }
    let best: { fail: number; need: number } | null = null
    for (const agent of row.agents) {
      const progress = agent.confirm
      if (!progress) continue
      const candidate = { fail: progress.fail_rounds, need: Math.max(progress.need_rounds, 1) }
      if (!best || candidate.fail / candidate.need > best.fail / best.need) best = candidate
    }
    out.set(row.target_id, best ? { kind: 'confirming', severity: '', ...best } : { kind: 'none', severity: '', fail: 0, need: 0 })
  }
  return out
})

const faultCell = (row: TargetStatusRow): FaultCell =>
  faultCells.value.get(row.target_id) ?? { kind: 'none', severity: '', fail: 0, need: 0 }

// An absent ratio is "unknown", never 0%: a 24h window that reached no verdict
// (blocked, unsupported, Agent offline throughout) says nothing about uptime.
function availabilityLabel(row: TargetStatusRow): string {
  return formatAvailability(row.availability_24h) ?? t('targetStatus.availabilityUnknown')
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
          <span>{{ t('targetStatus.faultTitle') }}</span>
          <span>{{ t('targetStatus.availability24h') }}</span>
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
            </div>

            <div class="impact-cell" :data-label="t('targetStatus.agentImpact')">
              <strong :class="{ affected: row.affected_agents > 0 }">{{ row.affected_agents }}</strong>
              <span>/ {{ row.applicable_agents }}</span>
              <small>{{ t('targetStatus.agentsAffected') }}</small>
            </div>

            <div class="fault-cell" :data-label="t('targetStatus.faultTitle')">
              <template v-if="faultCell(row).kind === 'faulted'">
                <strong :class="`severity-${faultCell(row).severity}`">
                  {{ t(`targetStatus.severity.${faultCell(row).severity}`) }}
                </strong>
                <span>{{ t('targetStatus.reason.fault_confirmed') }}</span>
              </template>
              <span v-else-if="faultCell(row).kind === 'confirming'" class="confirming">
                {{ t('targetStatus.confirmProgress', { n: faultCell(row).fail, need: faultCell(row).need }) }}
              </span>
              <span v-else class="muted">{{ t('targetStatus.fault.normal') }}</span>
            </div>

            <div class="availability-cell" :data-label="t('targetStatus.availability24h')">
              <span
                class="avail-pill"
                :class="`is-${availabilityTone(row.availability_24h)}`"
                :title="t('targetStatus.availabilityHint')"
              >{{ availabilityLabel(row) }}</span>
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
  grid-template-columns: minmax(215px, 1.35fr) 126px 130px 130px 105px 130px minmax(150px, auto);
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
.fault-cell,
.availability-cell,
.impact-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.impact-cell strong { font-size: 14px; }
.impact-cell strong.affected { color: var(--danger); }
.impact-cell span { color: var(--text-dim); font-size: 11px; }
.impact-cell small { flex-basis: 100%; color: var(--text-muted); font-size: 9.5px; }
.fault-cell {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  font-size: 10.5px;
}
.fault-cell strong { color: var(--warning); font-size: 11px; }
.fault-cell .confirming { color: var(--warning); font-variant-numeric: tabular-nums; }
.fault-cell .severity-error,
.fault-cell .severity-critical { color: var(--danger); }
.avail-pill {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.avail-pill.is-good { color: #6ee7b7; border-color: rgba(52, 211, 153, 0.35); background: rgba(52, 211, 153, 0.1); }
.avail-pill.is-warn { color: #fcd34d; border-color: rgba(251, 191, 36, 0.35); background: var(--warning-soft); }
.avail-pill.is-bad { color: #fca5a5; border-color: rgba(248, 113, 113, 0.35); background: var(--danger-soft); }
.avail-pill.is-unknown { color: var(--text-muted); border-color: var(--border-strong); }
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
  .fault-cell,
  .availability-cell,
  .observed-cell,
  .target-actions { margin-left: 45px; }
  .fault-cell::before,
  .availability-cell::before,
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
  .fault-cell,
  .availability-cell,
  .observed-cell,
  .target-actions { grid-column: 1 / -1; margin-left: 45px; }
  .impact-cell::before,
  .fault-cell::before,
  .availability-cell::before,
  .observed-cell::before {
    content: attr(data-label);
    min-width: 86px;
    color: var(--text-muted);
    font-size: 9px;
    text-transform: uppercase;
  }
  .impact-cell small { flex-basis: auto; }
  .fault-cell { flex-direction: row; align-items: center; }
  .target-actions { justify-content: flex-start; }
}
</style>
