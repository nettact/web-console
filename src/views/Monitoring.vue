<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  api,
  type AgentGroup,
  type MonitorGroup,
  type ProbeTarget,
  type TargetStatusRow,
  type TargetAgentStatusRow,
} from '../api'
import MonitorStateBadge from '../components/status/MonitorStateBadge.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { targetStatus, targetIndex } from '../targetStatus'
import { useMetricMeta } from '../composables/useMetricMeta'
import { useIncidentLabels } from '../composables/useIncidentLabels'
import { typeLabel, targetLabel } from '../lib/targetLabels'
import { fmtNum } from '../lib/metricMeta'
import { toDateLocale } from '../i18n'

const { t: tr, locale } = useI18n()
const { metricLabel, unitLabel } = useMetricMeta()
const { comparatorSymbol, comparatorLabel } = useIncidentLabels()

const SITE = 'site_default'
const groups = ref<MonitorGroup[]>([])
const targets = ref<ProbeTarget[]>([])
const agentGroups = ref<AgentGroup[]>([])
const error = ref('')
const busy = ref(false)

// Authoritative current status per target — the only source of current health.
const statusOf = (id: string | undefined): TargetStatusRow | undefined =>
  id ? targetIndex.value.get(id) : undefined

// Expandable per-agent detail rows (issue AC-11 drill-down).
const expanded = ref<Set<string>>(new Set())
function toggleDetail(id: string | undefined) {
  if (!id) return
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

async function load() {
  try {
    ;[groups.value, targets.value, agentGroups.value] = await Promise.all([
      api.monitorGroups(SITE),
      api.listTargets(SITE),
      api.agentGroups(SITE),
    ])
    targets.value.forEach((t) => {
      if (!t.params) t.params = {}
    })
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// Targets owned by a group (static membership via group_id).
function targetsOf(g: MonitorGroup): ProbeTarget[] {
  return targets.value.filter((t) => t.group_id === g.id)
}
// The group's shared Agent execution scope, as a readable label.
function scopeLabel(g: MonitorGroup): string {
  if (g.all_agents) return tr('monitoring.scopeAll')
  const names = g.agent_group_ids.map((id) => agentGroups.value.find((x) => x.id === id)?.name).filter(Boolean)
  return names.length ? (names as string[]).join(', ') : tr('monitoring.scopeNone')
}
function mergeLabel(g: MonitorGroup): string {
  return g.merge_enabled ? tr('monitoring.mergeOn') : tr('monitoring.mergeOff')
}

// ---- status formatting helpers ----
const fmtTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'

// Condition context is derived on the client from stable machine values
// (metric_kind + comparator + threshold) — the server never sends display text.
function lastValueLabel(a: TargetAgentStatusRow): string {
  if (a.last_value == null || !a.last_metric_kind) return '—'
  const unit = a.last_unit ? unitLabel(a.last_unit) : ''
  return `${fmtNum(a.last_value)}${unit ? ' ' + unit : ''}`
}
// Distinct current-generation incident deep links for an abnormal target.
function incidentLinks(row: TargetStatusRow) {
  return row.incident_ids.map((id) => ({ id, to: { path: '/incidents', query: { incident: id } } }))
}
function agentTo(agentId: string) {
  return { path: '/target-status', query: { agent: agentId } }
}

// ---- delete target (full-reconcile save without it) ----
const pendingDeleteTarget = ref<ProbeTarget | null>(null)
async function confirmDeleteTarget() {
  const t = pendingDeleteTarget.value
  if (!t?.id) return
  busy.value = true
  error.value = ''
  try {
    const rest = targets.value.filter((x) => x.id && x.id !== t.id)
    await api.setTargets(SITE, rest)
    pendingDeleteTarget.value = null
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// ---- delete group (targets move to default; rules + active incidents terminate) ----
const pendingDeleteGroup = ref<MonitorGroup | null>(null)
async function confirmDeleteGroup() {
  const g = pendingDeleteGroup.value
  if (!g) return
  busy.value = true
  error.value = ''
  try {
    await api.deleteMonitorGroup(g.id)
    pendingDeleteGroup.value = null
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// ---- history purge (unchanged behavior) ----
const purgeMonId = ref('')
const purgeTgt = ref('')
const purgeMsg = ref('')
async function purgeMonitor() {
  const t = targets.value.find((x) => x.id === purgeMonId.value)
  if (!t?.id) return
  if (!confirm(tr('monitoring.confirmClearHistory', { name: t.name || t.target }))) return
  purgeMsg.value = ''
  try {
    const r = await api.purgeMonitor(SITE, t.id)
    purgeMsg.value = tr('monitoring.purgedMsg', { count: r.purged_series })
    purgeMonId.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function purgeSystem() {
  if (!purgeTgt.value) return
  if (!confirm(tr('monitoring.confirmClearHistory', { name: purgeTgt.value }))) return
  purgeMsg.value = ''
  try {
    const r = await api.purgeTarget(SITE, purgeTgt.value)
    purgeMsg.value = tr('monitoring.purgedMsg', { count: r.purged_series })
    purgeTgt.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

const hasSnapshot = computed(() => targetStatus.loaded)
onMounted(load)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ tr('monitoring.title') }}</h2>
      <p class="sub">{{ tr('monitoring.sub') }}</p>
      <span class="spacer"></span>
      <router-link to="/monitoring/groups/new" class="btn">{{ tr('monitoring.newGroup') }}</router-link>
      <router-link to="/monitoring/new-host" class="btn">{{ tr('monitoring.newHostMonitor') }}</router-link>
      <router-link to="/monitoring/new" class="btn btn-primary">{{ tr('monitoring.newMonitor') }}</router-link>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <!-- Authoritative-status freshness / failure banner. -->
    <p v-if="targetStatus.error && !hasSnapshot" class="err" role="alert">{{ tr('targetStatus.errorBanner') }}</p>
    <p v-else-if="targetStatus.stale" class="status-banner stale" role="status">
      {{ tr('targetStatus.staleBanner', { time: fmtTime(targetStatus.generatedAt) }) }}
    </p>
    <p v-else-if="hasSnapshot" class="status-banner ok">
      {{ tr('targetStatus.updatedAt', { time: fmtTime(targetStatus.generatedAt) }) }}
    </p>

    <section v-for="g in groups" :key="g.id" class="panel group-panel">
      <div class="panel-head group-head">
        <h3>{{ g.name }}</h3>
        <span v-if="g.is_default" class="badge neutral">{{ tr('monitoring.defaultTag') }}</span>
        <span class="count">{{ targetsOf(g).length }}</span>
        <router-link :to="`/monitoring/new?group=${g.id}`" class="link-btn add-in-group">
          {{ tr('monitoring.addToGroup') }}
        </router-link>
        <router-link :to="`/monitoring/groups/${g.id}/edit`" class="link-btn">{{ tr('monitoring.editGroup') }}</router-link>
        <button
          class="link-btn danger"
          :disabled="g.is_default || busy"
          :title="g.is_default ? tr('monitoring.defaultNoDelete') : ''"
          @click="pendingDeleteGroup = g"
        >
          {{ tr('monitoring.deleteGroup') }}
        </button>
      </div>
      <!-- Shared group facts: Agent scope and merge behavior apply to every target below. -->
      <div class="group-facts">
        <span class="fact">
          <span class="fact-lbl">{{ tr('monitoring.thScope') }}</span>
          <span class="fact-val">{{ scopeLabel(g) }}</span>
        </span>
        <span class="fact">
          <span class="fact-lbl">{{ tr('monitoring.mergeLabel') }}</span>
          <span class="fact-val" :class="g.merge_enabled ? 'on' : 'off'">{{ mergeLabel(g) }}</span>
        </span>
      </div>

      <div class="table-wrap" v-if="targetsOf(g).length">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ tr('monitoring.thName') }}</th>
              <th>{{ tr('monitoring.thType') }}</th>
              <th>{{ tr('monitoring.thTarget') }}</th>
              <th>{{ tr('monitoring.thStatus') }}</th>
              <th class="center">{{ tr('monitoring.thEnabled') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="t in targetsOf(g)" :key="t.id">
              <tr>
                <td>{{ t.name || tr('monitoring.unnamed') }}</td>
                <td>{{ typeLabel(t, tr) }}</td>
                <td class="mono">
                  {{ targetLabel(t, tr) }}<span v-if="t.kind === 'tcp' && t.params?.port">:{{ t.params.port }}</span>
                </td>
                <td class="status">
                  <template v-if="statusOf(t.id)">
                    <button
                      class="status-toggle"
                      :aria-expanded="expanded.has(t.id!)"
                      :aria-label="tr('targetStatus.toggleDetailAria', { name: t.name || t.target })"
                      @click="toggleDetail(t.id)"
                    >
                      <span class="caret" :class="{ open: expanded.has(t.id!) }">▸</span>
                      <MonitorStateBadge dim="display" :state="statusOf(t.id)!.display_state" />
                    </button>
                    <span
                      v-if="statusOf(t.id)!.affected_agents > 0"
                      class="affected"
                    >{{ tr('targetStatus.affected', { affected: statusOf(t.id)!.affected_agents, total: statusOf(t.id)!.applicable_agents }) }}</span>
                    <span
                      v-if="statusOf(t.id)!.display_state === 'breaching'"
                      class="breach-hint"
                    >{{ tr('targetStatus.breachingHint') }}</span>
                    <span
                      v-for="link in incidentLinks(statusOf(t.id)!)"
                      :key="link.id"
                      class="nav-chip"
                    >
                      <router-link :to="link.to">{{ tr('targetStatus.incidentLink') }}</router-link>
                    </span>
                  </template>
                  <span v-else class="dim">—</span>
                </td>
                <td class="center"><span :class="['dot', t.enabled ? 'on' : 'off']"></span></td>
                <td class="actions">
                  <router-link :to="`/monitoring/${t.id}/edit`" class="link-btn">{{ tr('monitoring.editMonitor') }}</router-link>
                  <button class="link-btn danger" :disabled="busy" @click="pendingDeleteTarget = t">
                    {{ tr('common.delete') }}
                  </button>
                </td>
              </tr>
              <!-- Per-agent authoritative detail (execution / probe / rule + context). -->
              <tr v-if="t.id && expanded.has(t.id) && statusOf(t.id)" class="detail-row">
                <td colspan="6">
                  <div v-if="!statusOf(t.id)!.agents.length" class="hint pad">
                    {{ tr('targetStatus.noApplicableAgents') }}
                  </div>
                  <div v-else class="agent-detail">
                    <div v-for="a in statusOf(t.id)!.agents" :key="a.agent_id" class="agent-line">
                      <div class="agent-head">
                        <span class="agent-name mono">
                          <span class="dot-inline" :class="a.agent_online ? 'on' : 'off'"></span>{{ a.agent_name || a.agent_id }}
                        </span>
                        <MonitorStateBadge dim="execution" :state="a.execution_state" />
                        <MonitorStateBadge v-if="a.probe_state !== 'not_applicable'" dim="probe" :state="a.probe_state" />
                        <MonitorStateBadge v-if="a.rule_state !== 'normal'" dim="rule" :state="a.rule_state" />
                        <router-link class="agent-link" :to="agentTo(a.agent_id)">{{ tr('targetStatus.viewAgent') }}</router-link>
                      </div>
                      <div class="agent-facts">
                        <span class="fact-item">{{ tr('targetStatus.statusLabel') }}: {{ tr('targetStatus.reason.' + a.reason_code) }}</span>
                        <span v-if="a.last_metric_kind" class="fact-item">
                          {{ tr('targetStatus.lastValue') }}: {{ lastValueLabel(a) }}
                          <template v-if="a.last_observed_at"> · {{ tr('targetStatus.observedAt', { time: fmtTime(a.last_observed_at) }) }}</template>
                        </span>
                        <span v-if="a.execution_state === 'pending' && a.pending_since" class="fact-item">
                          {{ tr('targetStatus.pendingSince', { time: fmtTime(a.pending_since) }) }}
                        </span>
                        <span v-if="a.missing_permissions.length" class="fact-item">
                          {{ tr('targetStatus.missingPerms', { n: a.missing_permissions.length }) }}
                        </span>
                      </div>
                      <ul v-if="a.active_conditions.length" class="cond-list">
                        <li v-for="c in a.active_conditions" :key="c.condition_id">
                          <span class="cond-rule">{{ c.rule_name }}</span>
                          <span class="cond-expr mono">
                            {{ metricLabel(c.metric_kind) }}
                            <span :aria-label="comparatorLabel(c.comparator)">{{ comparatorSymbol(c.comparator) }}</span>
                            {{ fmtNum(c.threshold) }}<template v-if="c.unit"> {{ unitLabel(c.unit) }}</template>
                            <template v-if="c.last_value != null"> · {{ tr('targetStatus.condValue', { v: fmtNum(c.last_value) }) }}</template>
                          </span>
                          <router-link v-if="c.incident_id" class="cond-link" :to="{ path: '/incidents', query: { incident: c.incident_id } }">
                            {{ tr('targetStatus.incidentLink') }}
                          </router-link>
                        </li>
                      </ul>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-else class="hint group-empty">
        {{ g.is_default ? tr('monitoring.defaultGroupEmpty') : tr('monitoring.groupEmpty') }}
        <router-link :to="`/monitoring/new?group=${g.id}`">{{ tr('monitoring.addToGroup') }}</router-link>
      </p>
    </section>

    <section class="panel danger-zone">
      <div class="panel-head">
        <h3>{{ tr('monitoring.clearHistory') }}</h3>
        <span class="tag-danger">{{ tr('monitoring.dangerOp') }}</span>
      </div>
      <div class="panel-body">
        <p class="hint">{{ tr('monitoring.clearHistoryHint') }}</p>
        <div class="row">
          <select v-model="purgeMonId" class="purge-in">
            <option value="" disabled>{{ tr('monitoring.purgePickMonitor') }}</option>
            <option v-for="t in targets.filter((x) => x.id)" :key="t.id" :value="t.id">
              {{ t.name || tr('monitoring.unnamed') }} · {{ targetLabel(t, tr) }}
            </option>
          </select>
          <button class="btn btn-danger" :disabled="!purgeMonId" @click="purgeMonitor">{{ tr('monitoring.clearTargetHistory') }}</button>
          <span v-if="purgeMsg" class="ok">{{ purgeMsg }}</span>
        </div>
        <p class="hint sys-hint">{{ tr('monitoring.purgeSystemHint') }}</p>
        <div class="row">
          <input v-model="purgeTgt" :placeholder="tr('monitoring.purgePlaceholder')" class="purge-in" />
          <button class="btn btn-danger" :disabled="!purgeTgt" @click="purgeSystem">{{ tr('monitoring.clearSystemHistory') }}</button>
        </div>
      </div>
    </section>

    <ConfirmDialog
      :open="!!pendingDeleteTarget"
      :title="tr('monitoring.deleteTargetTitle', { name: pendingDeleteTarget?.name || pendingDeleteTarget?.target || '' })"
      :message="[tr('monitoring.deleteTargetBody1'), tr('monitoring.deleteTargetBody2')]"
      :confirm-label="tr('common.delete')"
      :cancel-label="tr('mgroup.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="confirmDeleteTarget"
      @cancel="pendingDeleteTarget = null"
    />
    <ConfirmDialog
      :open="!!pendingDeleteGroup"
      :title="tr('monitoring.deleteGroupTitle', { name: pendingDeleteGroup?.name || '' })"
      :message="[tr('monitoring.deleteGroupBody1'), tr('monitoring.deleteGroupBody2')]"
      :confirm-label="tr('monitoring.deleteGroup')"
      :cancel-label="tr('mgroup.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="confirmDeleteGroup"
      @cancel="pendingDeleteGroup = null"
    />
  </main>
</template>

<style scoped>
.page {
  max-width: 1000px;
}
.panel {
  margin-bottom: 20px;
}
.group-panel {
  overflow: visible;
}
.group-head {
  flex-wrap: wrap;
}
.group-head .link-btn {
  font-size: 13px;
}
.add-in-group {
  margin-left: auto;
}
.status-banner {
  font-size: 12.5px;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  margin-bottom: 14px;
}
.status-banner.ok {
  color: var(--text-muted);
  background: var(--overlay-subtle);
  border: 1px solid var(--border);
}
.status-banner.stale {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid rgba(248, 113, 113, 0.3);
}
.group-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--overlay-subtle);
}
.fact {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
}
.fact-lbl {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.fact-val {
  color: var(--text-dim);
}
.fact-val.on {
  color: var(--success);
}
.fact-val.off {
  color: var(--text-dim);
}
.table-wrap {
  overflow-x: auto;
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
.mono {
  font-family: var(--mono);
  font-size: 12.5px;
}
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.status .dim {
  color: var(--text-muted);
}
.status-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  font: inherit;
  color: inherit;
}
.status-toggle:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 4px;
}
.caret {
  display: inline-block;
  font-size: 10px;
  color: var(--text-muted);
  transition: transform 0.15s;
}
.caret.open {
  transform: rotate(90deg);
}
.affected {
  font-size: 11.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.breach-hint {
  font-size: 11.5px;
  color: var(--text-dim);
}
.nav-chip a {
  font-size: 11.5px;
}
.detail-row > td {
  background: var(--overlay-subtle);
  padding: 12px 18px;
}
.agent-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.agent-line {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--border);
}
.agent-line:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.agent-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.agent-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.dot-inline {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot-inline.on {
  background: var(--success);
}
.dot-inline.off {
  background: var(--border-strong);
}
.agent-link,
.cond-link {
  font-size: 11.5px;
  margin-left: auto;
}
.agent-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 12px;
  color: var(--text-muted);
}
.cond-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cond-list li {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
}
.cond-rule {
  color: var(--text-dim);
  font-weight: 600;
}
.cond-expr {
  color: var(--text-muted);
}
.pad {
  padding: 8px 2px;
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.dot.on {
  background: var(--success);
}
.dot.off {
  background: var(--border);
}
.group-empty {
  padding: 14px 18px;
  font-size: 13px;
}
.purge-in {
  min-width: 280px;
  flex: 1;
}
.sys-hint {
  margin-top: 14px;
}
.panel-body {
  padding: 14px 18px;
}
.danger-zone {
  border-color: rgba(248, 113, 113, 0.28);
}
.tag-danger {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid rgba(248, 113, 113, 0.3);
}
</style>
