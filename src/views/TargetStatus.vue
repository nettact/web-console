<script setup lang="ts">
// Monitoring Target Status. Two dimensions, chosen by a segmented control:
//  • By agent  — an overview grid of one agent's probe targets; click a card to
//    drill into the full single-target detail.
//  • By target — the same target compared across every agent that probes it.
// All agents' probe series are fetched once on mount and drive the selectors,
// the grid, and the "who probes X" lookup. View/agent/target are mirrored to
// the query string so refresh and back work. (Interface state lives on the Host
// Metrics page — it's the host's own hardware, not a user-created monitor.)
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type SeriesInfo, type MonitorStatusRow } from '../api'
import RangePicker from '../components/RangePicker.vue'
import AgentTargetsGrid from '../components/status/AgentTargetsGrid.vue'
import TargetDetail from '../components/status/TargetDetail.vue'
import TargetAcrossAgents from '../components/status/TargetAcrossAgents.vue'
import { useMetricMeta } from '../composables/useMetricMeta'
import { HIDDEN_KINDS, familyOf, isTargetStatusKind } from '../lib/metricMeta'
import { groupLabel, groupTargets, type Prober, type TargetGroup } from '../lib/targetGroups'

const SITE = 'site_default'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { familyLabel } = useMetricMeta()

const agents = ref<Agent[]>([])
const seriesByAgent = ref<Map<string, SeriesInfo[]>>(new Map())
// Per-agent monitor_status rows (permission/target/unsupported blocks). A blocked
// monitor emits NO series, so this is the only source of its existence and state;
// it is merged into the target universe so blocked/no-series monitors are visible.
const statusByAgent = ref<Map<string, MonitorStatusRow[]>>(new Map())
// monitor_id -> the monitor's user-given display name (from the target config).
const monitorNames = ref<Map<string, string>>(new Map())
const error = ref('')
const ready = ref(false)

const view = ref<'agent' | 'target'>('agent')
const agentId = ref('')
const targetKey = ref('') // agent view: drilldown target; target view: selected target
const rangeSec = ref(6 * 3600)

// An agent is worth listing if it records probe/interface series OR has any
// assigned monitor status (a permission/target-blocked monitor produces no series
// but must still appear so its block is visible and issue deep links land).
const agentsWithTargets = computed(() =>
  agents.value.filter(
    (a) => (seriesByAgent.value.get(a.id)?.length ?? 0) > 0 || (statusByAgent.value.get(a.id)?.length ?? 0) > 0,
  ),
)

// Build the by-agent target groups: the series-derived groups, plus a synthetic
// group for each assigned probe monitor that has a status row but emitted no
// series (a blocked/never-run monitor). Host anchors are shown on the Monitoring
// page, not here (this page owns probe.* targets).
function buildGroups(id: string): TargetGroup[] {
  const groups = groupTargets(seriesByAgent.value.get(id) ?? [], familyLabel, monitorNames.value)
  const have = new Set(groups.map((g) => g.key))
  for (const row of statusByAgent.value.get(id) ?? []) {
    if (row.kind === 'host') continue
    const key = `mon:${row.monitor_id}`
    if (have.has(key)) continue
    have.add(key)
    groups.push({
      key,
      family: `probe.${row.kind}`,
      familyLabel: familyLabel(`probe.${row.kind}.ok`),
      target: row.target || '',
      monitorId: row.monitor_id,
      name: row.monitor_name || monitorNames.value.get(row.monitor_id) || undefined,
      metrics: [],
    })
  }
  return groups.sort(
    (a, b) => a.familyLabel.localeCompare(b.familyLabel) || (a.name || a.target).localeCompare(b.name || b.target),
  )
}

const agentGroups = computed(() => buildGroups(agentId.value))
// Only groups that actually recorded metrics can be drilled into (a blocked
// no-series monitor has nothing to chart); a deep link to one instead highlights
// its card in the grid.
const detailGroup = computed(() => agentGroups.value.find((g) => g.key === targetKey.value && g.metrics.length) || null)

// Non-active operational status per monitor for the selected agent (drives the
// blocked badges in the grid), and whether that agent is offline.
const blockedByMonitor = computed<Record<string, MonitorStatusRow>>(() => {
  const m: Record<string, MonitorStatusRow> = {}
  for (const row of statusByAgent.value.get(agentId.value) ?? []) {
    if (row.status !== 'active') m[row.monitor_id] = row
  }
  return m
})
const selectedAgentOffline = computed(() => {
  const a = agents.value.find((x) => x.id === agentId.value)
  return !!a && a.status !== 'online'
})

