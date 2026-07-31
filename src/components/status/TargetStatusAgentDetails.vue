<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { TargetAgentStatusRow, TargetStatusRow } from '../../api'
import { formatAvailability } from '../../lib/targetStatus'
import { toDateLocale } from '../../i18n'
import { notifications } from '../../notifications'
import { serverInfo, ensureServerInfo } from '../../serverInfo'
import MonitorStateBadge from './MonitorStateBadge.vue'
import PermissionChips from './PermissionChips.vue'
import PermissionRemediationDialog from './PermissionRemediationDialog.vue'
import TargetStatusPerformance from './TargetStatusPerformance.vue'

const props = defineProps<{
  target: TargetStatusRow
  selectedAgentId?: string
}>()

const router = useRouter()
const { t, te, locale } = useI18n()

// Remediation dialog for a clicked missing permission. A missing permission on a
// target×agent pair is permission_blocked (not granted) unless the pair's whole
// execution is `unsupported` (a platform/build gap for that probe kind). The full
// NETTACT_AGENT_PERMISSIONS line is taken only from the active permission_blocked
// issue for THIS exact target×agent (GET /issues, mirrored live in the
// notifications store); the console never recomputes the granted∪missing closure
// itself, so when no such issue is present we fall back to a generic instruction
// inside the dialog.
const remediation = ref<{
  permId: string
  category: 'permission_blocked' | 'unsupported'
  env: string
} | null>(null)

function permissionsEnvFor(agentID: string): string {
  // Only an *active* permission_blocked issue whose ref_id is exactly this target
  // carries the env line for this target×agent pair. That line is the server's
  // whole-policy replacement computed for one issue, so a different target's issue
  // may omit the permission the operator just clicked — never borrow it. No exact
  // match falls through to the dialog's generic "can't generate a full line" path.
  const exact = notifications.issues.find(
    (i) =>
      i.state === 'active' &&
      i.reason === 'permission_blocked' &&
      i.agent_id === agentID &&
      i.ref_id === props.target.target_id &&
      i.remediation?.permissions_env,
  )
  return exact?.remediation?.permissions_env || ''
}

function openRemediation(agent: TargetAgentStatusRow, permId: string): void {
  ensureServerInfo()
  const category = agent.execution_state === 'unsupported' ? 'unsupported' : 'permission_blocked'
  remediation.value = {
    permId,
    category,
    env: category === 'permission_blocked' ? permissionsEnvFor(agent.agent_id) : '',
  }
}

function fmtTime(value?: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false })
}

function reasonLabel(agent: TargetAgentStatusRow): string {
  return t(`targetStatus.reason.${agent.reason_code}`)
}

function availabilityLabel(agent: TargetAgentStatusRow): string {
  return formatAvailability(agent.availability_24h) ?? t('targetStatus.availabilityUnknown')
}

// Fluctuations over the same 24 hours the availability figure covers, per Agent.
// It rides along on the authoritative status batch (one grouped query for the whole
// site) rather than being fetched here, so the number costs nothing extra and
// cannot disagree with the count shown on the collapsed row.

// Native tooltip for the stale probe badge: explains the per-agent freshness
// window that classified this pair as stale. Only shown when the pair is stale
// and the server reported a window (omitted for host targets).
function staleTitle(agent: TargetAgentStatusRow): string | undefined {
  if (agent.probe_state !== 'stale' || agent.stale_after_seconds == null) return undefined
  return t('targetStatus.staleAfter', { n: agent.stale_after_seconds })
}

function executionContextLabel(agent: TargetAgentStatusRow): string {
  if (agent.execution_state === 'target_blocked' && agent.matched_selector) {
    return t('targetStatus.context.target_blocked_selector', { selector: agent.matched_selector })
  }
  return t(`targetStatus.context.${agent.execution_state}`)
}

// Severity comes off a frozen fault ref as a raw server string; fall back to the
// code itself rather than rendering a blank pill for a severity we don't know.
function severityLabel(severity: string): string {
  const key = `targetStatus.severity.${severity}`
  return te(key) ? t(key) : severity
}

