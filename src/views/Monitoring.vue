<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  api,
  type AgentGroup,
  type HostDetection,
  type MonitorGroup,
  type ProbeTarget,
  type TargetStatusRow,
} from '../api'
import MonitorStateBadge from '../components/status/MonitorStateBadge.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { targetStatus, targetIndex } from '../targetStatus'
import { typeLabel, targetLabel } from '../lib/targetLabels'
import { formatAvailability } from '../lib/targetStatus'
import { toDateLocale } from '../i18n'

const { t: tr, locale } = useI18n()

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
    await loadHostFamilies()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// A host anchor's row has nothing useful to say in the target column — every one
// of them reads "host" — so it shows which families it actually watches instead.
// Fetched per anchor because the thresholds live beside the anchor rather than on
// it; there are only ever a handful, and a failure just leaves the chips off.
// Value is the enabled family list, or null while the request is in flight or
// after it failed. Those two are NOT the same as an anchor that watches nothing:
// rendering "Watching nothing" for an unknown configuration would report active
// CPU and disk alerts as switched off.
const hostFamilies = ref(new Map<string, string[] | null>())
const HOST_FAMILY_KEYS = ['cpu', 'mem', 'load', 'net', 'disk'] as const

async function loadHostFamilies() {
  const anchors = targets.value.filter((t) => t.kind === 'host' && t.id)
  if (!anchors.length) {
    hostFamilies.value = new Map()
    return
  }
  // Seeded with null so a row says "loading" rather than "nothing" from the
  // first paint; a failed request simply leaves it that way.
  const next = new Map<string, string[] | null>(anchors.map((t) => [t.id!, null]))
  hostFamilies.value = next
  await Promise.all(
    anchors.map(async (t) => {
      try {
        const d: HostDetection = await api.hostDetection(t.id!)
        next.set(
          t.id!,
          HOST_FAMILY_KEYS.filter((k) => d[k].enabled),
        )
      } catch {
        // Leave this anchor unknown rather than failing the whole page.
      }
    }),
  )
  hostFamilies.value = new Map(next)
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

const agentAvailabilityLabel = (value?: number) =>
  formatAvailability(value) ?? tr('targetStatus.availabilityUnknown')

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
        <table class="data-table target-table">
          <colgroup>
            <col class="col-name" />
            <col class="col-type" />
            <col class="col-target" />
            <col class="col-status" />
            <col class="col-enabled" />
            <col class="col-actions" />
          </colgroup>
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
                <td class="name-cell" :title="t.name || tr('monitoring.unnamed')">{{ t.name || tr('monitoring.unnamed') }}</td>
                <td class="type-cell" :title="typeLabel(t, tr)">{{ typeLabel(t, tr) }}</td>
                <td v-if="t.kind === 'host'" class="target-cell">
                  <span v-if="hostFamilies.get(t.id!) === null || hostFamilies.get(t.id!) === undefined" class="dim">
                    {{ tr('monitoring.hostFamUnknown') }}
                  </span>
                  <span v-else-if="hostFamilies.get(t.id!)!.length" class="host-fams">
                    <span v-for="k in hostFamilies.get(t.id!)!" :key="k" class="fam-chip">
                      {{ tr(`monitoring.hostFam.${k}`) }}
                    </span>
                  </span>
                  <span v-else class="dim">{{ tr('monitoring.hostFamNone') }}</span>
                </td>
                <td v-else class="mono target-cell" :title="targetLabel(t, tr)">
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
                <td class="action-cell">
                  <div class="actions">
                    <router-link :to="`/monitoring/${t.id}/edit`" class="link-btn">{{ tr('monitoring.editMonitor') }}</router-link>
                    <button class="link-btn danger" :disabled="busy" @click="pendingDeleteTarget = t">
                      {{ tr('common.delete') }}
                    </button>
                  </div>
                </td>
              </tr>
              <!-- Per-agent authoritative detail (execution / probe / fault + context). -->
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
                        <MonitorStateBadge v-if="a.fault_state !== 'normal'" dim="fault" :state="a.fault_state" />
                        <router-link class="agent-link" :to="agentTo(a.agent_id)">{{ tr('targetStatus.viewAgent') }}</router-link>
                      </div>
                      <div class="agent-facts">
                        <span class="fact-item">{{ tr('targetStatus.statusLabel') }}: {{ tr('targetStatus.reason.' + a.reason_code) }}</span>
                        <span class="fact-item">
                          {{ tr(`targetStatus.availability${targetStatus.timeRange}`) }}: {{ agentAvailabilityLabel(a.availability) }}
                        </span>
                        <span v-if="a.execution_state === 'pending' && a.pending_since" class="fact-item">
                          {{ tr('targetStatus.pendingSince', { time: fmtTime(a.pending_since) }) }}
                        </span>
                        <span v-if="a.missing_permissions.length" class="fact-item">
                          {{ tr('targetStatus.missingPerms', { n: a.missing_permissions.length }) }}
                        </span>
                      </div>
                      <!-- The built-in detector's verdict for this pair: a confirmed
                           fault (frozen title, deep-linked to its incident) or the
                           failing streak still short of the threshold. -->
                      <div v-if="a.fault_state === 'faulted' && a.fault" class="fault-line">
                        <span class="fault-title">{{ a.fault.title }}</span>
                        <span class="fault-meta">{{ tr('targetStatus.confirmSince', { time: fmtTime(a.fault.observed_at) }) }}</span>
                        <router-link v-if="a.fault.incident_id" class="fault-link" :to="{ path: '/incidents', query: { incident: a.fault.incident_id } }">
                          {{ tr('targetStatus.viewFault') }}
                        </router-link>
                      </div>
                      <div v-else-if="a.fault_state === 'confirming' && a.confirm" class="fault-line">
                        <span class="fault-title">{{ tr('targetStatus.fault.confirming') }}</span>
                        <span class="fault-meta">
                          {{ tr('targetStatus.confirmProgress', { n: a.confirm.fail_rounds, need: a.confirm.need_rounds }) }}
                          <template v-if="a.confirm.first_fail_at"> · {{ tr('targetStatus.confirmSince', { time: fmtTime(a.confirm.first_fail_at) }) }}</template>
                        </span>
                      </div>
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
/* Hallmark · genre: custom application · macrostructure: Index-First · design-system: design.md · designed-as-app
 * pre-emit critique: P5 H5 E4 S4 R5 V4
 */
.panel {
  margin-bottom: var(--space-md);
}

.group-panel {
  overflow: visible;
  border: var(--rule-hair) solid var(--glass-border);
  border-radius: var(--radius-panel);
  background: var(--glass-specular), var(--color-glass);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.group-head {
  flex-wrap: wrap;
  gap: var(--space-xs);
  min-height: 60px;
  padding: var(--space-xs) var(--space-md);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
  background: var(--glass-specular-soft), var(--color-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.group-head h3 {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  letter-spacing: -0.018em;
}

.group-head .link-btn {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding-inline: var(--space-2xs);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.add-in-group {
  margin-left: auto;
}

.status-banner {
  margin: 0 0 var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  font-size: var(--text-sm);
}

.status-banner.ok {
  color: var(--color-ink-2);
  background: var(--color-glass-subtle);
}

.status-banner.stale {
  color: var(--color-warning-text);
  border-color: var(--color-warning);
  background: var(--color-paper-2);
}

.group-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs) var(--space-lg);
  padding: var(--space-xs) var(--space-md);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-subtle);
}

.fact {
  display: flex;
  align-items: baseline;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}

.fact-lbl {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
}

.fact-val {
  color: var(--color-ink-2);
}

.fact-val.on {
  color: var(--color-success-text);
}

.fact-val.off {
  color: var(--color-muted);
}

.table-wrap {
  overflow-x: auto;
  border-radius: 0 0 var(--radius-panel) var(--radius-panel);
}

.target-table {
  min-width: 980px;
  table-layout: fixed;
}

.target-table .col-name { width: 20%; }
.target-table .col-type { width: 14%; }
.target-table .col-target { width: 28%; }
.target-table .col-status { width: 20%; }
.target-table .col-enabled { width: 7%; }
.target-table .col-actions { width: 11%; }
.name-cell,
.type-cell,
.target-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Which resource families a host anchor watches, in place of a target string
   that would read "host" on every row. */
.host-fams {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.fam-chip {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  color: var(--color-ink-2);
}
.action-cell {
  white-space: nowrap;
}
.action-cell .actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2xs);
}

.action-cell .link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 var(--space-3xs);
  line-height: 1;
}