// Union of every monitor / system target across all agents (for the by-target
// selector) — including blocked monitors that emitted no series.
const allTargetGroups = computed<TargetGroup[]>(() => {
  const m = new Map<string, TargetGroup>()
  for (const a of agents.value) {
    for (const g of buildGroups(a.id)) {
      const ex = m.get(g.key)
      if (!ex) m.set(g.key, { ...g, metrics: [...g.metrics] })
      else for (const s of g.metrics) if (!ex.metrics.some((x) => x.kind === s.kind)) ex.metrics.push(s)
    }
  }
  return [...m.values()].sort(
    (a, b) => a.familyLabel.localeCompare(b.familyLabel) || groupLabel(a).localeCompare(groupLabel(b)),
  )
})

const targetOptgroups = computed(() => {
  const m = new Map<string, TargetGroup[]>()
  for (const g of allTargetGroups.value) {
    if (!m.has(g.familyLabel)) m.set(g.familyLabel, [])
    m.get(g.familyLabel)!.push(g)
  }
  return [...m.entries()].map(([label, items]) => ({ label, items }))
})

const selectedTargetGroup = computed(() => allTargetGroups.value.find((g) => g.key === targetKey.value) || null)

// Agents whose series belong to the selected group: matched by monitor_id for
// user-created monitors (exact — a same-target monitor on another agent is a
// different monitor), by (family, target) for system series. Agents that have the
// monitor assigned but produce no series (blocked) are included with empty series
// so their operational state still shows in the cross-agent summary.
const probers = computed<Prober[]>(() => {
  const g = selectedTargetGroup.value
  if (!g) return []
  const out: Prober[] = []
  for (const a of agents.value) {
    const series = (seriesByAgent.value.get(a.id) ?? []).filter((s) =>
      g.monitorId ? s.monitor_id === g.monitorId : !s.monitor_id && familyOf(s.kind) === g.family && s.target === g.target,
    )
    const hasStatus = g.monitorId
      ? (statusByAgent.value.get(a.id) ?? []).some((r) => r.monitor_id === g.monitorId)
      : false
    if (series.length || hasStatus) out.push({ agent: a, series })
  }
  return out
})

// Non-active per-agent operational status for the selected target (by monitor_id),
// plus the set of offline agent ids — composed into the cross-agent summary so a
// blocked or offline agent is distinguished from an actually-failing one.
const targetOpStatus = computed<Record<string, MonitorStatusRow>>(() => {
  const g = selectedTargetGroup.value
  const m: Record<string, MonitorStatusRow> = {}
  if (!g?.monitorId) return m
  for (const a of agents.value) {
    const row = (statusByAgent.value.get(a.id) ?? []).find((r) => r.monitor_id === g.monitorId && r.status !== 'active')
    if (row) m[a.id] = row
  }
  return m
})
const offlineIds = computed<string[]>(() => agents.value.filter((a) => a.status !== 'online').map((a) => a.id))

function setView(v: 'agent' | 'target') {
  if (view.value === v) return
  view.value = v
  targetKey.value = v === 'target' ? (allTargetGroups.value[0]?.key ?? '') : ''
}
function onAgentChange() {
  targetKey.value = '' // leave any drilldown when switching agents
}
function selectTarget(g: TargetGroup) {
  targetKey.value = g.key
}
function backToGrid() {
  targetKey.value = ''
}

async function loadAll() {
  try {
    // Monitor names come from the target config; series only carry the id.
    const [agentList, targets] = await Promise.all([
      api.agents(),
      api.listTargets(SITE).catch(() => []),
    ])
    agents.value = agentList
    const names = new Map<string, string>()
    for (const pt of targets) if (pt.id && pt.name) names.set(pt.id, pt.name)
    monitorNames.value = names
    const lists = await Promise.all(
      agents.value.map((a) =>
        api
          .listSeries(a.id)
          .then((ser) => [a.id, ser.filter((s) => !HIDDEN_KINDS.has(s.kind) && isTargetStatusKind(s.kind))] as [string, SeriesInfo[]])
          .catch(() => [a.id, []] as [string, SeriesInfo[]]),
      ),
    )
    seriesByAgent.value = new Map(lists)
    // Load each agent's monitor_status so blocked/no-series monitors are visible
    // and per-agent operational state can be composed.
    const statusLists = await Promise.all(
      agents.value.map((a) =>
        api
          .agentMonitorStatus(a.id)
          .then((rows) => [a.id, rows] as [string, MonitorStatusRow[]])
          .catch(() => [a.id, []] as [string, MonitorStatusRow[]]),
      ),
    )
    statusByAgent.value = new Map(statusLists)
    hydrateFromQuery()
    ready.value = true
  } catch (e) {
    error.value = String((e as Error).message || e)
    ready.value = true
  }
}

