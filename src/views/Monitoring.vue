<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type AgentGroup, type MonitorStatusRow, type ProbeTarget, type Sample } from '../api'
import MonitorStateBadge, { type MonitorState } from '../components/status/MonitorStateBadge.vue'
import { familyOf, statusSource } from '../lib/metricMeta'

const { t: tr } = useI18n()

const SITE = 'site_default'
const targets = ref<ProbeTarget[]>([])
const groups = ref<AgentGroup[]>([])
const agents = ref<Agent[]>([])
const error = ref('')
const busy = ref(false)
// Per-monitor agent status rows (permission/target/unsupported blocks). Blocked
// monitors emit no metric, so this is the only place their state is visible.
const statusByMonitor = ref<Map<string, MonitorStatusRow[]>>(new Map())
// agent_id -> monitor_id -> latest up/down derived from the monitor's status
// series. Actual probe_failed must come from a real metric, so each agent's
// cheap latest-value list is reduced to its per-monitor status-source sample.
const upByAgent = ref<Map<string, Map<string, boolean>>>(new Map())

async function load() {
  try {
    ;[targets.value, groups.value, agents.value] = await Promise.all([
      api.listTargets(SITE),
      api.agentGroups(SITE),
      api.agents().catch(() => [] as Agent[]),
    ])
    await Promise.all([loadStatuses(), loadLatest()])
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// Fetch each monitor's per-agent status so a row can show whether some agents are
// permission/target-blocked or unsupported (states that never produce a metric).
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
// operational status wins; an active agent falls back to its latest status metric
// (down ⇒ probe_failed, up or no data yet ⇒ active). agent_offline is counted
// independently and rendered as an extra chip, never replacing a block or failure
// (offline must not erase a permission issue). Host anchors have no probe series;
// their active state stands as-is (rules alert on their host metrics instead).
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

// Scope column: broadcast targets show "all agents"; group-scoped targets list
// their group names (applies to probes' downlink and host alerts alike).
function scopeLabel(t: ProbeTarget): string {
  if (t.all_agents) return tr('monitoring.scopeAll')
  const names = (t.group_ids || []).map((id) => groups.value.find((g) => g.id === id)?.name).filter(Boolean)
  return names.length ? names.join(', ') : tr('monitoring.scopeNone')
}

// Human label for a target's type, folding the http keyword variant into its own
// name (mirrors the form's type dropdown).
function typeLabel(t: ProbeTarget): string {
  if (t.kind === 'icmp') return tr('mform.typeIcmp')
  if (t.kind === 'tcp') return tr('mform.typeTcp')
  if (t.kind === 'dns') return tr('mform.typeDns')
  if (t.kind === 'nat') return tr('mform.typeNat')
  if (t.kind === 'gateway') return tr('mform.typeGateway')
  if (t.kind === 'host') return tr('mform.typeHost')
  if (t.kind === 'http') return tr('mform.typeHttp')
  return t.kind.toUpperCase()
}

// Host anchors carry a metric-series string as their target ("host" for the
// whole machine, "*" for all wireless adapters, a mount point for disk); show the
// whole-machine and Wi-Fi anchors as readable labels rather than raw strings.
function targetLabel(t: ProbeTarget): string {
  if (t.kind === 'host' && t.target === 'host') return tr('monitoring.hostWhole')
  if (t.kind === 'host' && t.target === '*') return tr('monitoring.hostWifi')
  // Gateway targets carry no user IP; show the chosen NIC, or "default gateway".
  if (t.kind === 'gateway') return t.params?.interface || tr('monitoring.gatewayDefault')
  return t.target
}

async function removeTarget(t: ProbeTarget) {
  if (!t.id) return
  if (!confirm(tr('common.delete') + ' ' + (t.name || t.target) + ' ?')) return
  busy.value = true
  error.value = ''
  try {
    const rest = targets.value.filter((x) => x.id && x.id !== t.id)
    await api.setTargets(SITE, rest)
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// History purge is per monitor: pick a monitor from the list and clear exactly
// its series — a sibling monitor sharing the same target string is untouched.
// The free-text form remains for SYSTEM series only (e.g. a removed interface's
// iface.up history), which no monitor owns.
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
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ tr('monitoring.probeTargets') }}</h3>
        <span class="count">{{ targets.length }}</span>
        <router-link to="/monitoring/new-host" class="btn head-btn">{{ tr('monitoring.newHostMonitor') }}</router-link>
        <router-link to="/monitoring/new" class="btn btn-primary">{{ tr('monitoring.newMonitor') }}</router-link>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ tr('monitoring.thName') }}</th>
              <th>{{ tr('monitoring.thType') }}</th>
              <th>{{ tr('monitoring.thTarget') }}</th>
              <th>{{ tr('monitoring.thScope') }}</th>
              <th>{{ tr('monitoring.thStatus') }}</th>
              <th class="center">{{ tr('monitoring.thEnabled') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in targets" :key="t.id">
              <td>{{ t.name || tr('monitoring.unnamed') }}</td>
              <td>{{ typeLabel(t) }}</td>
              <td class="mono">{{ targetLabel(t) }}<span v-if="t.kind === 'tcp' && t.params?.port">:{{ t.params.port }}</span></td>
              <td class="scope">{{ scopeLabel(t) }}</td>
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
                    <span v-if="rowStatusById.get(t.id)!.offline.length > 1" class="blk-count">×{{ rowStatusById.get(t.id)!.offline.length }}</span>
                  </span>
                </template>
                <span v-else class="dim">—</span>
              </td>
              <td class="center"><span :class="['dot', t.enabled ? 'on' : 'off']"></span></td>
              <td class="actions">
                <router-link :to="`/monitoring/${t.id}/edit`" class="link-btn">{{ tr('monitoring.editMonitor') }}</router-link>
                <button class="link-btn danger" :disabled="busy" @click="removeTarget(t)">{{ tr('common.delete') }}</button>
              </td>
            </tr>
            <tr v-if="!targets.length"><td colspan="7" class="hint">{{ tr('monitoring.noTargets') }}</td></tr>
          </tbody>
        </table>
      </div>
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
              {{ t.name || tr('monitoring.unnamed') }} · {{ targetLabel(t) }}
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
  </main>
</template>

<style scoped>
.page { max-width: 960px; }
.panel { margin-bottom: 20px; }
.table-wrap { overflow-x: auto; }
.count {
  min-width: 22px; padding: 1px 9px; border-radius: var(--radius-pill);
  font-size: 12px; font-weight: 600; color: var(--text-dim);
  background: var(--surface-2); border: 1px solid var(--border); text-align: center;
}
.head-btn { margin-left: auto; margin-right: 8px; }
.mono { font-family: var(--font-mono, monospace); font-size: 12.5px; }
.scope { font-size: 12.5px; color: var(--text-dim); }
.status { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.status .dim { color: var(--text-muted); }
.chip { display: inline-flex; align-items: center; gap: 3px; }
.pill {
  font-size: 12px; padding: 2px 9px; border-radius: 999px;
  border: 1px solid var(--border-strong); color: var(--text-dim); white-space: nowrap;
}
.pill.offline { border-style: dashed; }
.blk-count { font-size: 11.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.actions { display: flex; gap: 10px; justify-content: flex-end; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
.dot.on { background: var(--ok, #34d399); }
.dot.off { background: var(--border); }
.purge-in { min-width: 280px; flex: 1; }
.sys-hint { margin-top: 14px; }
.panel-body { padding: 14px 18px; }
.danger-zone { border-color: rgba(248, 113, 113, 0.28); }
.tag-danger {
  margin-left: auto; padding: 2px 10px; border-radius: var(--radius-pill);
  font-size: 11.5px; font-weight: 600; color: var(--danger);
  background: var(--danger-soft); border: 1px solid rgba(248, 113, 113, 0.3);
}
</style>
