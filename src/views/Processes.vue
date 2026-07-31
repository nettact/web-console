<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  api,
  type Agent,
  type ProcessInfo,
  type ConnectionInfo,
  type HostSnapshot,
  type SnapshotScopeResult,
  type Remediation,
} from '../api'
import { fmtBytes } from '../lib/format'
import { agentLabel } from '../lib/agentLabel'
import { quickAddQuery } from '../lib/netaddr'
import {
  hasProcessScopes,
  hasConnectionScopes,
} from '../lib/permissions'
import { usePermissionMeta } from '../composables/usePermissionMeta'

const { t } = useI18n()
const { permLabel } = usePermissionMeta()

// This page shows a live, on-demand snapshot of an agent's processes and network
// connections. Nothing is stored server-side: opening the page asks the agent to
// return its current lists once, and the result is held only in memory. Which
// columns appear depends on which permission SCOPES the agent actually collected;
// scopes it could not collect surface in a denial panel.
const route = useRoute()
const agents = ref<Agent[]>([])
const selected = ref<string>('')
const agent = ref<Agent | null>(null)
const snapshot = ref<HostSnapshot | null>(null)
const loading = ref(false)
const error = ref('')
// Scopes the agent could not collect this round (denied / unsupported / failed),
// plus any remediation guidance returned with an inline denial.
const denialScopes = ref<SnapshotScopeResult[]>([])
const remediation = ref<Remediation | null>(null)
const sortKey = ref<'cpu' | 'ram' | 'name'>('cpu')
const tab = ref<'processes' | 'connections'>('processes')
type ConnBasis = 'name' | 'pid'
type ConnFilter =
  | { basis: 'name'; name: string }
  | { basis: 'pid'; pid: number; name: string }
const connBasis = ref<ConnBasis>('name')
const connFilter = ref<ConnFilter | null>(null)
let poll: number | undefined

// Every process/connection snapshot scope. The page always requests the full
// desired set — not just the agent's effective scopes — so the response carries
// explicit denied/unsupported results (and the NETTACT_AGENT_PERMISSIONS
// remediation line) for every scope the agent cannot collect. This covers the
// common least-privilege case where an agent grants some but not all scopes: the
// missing scopes must surface in the denial panel, never be silently omitted.
const ALL_SNAPSHOT_SCOPES = [
  'host.process.basic.read',
  'host.process.owner.read',
  'host.process.resource.read',
  'host.process.io.read',
  'host.connection.summary.read',
  'host.connection.local.read',
  'host.connection.remote.read',
  'host.connection.owner.read',
]

const effective = computed(() => agent.value?.effective ?? [])
const canProcs = computed(() => hasProcessScopes(effective.value))
const canConns = computed(() => hasConnectionScopes(effective.value))
const permitted = computed(() => canProcs.value || canConns.value)

// Which permission scopes actually came back with data this round; drives the
// dynamic columns (a granted-but-uncollected scope shows in the denial panel).
const collectedSet = computed(() => {
  const s = new Set<string>()
  for (const sc of snapshot.value?.scopes ?? []) if (sc.status === 'collected') s.add(sc.scope)
  return s
})
const colBasic = computed(() => collectedSet.value.has('host.process.basic.read'))
const colOwner = computed(() => collectedSet.value.has('host.process.owner.read'))
const colResource = computed(() => collectedSet.value.has('host.process.resource.read'))
const colIo = computed(() => collectedSet.value.has('host.process.io.read'))
const colSummary = computed(() => collectedSet.value.has('host.connection.summary.read'))
const colLocal = computed(() => collectedSet.value.has('host.connection.local.read'))
const colRemote = computed(() => collectedSet.value.has('host.connection.remote.read'))
const colConnOwner = computed(() => collectedSet.value.has('host.connection.owner.read'))

const procCols = computed(
  () =>
    (colBasic.value ? 3 : 0) +
    (colOwner.value ? 1 : 0) +
    (colResource.value ? 4 : 0) +
    (colIo.value ? 1 : 0) +
    (colConnOwner.value ? 1 : 0),
)
const connCols = computed(
  () =>
    (colSummary.value ? 2 : 0) +
    (colLocal.value ? 1 : 0) +
    (colRemote.value ? 2 : 0) +
    (colConnOwner.value ? 2 : 0),
)

// Keep the active tab valid for the selected agent's effective scopes.
watch(
  [canProcs, canConns],
  () => {
    if (tab.value === 'processes' && !canProcs.value && canConns.value) tab.value = 'connections'
    else if (tab.value === 'connections' && !canConns.value && canProcs.value) tab.value = 'processes'
  },
  { immediate: true },
)