// Restore state from the query string, falling back to sensible defaults.
function hydrateFromQuery() {
  const q = route.query
  view.value = q.view === 'target' ? 'target' : 'agent'
  if (view.value === 'agent') {
    const wanted = typeof q.agent === 'string' ? q.agent : ''
    agentId.value = agentsWithTargets.value.some((a) => a.id === wanted) ? wanted : agentsWithTargets.value[0]?.id ?? ''
    targetKey.value = typeof q.target === 'string' && agentGroups.value.some((g) => g.key === q.target) ? q.target : ''
  } else {
    const wanted = typeof q.target === 'string' ? q.target : ''
    targetKey.value = allTargetGroups.value.some((g) => g.key === wanted) ? wanted : allTargetGroups.value[0]?.key ?? ''
  }
}

// Mirror state into the query (replace, so it doesn't stack history entries).
watch([view, agentId, targetKey], () => {
  if (!ready.value) return
  const q: Record<string, string> = { view: view.value }
  if (view.value === 'agent') {
    if (agentId.value) q.agent = agentId.value
    if (targetKey.value) q.target = targetKey.value
  } else if (targetKey.value) q.target = targetKey.value
  router.replace({ query: q })
})

onMounted(loadAll)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ t('targetStatus.title') }}</h2>
      <p class="sub">{{ t('targetStatus.sub') }}</p>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="ready && !agentsWithTargets.length" class="card empty">
      <h3>{{ t('common.noAgents') }}</h3>
      <p class="hint">{{ t('targetStatus.noAgentHint') }}</p>
    </div>

    <template v-else-if="ready">
      <div class="card toolbar">
        <div class="fg">
          <span>&nbsp;</span>
          <div class="segmented">
            <button :class="{ active: view === 'agent' }" @click="setView('agent')">{{ t('targetStatus.viewByAgent') }}</button>
            <button :class="{ active: view === 'target' }" @click="setView('target')">{{ t('targetStatus.viewByTarget') }}</button>
          </div>
        </div>

        <label class="fg grow" v-if="view === 'agent'">
          <span>{{ t('targetStatus.agentLabel') }}</span>
          <select v-model="agentId" @change="onAgentChange">
            <option v-for="a in agentsWithTargets" :key="a.id" :value="a.id">{{ a.hostname || a.id }} ({{ a.platform }})</option>
          </select>
        </label>

        <label class="fg grow" v-else>
          <span>{{ t('targetStatus.targetLabel') }}</span>
          <select v-model="targetKey" :disabled="!allTargetGroups.length">
            <optgroup v-for="og in targetOptgroups" :key="og.label" :label="og.label">
              <option v-for="g in og.items" :key="g.key" :value="g.key">
                {{ groupLabel(g) || t('metrics.localTarget') }}<template v-if="g.name && g.target"> · {{ g.target }}</template>
              </option>
            </optgroup>
          </select>
        </label>

        <div class="fg">
          <span>{{ t('metrics.timeRange') }}</span>
          <RangePicker v-model="rangeSec" />
        </div>
      </div>

      <!-- By agent: overview grid, or single-monitor drilldown -->
      <template v-if="view === 'agent'">
        <TargetDetail
          v-if="detailGroup"
          :agent-id="agentId"
          :family-label="detailGroup.familyLabel"
          :target="detailGroup.target"
          :monitor-id="detailGroup.monitorId"
          :name="detailGroup.name"
          :metrics="detailGroup.metrics"
          :range-sec="rangeSec"
          show-back
          @back="backToGrid"
        />
        <AgentTargetsGrid
          v-else
          :agent-id="agentId"
          :groups="agentGroups"
          :range-sec="rangeSec"
          :blocked="blockedByMonitor"
          :offline="selectedAgentOffline"
          :highlight-key="targetKey"
          @select="selectTarget"
        />
      </template>

      <!-- By target: cross-agent comparison -->
      <template v-else>
        <p v-if="!allTargetGroups.length" class="hint pad">{{ t('targetStatus.noTargetsGlobal') }}</p>
        <TargetAcrossAgents
          v-else-if="selectedTargetGroup"
          :key="selectedTargetGroup.key"
          :family="selectedTargetGroup.family"
          :family-label="selectedTargetGroup.familyLabel"
          :target="selectedTargetGroup.target"
          :monitor-id="selectedTargetGroup.monitorId"
          :name="selectedTargetGroup.name"
          :probers="probers"
          :op-status="targetOpStatus"
          :offline-ids="offlineIds"
          :range-sec="rangeSec"
        />
      </template>
    </template>
  </main>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 18px;
  margin-bottom: 20px;
}
.fg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fg > span {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.fg.grow {
  flex: 1;
  min-width: 220px;
}
.fg.grow select {
  width: 100%;
}
.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--input-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.segmented button {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.segmented button:hover {
  color: var(--text);
}
.segmented button.active {
  color: #04121c;
  background: linear-gradient(180deg, #59c7fb, var(--primary-strong));
  font-weight: 600;
}
.empty {
  text-align: center;
  padding: 48px 20px;
}
.pad {
  padding: 8px 2px;
}
</style>
