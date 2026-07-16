<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  api,
  type Agent,
  type AgentGroup,
  type MonitorGroup,
  type MonitorStatusRow,
  type ProbeTarget,
  type Sample,
} from '../api'
import MonitorStateBadge, { type MonitorState } from '../components/status/MonitorStateBadge.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { familyOf, statusSource } from '../lib/metricMeta'
import { typeLabel, targetLabel } from '../lib/targetLabels'

const { t: tr } = useI18n()

const SITE = 'site_default'
const groups = ref<MonitorGroup[]>([])
const targets = ref<ProbeTarget[]>([])
const agentGroups = ref<AgentGroup[]>([])
const agents = ref<Agent[]>([])
const error = ref('')
const busy = ref(false)
// Per-monitor agent status rows (permission/target/unsupported blocks). Blocked
// monitors emit no metric, so this is the only place their state is visible.
const statusByMonitor = ref<Map<string, MonitorStatusRow[]>>(new Map())
// agent_id -> monitor_id -> latest up/down derived from the monitor's status series.
const upByAgent = ref<Map<string, Map<string, boolean>>>(new Map())

async function load() {
  try {
    ;[groups.value, targets.value, agentGroups.value, agents.value] = await Promise.all([
      api.monitorGroups(SITE),
      api.listTargets(SITE),
      api.agentGroups(SITE),
      api.agents().catch(() => [] as Agent[]),
    ])
    targets.value.forEach((t) => {
      if (!t.params) t.params = {}
    })
    await Promise.all([loadStatuses(), loadLatest()])
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

async function loadStatuses() {
  const ids = targets.value.map((t) => t.id).filter((id): id is string => !!id)
  const pairs = await Promise.all(
    ids.map((id) =>
      api
        .targetAgentStatus(id)
        .then((rows) => [id, rows] as [string, MonitorStatusRow[]])
        .catch(() => [id, [] as MonitorStatusRow[]] as [string, MonitorStatusRow[]]),
    ),
  )
  statusByMonitor.value = new Map(pairs)
}

async function loadLatest() {
  const pairs = await Promise.all(
    agents.value.map((a) =>
      api
        .latest(a.id)
        .then((samples) => [a.id, samples] as [string, Sample[]])
        .catch(() => [a.id, [] as Sample[]] as [string, Sample[]]),
    ),
  )
  const m = new Map<string, Map<string, boolean>>()
  for (const [id, samples] of pairs) {
    const per = new Map<string, boolean>()
    for (const s of samples) {
      if (!s.monitor_id) continue
      const src = statusSource(familyOf(s.kind))
      if (!src || src.kind !== s.kind) continue
      per.set(s.monitor_id, src.toUp(s.value) >= 0.5)
    }
    m.set(id, per)
  }
  upByAgent.value = m
}

// Composed per-row state chips: for each agent assigned the monitor, a non-active
// operational status wins; an active agent falls back to its latest status metric.
// agent_offline is counted independently and rendered as an extra chip.
const CHIP_ORDER: MonitorState[] = ['permission_blocked', 'unsupported', 'target_blocked', 'probe_failed', 'active']
interface RowChips {
  chips: { state: MonitorState; count: number; agents: string[] }[]
  offline: string[]
}
const rowStatusById = computed<Map<string, RowChips>>(() => {
  const out = new Map<string, RowChips>()
  for (const t of targets.value) {
    if (!t.id) continue
    const rows = statusByMonitor.value.get(t.id) || []
    if (!rows.length) continue
    const byState = new Map<MonitorState, string[]>()
    const offline: string[] = []
    for (const r of rows) {
      const name = r.agent_name || r.agent_id
      const a = agents.value.find((x) => x.id === r.agent_id)
      if (a && a.status !== 'online') offline.push(name)
      let state: MonitorState
      if (r.status !== 'active') state = r.status
      else if (t.kind !== 'host' && upByAgent.value.get(r.agent_id)?.get(t.id) === false) state = 'probe_failed'
      else state = 'active'
      if (!byState.has(state)) byState.set(state, [])
      byState.get(state)!.push(name)
    }
    out.set(t.id, {
      chips: CHIP_ORDER.filter((s) => byState.has(s)).map((s) => ({
        state: s,
        count: byState.get(s)!.length,
        agents: byState.get(s)!,
      })),
      offline,
    })
  }
  return out
})

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
            <tr v-for="t in targetsOf(g)" :key="t.id">
              <td>{{ t.name || tr('monitoring.unnamed') }}</td>
              <td>{{ typeLabel(t, tr) }}</td>
              <td class="mono">
                {{ targetLabel(t, tr) }}<span v-if="t.kind === 'tcp' && t.params?.port">:{{ t.params.port }}</span>
              </td>
              <td class="status">
                <template v-if="t.id && rowStatusById.get(t.id)">
                  <span
                    v-for="c in rowStatusById.get(t.id)!.chips"
                    :key="c.state"
                    class="chip"
                    :title="c.agents.join(', ')"
                  >
                    <MonitorStateBadge :state="c.state" />
                    <span v-if="c.count > 1" class="blk-count">×{{ c.count }}</span>
                  </span>
                  <span
                    v-if="rowStatusById.get(t.id)!.offline.length"
                    class="chip"
                    :title="rowStatusById.get(t.id)!.offline.join(', ')"
                  >
                    <span class="pill offline">{{ tr('monitorState.agent_offline') }}</span>
                    <span v-if="rowStatusById.get(t.id)!.offline.length > 1" class="blk-count"
                      >×{{ rowStatusById.get(t.id)!.offline.length }}</span
                    >
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
  gap: 6px;
  flex-wrap: wrap;
}
.status .dim {
  color: var(--text-muted);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.pill {
  font-size: 12px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--text-dim);
  white-space: nowrap;
}
.pill.offline {
  border-style: dashed;
}
.blk-count {
  font-size: 11.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
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
