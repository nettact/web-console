<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { TargetAgentStatusRow, TargetStatusRow } from '../../api'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { useIncidentLabels } from '../../composables/useIncidentLabels'
import { fmtNum } from '../../lib/metricMeta'
import { toDateLocale } from '../../i18n'
import MonitorStateBadge from './MonitorStateBadge.vue'
import PermissionChips from './PermissionChips.vue'
import TargetStatusPerformance from './TargetStatusPerformance.vue'

const props = defineProps<{
  target: TargetStatusRow
  selectedAgentId?: string
}>()

const router = useRouter()
const { t, locale } = useI18n()
const { metricLabel, unitLabel } = useMetricMeta()
const { comparatorLabel, comparatorSymbol } = useIncidentLabels()

function fmtTime(value?: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false })
}

function lastValueLabel(agent: TargetAgentStatusRow): string {
  if (agent.last_value == null || !agent.last_metric_kind) return t('targetStatus.noLatestValue')
  const unit = agent.last_unit ? unitLabel(agent.last_unit) : ''
  return `${fmtNum(agent.last_value)}${unit ? ` ${unit}` : ''}`
}

function reasonLabel(agent: TargetAgentStatusRow): string {
  return t(`targetStatus.reason.${agent.reason_code}`)
}

function executionContextLabel(agent: TargetAgentStatusRow): string {
  if (agent.execution_state === 'target_blocked' && agent.matched_selector) {
    return t('targetStatus.context.target_blocked_selector', { selector: agent.matched_selector })
  }
  return t(`targetStatus.context.${agent.execution_state}`)
}

function historyLocation(agentID: string) {
  return {
    path: `/target-status/${encodeURIComponent(props.target.target_id)}/agents/${encodeURIComponent(agentID)}/history`,
  }
}

function openHistory(agentID: string): void {
  router.push(historyLocation(agentID))
}
</script>

<template>
  <div class="agent-details">
    <div class="detail-intro">
      <h4>{{ t('targetStatus.agentDetailTitle') }}</h4>
      <p>{{ t('targetStatus.agentDetailHint') }}</p>
    </div>
    <p v-if="!target.agents.length" class="hint empty-agent">{{ t('targetStatus.noApplicableAgents') }}</p>

    <article
      v-for="agent in target.agents"
      :key="agent.agent_id"
      class="agent-card"
      :class="{
        highlighted: selectedAgentId === agent.agent_id,
        abnormal: agent.execution_state !== 'collecting' || agent.probe_state === 'failed' || agent.rule_state !== 'normal',
      }"
      role="link"
      tabindex="0"
      :aria-label="t('targetStatus.openHistoryAria', { agent: agent.agent_name || agent.agent_id })"
      @click="openHistory(agent.agent_id)"
      @keydown.enter.prevent="openHistory(agent.agent_id)"
      @keydown.space.prevent="openHistory(agent.agent_id)"
    >
      <header class="agent-head">
        <div class="agent-identity">
          <span class="online-dot" :class="agent.agent_online ? 'online' : 'offline'"></span>
          <strong>{{ agent.agent_name || agent.agent_id }}</strong>
          <span class="agent-id">{{ agent.agent_id }}</span>
        </div>
        <div class="state-badges">
          <MonitorStateBadge dim="execution" :state="agent.execution_state" />
          <MonitorStateBadge v-if="agent.probe_state !== 'not_applicable'" dim="probe" :state="agent.probe_state" />
          <MonitorStateBadge dim="rule" :state="agent.rule_state" />
        </div>
        <span class="history-link-hint">{{ t('targetStatus.openHistory') }} →</span>
      </header>

      <div class="agent-facts">
        <div class="fact-card">
          <span>{{ t('targetStatus.statusLabel') }}</span>
          <strong>{{ reasonLabel(agent) }}</strong>
        </div>
        <div class="fact-card">
          <span>{{ t('targetStatus.lastValue') }}</span>
          <strong>{{ lastValueLabel(agent) }}</strong>
          <small>{{ t('targetStatus.observedAt', { time: fmtTime(agent.last_observed_at) }) }}</small>
        </div>
        <div class="fact-card">
          <span>{{ t('targetStatus.executionContext') }}</span>
          <strong>{{ executionContextLabel(agent) }}</strong>
          <small v-if="agent.pending_since">{{ t('targetStatus.pendingSince', { time: fmtTime(agent.pending_since) }) }}</small>
        </div>
      </div>

      <TargetStatusPerformance
        :target-id="target.target_id"
        :target-kind="target.kind"
        :agent-id="agent.agent_id"
      />

      <PermissionChips
        v-if="agent.missing_permissions.length"
        class="missing-permissions"
        :label="t('targetStatus.missingPermissions')"
        :ids="agent.missing_permissions"
      />

      <ul v-if="agent.active_conditions.length" class="condition-list">
        <li v-for="condition in agent.active_conditions" :key="condition.condition_id">
          <div class="condition-main">
            <strong>{{ condition.rule_name }}</strong>
            <span class="severity" :class="`severity-${condition.severity}`">
              {{ t(`targetStatus.severity.${condition.severity}`) }}
            </span>
          </div>
          <div class="condition-expression">
            <span>{{ metricLabel(condition.metric_kind) }}</span>
            <span :aria-label="comparatorLabel(condition.comparator)">{{ comparatorSymbol(condition.comparator) }}</span>
            <span>{{ fmtNum(condition.threshold) }}</span>
            <span v-if="condition.unit">{{ unitLabel(condition.unit) }}</span>
            <span v-if="condition.last_value != null" class="condition-current">
              {{ t('targetStatus.condValue', { v: fmtNum(condition.last_value) }) }}
            </span>
          </div>
          <router-link
            v-if="condition.incident_id"
            class="incident-link"
            :to="{ path: '/incidents', query: { incident: condition.incident_id } }"
            @click.stop
            @keydown.enter.stop
            @keydown.space.stop
          >
            {{ t('targetStatus.openIncident') }} →
          </router-link>
        </li>
      </ul>
    </article>
  </div>