async function loadAgents() {
  try {
    agents.value = await api.agents()
    const q = String(route.query.agent || '')
    if (q && agents.value.some((a) => a.id === q)) selected.value = q
    else if (!selected.value && agents.value.length) selected.value = agents.value[0].id
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

async function refreshAgent() {
  if (!selected.value) return
  try {
    agent.value = await api.agent(selected.value)
  } catch {
    agent.value = null
  }
}

// The snapshot POST is rejected immediately with `{"error":"agent offline"}`
// (HTTP 409) when the agent has no live connection — surface a localized message.
function snapshotErrMsg(e: unknown): string {
  const msg = String((e as Error).message || e)
  return msg === 'agent offline' ? t('processes.agentOffline') : msg
}

// Ask the agent for a fresh snapshot of the scopes it can serve, then poll briefly
// until it answers. A POST may return an INLINE DENIAL (request_id null) when none
// of the requested scopes was effective — handle that without polling.
async function requestSnapshot() {
  stopPoll()
  loading.value = false
  denialScopes.value = []
  remediation.value = null
  if (!selected.value) {
    snapshot.value = null
    return
  }
  // Always request the full desired scope set (not just the effective scopes) so
  // the response includes explicit denied/unsupported results and the remediation
  // env line for every scope the agent cannot collect — both when it grants none
  // and, crucially, when it grants only a partial subset.
  const scopes = ALL_SNAPSHOT_SCOPES
  if (!scopes.length) {
    snapshot.value = null
    return
  }
  loading.value = true
  error.value = ''
  snapshot.value = null
  try {
    const res = await api.requestSnapshot(selected.value, scopes)
    if (res.request_id === null) {
      denialScopes.value = (res.scopes || []).filter((s) => s.status !== 'collected')
      remediation.value = res.remediation ?? null
      loading.value = false
      return
    }
    const request_id = res.request_id
    let tries = 0
    poll = window.setInterval(async () => {
      tries++
      try {
        const r = await api.getSnapshot(selected.value)
        if (r.snapshot && r.snapshot.request_id === request_id) {
          snapshot.value = r.snapshot
          denialScopes.value = r.snapshot.scopes.filter((s) => s.status !== 'collected')
          // The GET response carries remediation for any permission-denied scope, so
          // partial runtime denials show the env line too (not only the POST path).
          remediation.value = r.remediation ?? null
          revalidateConnFilter()
          loading.value = false
          stopPoll()
        } else if (tries > 25) {
          // A short poll only: the agent simply hasn't answered yet (not a denial).
          loading.value = false
          error.value = t('processes.waitTimeout')
          stopPoll()
        }
      } catch (e) {
        error.value = snapshotErrMsg(e)
        loading.value = false
        stopPoll()
      }
    }, 1000)
  } catch (e) {
    error.value = snapshotErrMsg(e)
    loading.value = false
  }
}

function stopPoll() {
  if (poll) {
    clearInterval(poll)
    poll = undefined
  }
}

const processes = computed<ProcessInfo[]>(() => {
  const ps = [...(snapshot.value?.processes || [])]
  ps.sort((a, b) => {
    if (sortKey.value === 'name') return a.name.localeCompare(b.name)
    if (sortKey.value === 'ram') return (b.rss_bytes ?? 0) - (a.rss_bytes ?? 0)
    return (b.cpu_pct ?? 0) - (a.cpu_pct ?? 0)
  })
  return ps
})
const connections = computed<ConnectionInfo[]>(() => snapshot.value?.connections || [])

const filteredConnections = computed<ConnectionInfo[]>(() => {
  const cs = connections.value
  const f = connFilter.value
  if (!f) return cs
  if (f.basis === 'name') return cs.filter((c) => c.process_name === f.name)
  return cs.filter((c) => c.pid === f.pid)
})

const connNameOptions = computed<string[]>(() => {
  const seen = new Set<string>()
  for (const p of snapshot.value?.processes || []) if (p.name) seen.add(p.name)
  for (const c of connections.value) if (c.process_name) seen.add(c.process_name)
  const f = connFilter.value
  if (connBasis.value === 'name' && f && f.basis === 'name' && f.name) seen.add(f.name)
  return [...seen].sort((a, b) => a.localeCompare(b))
})

const connPidOptions = computed<{ pid: number; name: string }[]>(() => {
  const opts: { pid: number; name: string }[] = []
  const seen = new Set<number>()
  for (const p of snapshot.value?.processes || []) {
    if (seen.has(p.pid)) continue
    seen.add(p.pid)
    opts.push({ pid: p.pid, name: p.name })
  }
  for (const c of connections.value) {
    if (c.pid == null || seen.has(c.pid)) continue
    seen.add(c.pid)
    opts.push({ pid: c.pid, name: c.process_name || '' })
  }
  const f = connFilter.value
  if (connBasis.value === 'pid' && f && f.basis === 'pid' && !seen.has(f.pid)) {
    opts.push({ pid: f.pid, name: f.name })
  }
  opts.sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid)
  return opts
})

const connNameValue = computed<string>({
  get: () => {
    const f = connFilter.value
    return f && f.basis === 'name' ? f.name : ''
  },
  set: (v) => {
    connFilter.value = v ? { basis: 'name', name: v } : null
  },
})

const connPidValue = computed<string>({
  get: () => {
    const f = connFilter.value
    return f && f.basis === 'pid' ? String(f.pid) : ''
  },
  set: (v) => {
    if (!v) {
      connFilter.value = null
      return
    }
    const pid = Number(v)
    const opt = connPidOptions.value.find((o) => o.pid === pid)
    connFilter.value = { basis: 'pid', pid, name: opt ? opt.name : '' }
  },
})

const connFilterEmptyMsg = computed<string>(() => {
  const f = connFilter.value
  if (!f) return ''
  if (f.basis === 'name') return t('processes.noConnsForName', { name: f.name })
  return t('processes.noConnsForProcess', { name: f.name || '—', pid: f.pid })
})

function setConnBasis(b: ConnBasis) {
  if (connBasis.value === b) return
  connBasis.value = b
  connFilter.value = null
}

function connQuickAdd(c: ConnectionInfo) {
  return quickAddQuery(c.proto, c.remote_addr)
}
function connQuickAddAria(c: ConnectionInfo): string {
  const q = connQuickAdd(c)
  if (!q) return ''
  return q.kind === 'tcp'
    ? t('processes.quickAddTcpAria', { target: q.target, port: q.port })
    : t('processes.quickAddIcmpAria', { target: q.target })
}

function viewConnections(p: ProcessInfo) {
  if (connBasis.value === 'name' && !p.name) connBasis.value = 'pid'
  if (connBasis.value === 'name') connFilter.value = { basis: 'name', name: p.name }
  else connFilter.value = { basis: 'pid', pid: p.pid, name: p.name }
  tab.value = 'connections'
}

function revalidateConnFilter() {
  const f = connFilter.value
  if (!f) return
  const procs = snapshot.value?.processes || []
  const conns = snapshot.value?.connections || []
  if (f.basis === 'name') {
    const exists =
      procs.some((p) => p.name === f.name) || conns.some((c) => c.process_name === f.name)
    if (!exists) connFilter.value = null
  } else {
    const valid =
      procs.some((p) => p.pid === f.pid && p.name === f.name) ||
      conns.some((c) => c.pid === f.pid && (c.process_name || '') === f.name)
    if (!valid) connFilter.value = null
  }
}

function fmtRun(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${h}h ${m}m ${s}s`
}

// Denial panel copy: a headline per scope keyed by why it was withheld, plus a
// remediation sub-line (env hint for permission denials, a platform explanation
// for unsupported, the server reason for a runtime failure).
function denyLine(sc: SnapshotScopeResult): string {
  const scope = permLabel(sc.scope)
  if (sc.status === 'denied') return t('processes.denyDenied', { scope })
  if (sc.status === 'unsupported') return t('processes.denyUnsupported', { scope })
  return t('processes.denyFailed', { scope })
}
function denySub(sc: SnapshotScopeResult): string {
  if (sc.status === 'denied') {
    const env = remediation.value?.permissions_env
    return env ? t('processes.remediationEnv', { env }) : ''
  }
  if (sc.status === 'unsupported') return t('processes.unsupportedExplain')
  return sc.reason || ''
}

async function onAgentChange() {
  connFilter.value = null
  await refreshAgent()
  await requestSnapshot()
}

onMounted(async () => {
  await loadAgents()
  await refreshAgent()
  await requestSnapshot()
})
onBeforeUnmount(stopPoll)
</script>

<template>
  <main class="page data-workbench" aria-labelledby="processes-title">
    <div class="page-head workbench-head">
      <div class="head-copy">
        <h2 id="processes-title">{{ t('processes.title') }}</h2>
        <p class="hint sub">{{ t('processes.sub') }}</p>
      </div>
      <span class="spacer"></span>
      <div class="picker" v-if="agents.length">
        <label>Agent</label>
        <select v-model="selected" @change="onAgentChange">
          <option v-for="a in agents" :key="a.id" :value="a.id">
            {{ agentLabel(a) }} ({{ a.platform }}) — {{ a.status }}
          </option>
        </select>
        <button class="btn" :disabled="loading" @click="requestSnapshot">
          {{ loading ? t('processes.fetching') : t('processes.refreshSnapshot') }}
        </button>
      </div>
    </div>

    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <!-- Scopes the agent could not collect this round (shown for both the
         partial-permission and the no-permission case, always with remediation). -->
    <div v-if="denialScopes.length" class="card denial">
      <h4>{{ t('processes.denialTitle') }}</h4>
      <p class="hint">{{ t('processes.denialIntro') }}</p>
      <ul class="deny-list">
        <li v-for="sc in denialScopes" :key="sc.scope">
          <span class="deny-head">{{ denyLine(sc) }}</span>
          <span v-if="denySub(sc)" class="deny-sub">{{ denySub(sc) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="!permitted && agent && !denialScopes.length" class="card empty">
      <h3>{{ t('processes.noPermTitle') }}</h3>
      <p class="hint">{{ t('processes.noPermHint') }}</p>
    </div>

    <template v-if="permitted">
      <div class="tabs workbench-tabs" role="tablist" :aria-label="t('processes.title')">
        <button
          v-if="canProcs"
          id="processes-tab-processes"
          class="tab"
          role="tab"
          :class="{ active: tab === 'processes' }"
          :aria-selected="tab === 'processes'"
          :tabindex="tab === 'processes' ? 0 : -1"
          aria-controls="processes-panel-processes"
          @click="tab = 'processes'"
        >
          {{ t('processes.tabProcesses') }}
          <span class="count">{{ snapshot?.process_total ?? processes.length }}</span>
        </button>
        <button
          v-if="canConns"
          id="processes-tab-connections"
          class="tab"
          role="tab"
          :class="{ active: tab === 'connections' }"
          :aria-selected="tab === 'connections'"
          :tabindex="tab === 'connections' ? 0 : -1"
          aria-controls="processes-panel-connections"
          @click="tab = 'connections'"
        >
          {{ t('processes.tabConnections') }}
          <span class="count">{{ connections.length }}</span>
        </button>
      </div>

      <!-- processes -->
      <section
        id="processes-panel-processes"
        class="panel table-sheet"
        v-if="canProcs"
        v-show="tab === 'processes'"
        role="tabpanel"
        aria-labelledby="processes-tab-processes"
      >
        <div class="panel-head">
          <span class="spacer"></span>
          <div class="sort" v-if="colResource">
            <label>{{ t('processes.sortLabel') }}</label>
            <select v-model="sortKey">
              <option value="cpu">CPU</option>
              <option value="ram">{{ t('processes.sortRam') }}</option>
              <option value="name">{{ t('processes.sortName') }}</option>
            </select>
          </div>
        </div>
        <div class="table-wrap" role="region" tabindex="0" :aria-label="t('processes.tabProcesses')">
          <table class="data-table">
            <thead>
              <tr>
                <th v-if="colBasic">{{ t('processes.thProcName') }}</th>
                <th v-if="colBasic">PID</th>
                <th v-if="colBasic">{{ t('processes.thStatus') }}</th>
                <th v-if="colOwner">{{ t('processes.thUser') }}</th>
                <th class="num" v-if="colResource">CPU %</th>
                <th class="num" v-if="colResource">{{ t('processes.thMem') }}</th>
                <th class="num" v-if="colResource">{{ t('processes.thVirt') }}</th>
                <th class="num" v-if="colResource">{{ t('processes.thRuntime') }}</th>
                <th class="num" v-if="colIo">{{ t('processes.thDisk') }}</th>
                <th v-if="colConnOwner"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !processes.length"><td :colspan="procCols || 1" class="hint">{{ t('processes.waitingAgent') }}</td></tr>
              <tr v-else-if="!processes.length"><td :colspan="procCols || 1" class="hint">{{ t('common.noData') }}</td></tr>
              <tr v-for="p in processes" :key="p.pid">
                <td class="mono" v-if="colBasic">{{ p.name }}</td>
                <td class="mono" v-if="colBasic">{{ p.pid }}</td>
                <td v-if="colBasic">{{ p.status || '—' }}</td>
                <td class="mono dim" v-if="colOwner">{{ p.user || '—' }}</td>
                <td class="num" v-if="colResource">{{ p.cpu_pct != null ? p.cpu_pct.toFixed(1) : '—' }}</td>
                <td class="num" v-if="colResource">{{ p.rss_bytes != null ? fmtBytes(p.rss_bytes) : '—' }}</td>
                <td class="num dim" v-if="colResource">{{ p.virt_bytes != null ? fmtBytes(p.virt_bytes) : '—' }}</td>
                <td class="num dim" v-if="colResource">{{ p.run_time_seconds != null ? fmtRun(p.run_time_seconds) : '—' }}</td>
                <td class="num dim" v-if="colIo">{{ p.disk_read_bytes != null ? fmtBytes(p.disk_read_bytes) : '—' }} / {{ p.disk_write_bytes != null ? fmtBytes(p.disk_write_bytes) : '—' }}</td>
                <td v-if="colConnOwner" class="num">
                  <button
                    class="link-btn"
                    :aria-label="t('processes.viewConnsAria', { name: p.name, pid: p.pid })"
                    @click="viewConnections(p)"
                  >
                    {{ t('processes.viewConns') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- connections -->
      <section
        id="processes-panel-connections"
        class="panel table-sheet"
        v-if="canConns"
        v-show="tab === 'connections'"
        role="tabpanel"
        aria-labelledby="processes-tab-connections"
      >
        <div class="panel-head">
          <div class="basis" v-if="colConnOwner" role="group" :aria-label="t('processes.connBasisLabel')">
            <span class="basis-label">{{ t('processes.connBasisLabel') }}</span>
            <button
              type="button"
              class="seg"
              :class="{ active: connBasis === 'name' }"
              :aria-pressed="connBasis === 'name'"
              @click="setConnBasis('name')"
            >
              {{ t('processes.connBasisName') }}
            </button>
            <button
              type="button"
              class="seg"
              :class="{ active: connBasis === 'pid' }"
              :aria-pressed="connBasis === 'pid'"
              @click="setConnBasis('pid')"
            >
              {{ t('processes.connBasisPid') }}
            </button>
          </div>
          <span class="spacer"></span>
          <div class="sort" v-if="colConnOwner">
            <label for="conn-filter">{{ t('processes.connFilterLabel') }}</label>
            <select v-if="connBasis === 'name'" id="conn-filter" v-model="connNameValue">
              <option value="">{{ t('processes.connFilterAll') }}</option>
              <option v-for="n in connNameOptions" :key="n" :value="n">{{ n }}</option>
            </select>
            <select v-else id="conn-filter" v-model="connPidValue">
              <option value="">{{ t('processes.connFilterAll') }}</option>
              <option v-for="o in connPidOptions" :key="o.pid" :value="String(o.pid)">
                {{ o.name || '—' }} ({{ o.pid }})
              </option>
            </select>
          </div>
        </div>
        <div class="table-wrap" role="region" tabindex="0" :aria-label="t('processes.tabConnections')">
          <table class="data-table">
            <thead>
              <tr>
                <th v-if="colSummary">{{ t('processes.thProto') }}</th>
                <th v-if="colLocal">{{ t('processes.thLocalAddr') }}</th>
                <th v-if="colRemote">{{ t('processes.thRemoteAddr') }}</th>
                <th v-if="colSummary">{{ t('processes.thStatus') }}</th>
                <th v-if="colConnOwner">PID</th>
                <th v-if="colConnOwner">{{ t('processes.thProcess') }}</th>
                <th v-if="colRemote"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !connections.length"><td :colspan="connCols || 1" class="hint">{{ t('processes.waitingAgent') }}</td></tr>
              <tr v-else-if="connFilter && !filteredConnections.length">
                <td :colspan="connCols || 1" class="hint">
                  {{ connFilterEmptyMsg }}
                  <button class="link-btn" @click="connFilter = null">{{ t('processes.clearFilter') }}</button>
                </td>
              </tr>
              <tr v-else-if="!connections.length"><td :colspan="connCols || 1" class="hint">{{ t('common.noData') }}</td></tr>
              <tr v-for="(c, i) in filteredConnections" :key="i">
                <td class="mono" v-if="colSummary">{{ c.proto }}</td>
                <td class="mono" v-if="colLocal">{{ c.local_addr || '—' }}</td>
                <td class="mono dim" v-if="colRemote">{{ c.remote_addr || '—' }}</td>
                <td v-if="colSummary">{{ c.state || '—' }}</td>
                <td class="mono" v-if="colConnOwner">{{ c.pid || '—' }}</td>
                <td class="mono dim" v-if="colConnOwner">{{ c.process_name || '—' }}</td>
                <td class="num" v-if="colRemote">
                  <RouterLink
                    v-if="connQuickAdd(c)"
                    class="link-btn"
                    :to="{ path: '/monitoring/new', query: connQuickAdd(c)! }"
                    :aria-label="connQuickAddAria(c)"
                  >
                    {{ t('processes.quickAdd') }}
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Processes */
.data-workbench {
  font-variant-numeric: tabular-nums;
}
.workbench-head {
  align-items: flex-start;
}
.head-copy {
  min-width: 0;
}
.workbench-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.picker {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: var(--space-2xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.picker select {
  min-width: 0;
  max-width: min(42vw, 420px);
}
.picker label,
.sort label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.head-copy .sub {
  margin: var(--space-2xs) 0 0;
}
.denial {
  padding: var(--space-sm);
  margin-bottom: var(--space-sm);
  border-color: var(--color-warning);
  background: var(--color-glass-subtle);
  box-shadow: none;
}
.denial h4 {
  margin: 0 0 4px;
  font-size: 14px;
}
.deny-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.deny-head {
  display: block;
  font-size: 13px;
  color: var(--text);
}
.deny-sub {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.tabs {
  display: flex;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  margin-bottom: var(--space-sm);
  padding: var(--space-3xs);
  overflow-x: auto;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: var(--space-2xs) var(--space-sm);
  border: none;
  background: transparent;
  color: var(--color-muted);
  border-radius: var(--radius-xs);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--dur-micro) var(--ease-out),
    background-color var(--dur-micro) var(--ease-out),
    transform var(--dur-micro) var(--ease-out);
}
.tab:hover,
.tab:focus-visible {
  color: var(--color-ink);
  background: var(--color-glass-hover);
}
.tab.active {
  color: var(--color-ink);
  background: var(--color-glass-hover);
  box-shadow: inset 0 0 0 var(--rule-hair) var(--color-rule-2);
}
.tab:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.tab:active {
  transform: translateY(1px);
}
.table-wrap {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-gutter: stable;
}
.table-wrap:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(-1 * var(--rule-fine));
}
.table-sheet {
  background: var(--color-glass-strong);
  border-color: var(--color-rule);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.table-sheet .data-table {
  min-width: 820px;
}
.table-sheet .panel-head {
  min-height: 56px;
  border-bottom-color: var(--color-rule);
}
.data-table thead th {
  background: var(--color-glass-subtle);
}
.data-table tbody tr:focus-within td {
  background: var(--color-glass-hover);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dim {
  color: var(--text-muted);
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
.sort {
  display: flex;
  align-items: center;
  gap: 8px;
}
.basis {
  display: flex;
  align-items: center;
  gap: 8px;
}
.basis-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.seg {
  padding: 4px 12px;
  min-height: 44px;
  border: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-subtle);
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.seg:first-of-type {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
.seg:last-of-type {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  border-left: none;
}
.seg:hover {
  color: var(--color-ink);
}
.seg.active {
  color: var(--color-accent-text);
  border-color: var(--color-accent);
  background: var(--color-glass-hover);
}
.seg:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.panel-head {
  flex-wrap: wrap;
}
.sort select {
  max-width: 100%;
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--color-accent-text);
  font: inherit;
  padding: 0;
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
.empty {
  text-align: center;
  padding: var(--space-xl) var(--space-md);
}

@media (max-width: 768px) {
  .workbench-head {
    align-items: stretch;
  }
  .picker {
    width: 100%;
    flex-wrap: wrap;
  }
  .picker select {
    flex: 1 1 220px;
    max-width: none;
  }
  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }
  .panel-head .spacer {
    display: none;
  }
  .sort,
  .basis {
    width: 100%;
    flex-wrap: wrap;
  }
  .sort select {
    flex: 1 1 180px;
  }
}

@media (max-width: 414px) {
  .picker .btn {
    width: 100%;
  }
  .workbench-tabs {
    width: 100%;
  }
  .workbench-tabs .tab {
    flex: 1 0 auto;
  }
  .basis-label,
  .sort label {
    flex-basis: 100%;
  }
  .seg {
    flex: 1;
  }
}
</style>