function historyLocation(agentID: string) {
  return {
    path: '/target-status',
    query: {
      view: 'targets',
      agent: agentID,
      target: props.target.target_id,
      ttab: 'history',
    },
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
        abnormal: agent.execution_state !== 'collecting' || agent.probe_state === 'failed' || agent.fault_state !== 'normal',
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
          <MonitorStateBadge
            v-if="agent.probe_state !== 'not_applicable'"
            dim="probe"
            :state="agent.probe_state"
            :title="staleTitle(agent)"
          />
          <MonitorStateBadge dim="fault" :state="agent.fault_state" />
        </div>
        <span class="history-link-hint">{{ t('targetStatus.openHistory') }} →</span>
      </header>

      <div class="agent-facts">
        <div class="fact-card">
          <span>{{ t('targetStatus.statusLabel') }}</span>
          <strong>{{ reasonLabel(agent) }}</strong>
        </div>
        <div class="fact-card availability-fact">
          <span>{{ t('targetStatus.availability24h') }}</span>
          <strong>{{ availabilityLabel(agent) }}</strong>
          <!-- The explanation for a figure below 100% that raised no fault. The card
               opens the history page, where each one is listed with its cause. -->
          <small v-if="agent.fluctuations_24h" class="flux-note">
            {{ t('targetStatus.fluctuationCount24h', { n: agent.fluctuations_24h }) }}
          </small>
          <small v-else>{{ t('targetStatus.availabilityHint') }}</small>
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
        interactive
        @select="(permId: string) => openRemediation(agent, permId)"
      />

      <!-- The built-in availability detector's own verdict for this pair: a
           confirmed fault (frozen title + severity, deep-linked to the incident
           that owns it) or, short of the threshold, its confirmation progress. -->
      <div v-if="agent.fault_state === 'faulted' && agent.fault" class="fault-panel is-faulted">
        <div class="fault-main">
          <strong>{{ agent.fault.title }}</strong>
          <span class="severity" :class="`severity-${agent.fault.severity}`">{{ severityLabel(agent.fault.severity) }}</span>
        </div>
        <div class="fault-meta">
          <span>{{ t('targetStatus.confirmSince', { time: fmtTime(agent.fault.observed_at) }) }}</span>
        </div>
        <router-link
          v-if="agent.fault.incident_id"
          class="incident-link"
          :to="{ path: '/incidents', query: { incident: agent.fault.incident_id } }"
          @click.stop
          @keydown.enter.stop
          @keydown.space.stop
        >
          {{ t('targetStatus.viewFault') }} →
        </router-link>
      </div>

      <div v-else-if="agent.fault_state === 'confirming' && agent.confirm" class="fault-panel is-confirming">
        <div class="fault-main">
          <strong>{{ t('targetStatus.fault.confirming') }}</strong>
          <span class="confirm-rounds">
            {{ t('targetStatus.confirmProgress', { n: agent.confirm.fail_rounds, need: agent.confirm.need_rounds }) }}
          </span>
        </div>
        <div class="fault-meta">
          <span v-if="agent.confirm.first_fail_at">
            {{ t('targetStatus.confirmSince', { time: fmtTime(agent.confirm.first_fail_at) }) }}
          </span>
        </div>
      </div>
    </article>

    <PermissionRemediationDialog
      :open="!!remediation"
      :perm-id="remediation?.permId || ''"
      :category="remediation?.category || 'permission_blocked'"
      :permissions-env="remediation?.env"
      :desktop="serverInfo.desktop"
      @close="remediation = null"
    />
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
.fault-main,
.fault-meta {
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
.agent-card.abnormal { border-color: color-mix(in oklch, var(--color-danger) 30%, transparent); }
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
.incident-link { color: var(--color-accent-text); font-size: 11.5px; text-decoration: none; }
.history-link-hint { margin-left: auto; }
.agent-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 11px; }
.fact-card { min-width: 0; padding: 9px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--overlay-subtle); }
.fact-card > span { display: block; color: var(--text-muted); font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; }
.fact-card strong,
.fact-card small { display: block; margin-top: 5px; overflow-wrap: anywhere; }
.fact-card strong { color: var(--text-dim); font-size: 12px; font-weight: 550; }
.fact-card small { color: var(--text-muted); font-size: 10.5px; }
/* The fluctuation count replaces the generic hint and has to be noticed: it is the
   answer to the question the figure above it raises. */
.fact-card small.flux-note { color: var(--color-warning-text); }
.missing-permissions { margin-top: 10px; }
.fault-panel {
  display: grid;
  grid-template-columns: minmax(200px, 1.2fr) minmax(220px, 1.4fr) auto;
  align-items: center;
  gap: 12px;
  margin-top: 11px;
  padding: 9px 10px;
  border-left: 2px solid var(--danger);
  border-radius: 0 7px 7px 0;
  background: var(--danger-soft);
}
.fault-panel.is-confirming { border-left-color: var(--warning); background: var(--warning-soft); }
.fault-main { gap: 7px; flex-wrap: wrap; }
.fault-main strong { font-size: 11.5px; }
.severity { padding: 1px 6px; border-radius: var(--radius-pill); color: var(--text-dim); font-size: 9.5px; background: var(--surface-2); }
.severity-error,
.severity-critical { color: var(--color-danger-text); }
.severity-warn { color: var(--color-warning-text); }
.confirm-rounds { color: var(--color-warning-text); font-family: var(--mono); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.fault-meta { gap: 12px; flex-wrap: wrap; color: var(--text-dim); font-size: 11px; }
.empty-agent { padding: 12px 2px; }

@media (max-width: 760px) {
  .agent-details { padding: 12px; }
  .agent-identity { min-width: 0; flex-basis: 100%; }
  .history-link-hint { margin-left: 0; }
  .agent-facts { grid-template-columns: 1fr; }
  .fault-panel { grid-template-columns: 1fr; gap: 6px; }
  .incident-link { justify-self: start; }
}
</style>