</template>

<style scoped>
.agent-details {
  padding: 16px 18px 18px;
  border-top: 1px solid var(--border);
  background: var(--input-bg);
}
.agent-head,
.agent-identity,
.state-badges,
.condition-main,
.condition-expression {
  display: flex;
  align-items: center;
}
.detail-intro { margin-bottom: 12px; }
.detail-intro h4 { margin: 0; font-size: 13px; }
.detail-intro p { margin: 5px 0 0; color: var(--text-muted); font-size: 11.5px; }
.agent-card {
  padding: 13px;
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.agent-card:hover,
.agent-card:focus-visible { border-color: var(--primary); background: var(--surface-2); outline: none; }
.agent-card:hover { transform: translateY(-1px); }
.agent-card.abnormal { border-color: rgba(248, 113, 113, 0.3); }
.agent-card.highlighted { box-shadow: 0 0 0 2px var(--primary-soft); border-color: var(--primary); }
.agent-head { gap: 10px; flex-wrap: wrap; }
.agent-identity { gap: 7px; min-width: 210px; }
.agent-identity strong { font-size: 13px; }
.agent-id { color: var(--text-muted); font-family: var(--mono); font-size: 10.5px; }
.online-dot { width: 8px; height: 8px; border-radius: 50%; }
.online-dot.online { background: var(--success); }
.online-dot.offline { background: var(--text-muted); }
.state-badges { gap: 6px; flex-wrap: wrap; }
.history-link-hint,
.incident-link { color: var(--primary); font-size: 11.5px; text-decoration: none; }
.history-link-hint { margin-left: auto; }
.agent-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 11px; }
.fact-card { min-width: 0; padding: 9px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--overlay-subtle); }
.fact-card > span { display: block; color: var(--text-muted); font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; }
.fact-card strong,
.fact-card small { display: block; margin-top: 5px; overflow-wrap: anywhere; }
.fact-card strong { color: var(--text-dim); font-size: 12px; font-weight: 550; }
.fact-card small { color: var(--text-muted); font-size: 10.5px; }
.missing-permissions { margin-top: 10px; }
.condition-list { display: grid; gap: 7px; margin: 11px 0 0; padding: 0; list-style: none; }
.condition-list li { display: grid; grid-template-columns: minmax(140px, 0.8fr) minmax(240px, 1.5fr) auto; align-items: center; gap: 12px; padding: 9px 10px; border-left: 2px solid var(--danger); border-radius: 0 7px 7px 0; background: var(--danger-soft); }
.condition-main { gap: 7px; }
.condition-main strong { font-size: 11.5px; }
.severity { padding: 1px 6px; border-radius: var(--radius-pill); color: var(--text-dim); font-size: 9.5px; background: var(--surface-2); }
.severity-error,
.severity-critical { color: var(--danger); }
.severity-warn { color: var(--warning); }
.condition-expression { gap: 5px; color: var(--text-dim); font-family: var(--mono); font-size: 11px; flex-wrap: wrap; }
.condition-current { color: var(--danger); }
.empty-agent { padding: 12px 2px; }

@media (max-width: 760px) {
  .agent-details { padding: 12px; }
  .agent-identity { min-width: 0; flex-basis: 100%; }
  .history-link-hint { margin-left: 0; }
  .agent-facts { grid-template-columns: 1fr; }
  .condition-list li { grid-template-columns: 1fr; gap: 6px; }
  .incident-link { justify-self: start; }
}
</style>