.count {
  min-width: 28px;
  padding: var(--space-3xs) var(--space-2xs);
  border-radius: var(--radius-pill);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-ink-2);
  background: var(--color-glass-subtle);
  border: var(--rule-hair) solid var(--color-rule);
  text-align: center;
}

.mono {
  font-family: var(--font-outlier);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.status .dim {
  color: var(--color-muted);
}

.status-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 44px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0 var(--space-3xs);
  font: inherit;
  color: inherit;
}

.status-toggle:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
  border-radius: var(--radius-xs);
}

.caret {
  display: inline-block;
  font-size: var(--text-xs);
  color: var(--color-muted);
  transition: transform var(--dur-micro) var(--ease-out);
}

.caret.open {
  transform: rotate(90deg);
}

.affected {
  font-size: var(--text-xs);
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.nav-chip a {
  font-size: var(--text-xs);
}

.detail-row > td {
  padding: var(--space-sm) var(--space-md);
  background: var(--color-paper-3);
}

.agent-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.agent-line {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding-bottom: var(--space-xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.agent-line:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.agent-head {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  flex-wrap: wrap;
}

.agent-name {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
  color: var(--color-ink-2);
}

.dot-inline {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-inline.on {
  background: var(--color-success);
}

.dot-inline.off {
  background: var(--color-neutral);
}

.agent-link,
.fault-link {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  font-size: var(--text-xs);
  margin-left: auto;
}

.agent-link:focus-visible,
.fault-link:focus-visible,
.group-head .link-btn:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
  border-radius: var(--radius-xs);
}

.agent-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs) var(--space-sm);
  font-size: var(--text-xs);
  color: var(--color-muted);
}

.fault-line {
  display: flex;
  align-items: baseline;
  gap: var(--space-2xs);
  flex-wrap: wrap;
  font-size: var(--text-xs);
}

.fault-title {
  color: var(--color-ink-2);
  font-weight: 600;
}

.fault-meta {
  color: var(--color-muted);
}

.pad {
  padding: var(--space-2xs) var(--space-3xs);
}

.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.dot.on {
  background: var(--color-success);
}

.dot.off {
  background: var(--color-neutral);
}

.group-empty {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--text-sm);
}

.panel-body {
  padding: var(--space-sm) var(--space-md);
}

@media (max-width: 768px) {
  .page-head {
    align-items: stretch;
  }

  .page-head .spacer {
    display: none;
  }

  .page-head > .btn {
    flex: 1 1 160px;
    justify-content: center;
  }

  .group-head {
    align-items: center;
  }

  .add-in-group {
    margin-left: 0;
  }
}

@media (max-width: 414px) {
  .page-head > .btn {
    flex-basis: 100%;
  }

  .group-head h3 {
    flex-basis: 100%;
  }

  .group-head .add-in-group {
    margin-left: 0;
  }

  .group-facts {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .agent-link,
  .fault-link {
    width: 100%;
    margin-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .caret {
    transition-duration: var(--dur-micro);
  }
}
</style>
