<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type ProcessInfo, type ConnectionInfo, type HostSnapshot } from '../api'
import { fmtBytes } from '../lib/format'
import { quickAddQuery } from '../lib/netaddr'

const { t } = useI18n()

// This page shows a live, on-demand snapshot of an agent's processes and network
// connections. Nothing is stored server-side: opening the page asks the agent to
// return its current lists once, and the result is held only in memory. The agent
// serves it only if started with --report-processes / --report-connections.
const route = useRoute()
const agents = ref<Agent[]>([])
const selected = ref<string>('')
const agent = ref<Agent | null>(null)
const snapshot = ref<HostSnapshot | null>(null)
const loading = ref(false)
const error = ref('')
const sortKey = ref<'cpu' | 'ram' | 'name'>('cpu')
const tab = ref<'processes' | 'connections'>('processes')
// The 网络连接 tab can be filtered either by exact process name (aggregating every
// connection across all PIDs that share the name) or by an exact PID. `connBasis`
// selects which, defaulting to name; `connFilter` is a discriminated union whose
// `basis` always equals `connBasis` when set (a non-null filter matches the
// selected basis). `name` is retained on the PID variant so a fresh snapshot can
// revalidate the PID+name pair and avoid matching a recycled PID.
type ConnBasis = 'name' | 'pid'
type ConnFilter =
  | { basis: 'name'; name: string }
  | { basis: 'pid'; pid: number; name: string }
const connBasis = ref<ConnBasis>('name')
const connFilter = ref<ConnFilter | null>(null)
let poll: number | undefined

const canProcs = computed(() => agent.value?.capabilities?.includes('host.process.read') ?? false)
const canConns = computed(() => agent.value?.capabilities?.includes('host.connection.read') ?? false)
const permitted = computed(() => canProcs.value || canConns.value)

// Keep the active tab valid for the selected agent's capabilities: if the current
// tab isn't available but the other is, switch to it (e.g. an agent that only
// reports connections should land on the 网络连接 tab).
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
// (HTTP 409) when the agent has no live connection — surface that as a clear
// localized message instead of the raw server string.
function snapshotErrMsg(e: unknown): string {
  const msg = String((e as Error).message || e)
  return msg === 'agent offline' ? t('processes.agentOffline') : msg
}

// Ask the agent for a fresh snapshot, then poll until it returns (round-trip is
// bounded by the agent's upload interval, typically a few seconds).
async function requestSnapshot() {
  // Always cancel any in-flight poll first: switching to a different (or
  // unsupported) agent must not leave the previous interval running against the
  // newly selected id.
  stopPoll()
  loading.value = false
  if (!selected.value || !permitted.value) {
    snapshot.value = null
    return
  }
  loading.value = true
  error.value = ''
  snapshot.value = null
  try {
    const { request_id } = await api.requestSnapshot(selected.value, canProcs.value, canConns.value)
    let tries = 0
    poll = window.setInterval(async () => {
      tries++
      try {
        const res = await api.getSnapshot(selected.value)
        if (res.snapshot && res.snapshot.request_id === request_id) {
          snapshot.value = res.snapshot
          revalidateConnFilter()
          loading.value = false
          stopPoll()
        } else if (tries > 25) {
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
    if (sortKey.value === 'ram') return b.rss_bytes - a.rss_bytes
    return b.cpu_pct - a.cpu_pct
  })
  return ps
})
const connections = computed<ConnectionInfo[]>(() => snapshot.value?.connections || [])

// Connections narrowed by the active filter. Name mode aggregates every
// connection whose non-empty process_name exactly matches (across all PIDs); PID
// mode matches the exact PID. No filter (null) shows everything.
const filteredConnections = computed<ConnectionInfo[]>(() => {
  const cs = connections.value
  const f = connFilter.value
  if (!f) return cs
  if (f.basis === 'name') return cs.filter((c) => c.process_name === f.name)
  return cs.filter((c) => c.pid === f.pid)
})

// Name options for name-basis filtering: sorted, deduplicated, non-empty process
// names from the process list plus connection-only data (so a connection-only
// agent still gets options). Empty names are excluded here — they can't drive a
// name filter. The current name is injected if momentarily absent so the
// <select> keeps showing it (name basis only).
const connNameOptions = computed<string[]>(() => {
  const seen = new Set<string>()
  for (const p of snapshot.value?.processes || []) if (p.name) seen.add(p.name)
  for (const c of connections.value) if (c.process_name) seen.add(c.process_name)
  const f = connFilter.value
  if (connBasis.value === 'name' && f && f.basis === 'name' && f.name) seen.add(f.name)
  return [...seen].sort((a, b) => a.localeCompare(b))
})

// PID options for pid-basis filtering. The full process list is the primary
// source, so processes with zero connections stay selectable; a connection-only
// agent derives options from the connections. Connections without a PID are
// skipped. The current PID is injected if momentarily absent (pid basis only).
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

// Bridge between the name <select>'s string value and the name filter.
const connNameValue = computed<string>({
  get: () => {
    const f = connFilter.value
    return f && f.basis === 'name' ? f.name : ''
  },
  set: (v) => {
    connFilter.value = v ? { basis: 'name', name: v } : null
  },
})

// Bridge between the PID <select>'s string value and the PID filter.
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

// Basis-specific empty message when the current filter matches nothing.
const connFilterEmptyMsg = computed<string>(() => {
  const f = connFilter.value
  if (!f) return ''
  if (f.basis === 'name') return t('processes.noConnsForName', { name: f.name })
  return t('processes.noConnsForProcess', { name: f.name || '—', pid: f.pid })
})

// Switching the basis clears the current selection (they aren't comparable).
function setConnBasis(b: ConnBasis) {
  if (connBasis.value === b) return
  connBasis.value = b
  connFilter.value = null
}

// The quick-add-monitor query for a connection row, or null when the row's
// remote address yields no usable target (or a TCP row without a valid port).
function connQuickAdd(c: ConnectionInfo) {
  return quickAddQuery(c.proto, c.remote_addr)
}
// Accessible label for a row's quick-add link, worded per resulting monitor kind.
function connQuickAddAria(c: ConnectionInfo): string {
  const q = connQuickAdd(c)
  if (!q) return ''
  return q.kind === 'tcp'
    ? t('processes.quickAddTcpAria', { target: q.target, port: q.port })
    : t('processes.quickAddIcmpAria', { target: q.target })
}

// Jump from a process row to its connections without asking for a new snapshot —
// just filter the already-loaded data and switch tabs, following the current
// basis. A process with an empty name can't drive a name filter, so in name mode
// it visibly falls back to the PID basis instead.
function viewConnections(p: ProcessInfo) {
  if (connBasis.value === 'name' && !p.name) connBasis.value = 'pid'
  if (connBasis.value === 'name') connFilter.value = { basis: 'name', name: p.name }
  else connFilter.value = { basis: 'pid', pid: p.pid, name: p.name }
  tab.value = 'connections'
}

// After a fresh snapshot, keep the filter only if it still resolves: a name is
// revalidated by name existence; a PID by the same PID+name pair (PIDs are
// recycled, so a bare PID match isn't enough). Both consult the process list and
// fall back to the connection side for a connection-only agent.
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

async function onAgentChange() {
  // Switching agents must not carry a selection across to unrelated data, but the
  // chosen basis (name/PID) is a UI preference and is retained.
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
  <main class="page">
    <div class="page-head">
      <h2>{{ t('processes.title') }}</h2>
      <span class="spacer"></span>
      <div class="picker" v-if="agents.length">
        <label>Agent</label>
        <select v-model="selected" @change="onAgentChange">
          <option v-for="a in agents" :key="a.id" :value="a.id">
            {{ a.hostname || a.id }} ({{ a.platform }}) — {{ a.status }}
          </option>
        </select>
        <button class="btn" :disabled="loading || !permitted" @click="requestSnapshot">
          {{ loading ? t('processes.fetching') : t('processes.refreshSnapshot') }}
        </button>
      </div>
    </div>

    <p class="hint sub">{{ t('processes.sub') }}</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="!permitted && agent" class="card empty">
      <h3>{{ t('processes.notEnabledTitle') }}</h3>
      <p class="hint">
        {{ t('processes.notEnabledHint1') }}<code>--report-processes</code>{{ t('processes.notEnabledHint2') }}<code>--report-connections</code>{{ t('processes.notEnabledHint3') }}
      </p>
    </div>

    <template v-else>
      <!-- tabs: switch between 进程 and 网络连接 instead of stacking them, so a
           long process list doesn't bury the network connections below it. -->
      <div class="tabs" role="tablist">
        <button
          v-if="canProcs"
          class="tab"
          role="tab"
          :class="{ active: tab === 'processes' }"
          :aria-selected="tab === 'processes'"
          @click="tab = 'processes'"
        >
          {{ t('processes.tabProcesses') }}
          <span class="count">{{ snapshot?.process_total ?? processes.length }}</span>
        </button>
        <button
          v-if="canConns"
          class="tab"
          role="tab"
          :class="{ active: tab === 'connections' }"
          :aria-selected="tab === 'connections'"
          @click="tab = 'connections'"
        >
          {{ t('processes.tabConnections') }}
          <span class="count">{{ connections.length }}</span>
        </button>
      </div>

      <!-- processes -->
      <section class="panel" v-if="canProcs" v-show="tab === 'processes'">
        <div class="panel-head">
          <span class="spacer"></span>
          <div class="sort">
            <label>{{ t('processes.sortLabel') }}</label>
            <select v-model="sortKey">
              <option value="cpu">CPU</option>
              <option value="ram">{{ t('processes.sortRam') }}</option>
              <option value="name">{{ t('processes.sortName') }}</option>
            </select>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ t('processes.thProcName') }}</th><th>PID</th><th>{{ t('processes.thStatus') }}</th><th>{{ t('processes.thUser') }}</th>
                <th class="num">CPU %</th><th class="num">{{ t('processes.thMem') }}</th><th class="num">{{ t('processes.thVirt') }}</th>
                <th class="num">{{ t('processes.thDisk') }}</th><th class="num">{{ t('processes.thRuntime') }}</th>
                <th v-if="canConns"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !processes.length"><td :colspan="canConns ? 10 : 9" class="hint">{{ t('processes.fetching') }}</td></tr>
              <tr v-else-if="!processes.length"><td :colspan="canConns ? 10 : 9" class="hint">{{ t('common.noData') }}</td></tr>
              <tr v-for="p in processes" :key="p.pid">
                <td class="mono">{{ p.name }}</td>
                <td class="mono">{{ p.pid }}</td>
                <td>{{ p.status || '—' }}</td>
                <td class="mono dim">{{ p.user || '—' }}</td>
                <td class="num">{{ p.cpu_pct.toFixed(1) }}</td>
                <td class="num">{{ fmtBytes(p.rss_bytes) }}</td>
                <td class="num dim">{{ fmtBytes(p.virt_bytes) }}</td>
                <td class="num dim">{{ fmtBytes(p.disk_read_bytes) }} / {{ fmtBytes(p.disk_write_bytes) }}</td>
                <td class="num dim">{{ fmtRun(p.run_time_seconds) }}</td>
                <td v-if="canConns" class="num">
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
      <section class="panel" v-if="canConns" v-show="tab === 'connections'">
        <div class="panel-head">
          <!-- Segmented control choosing whether the filter matches by process
               name (aggregating all PIDs) or an exact PID. -->
          <div class="basis" role="group" :aria-label="t('processes.connBasisLabel')">
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
          <div class="sort">
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
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>{{ t('processes.thProto') }}</th><th>{{ t('processes.thLocalAddr') }}</th><th>{{ t('processes.thRemoteAddr') }}</th><th>{{ t('processes.thStatus') }}</th><th>PID</th><th>{{ t('processes.thProcess') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-if="loading && !connections.length"><td colspan="7" class="hint">{{ t('processes.fetching') }}</td></tr>
              <tr v-else-if="connFilter && !filteredConnections.length">
                <td colspan="7" class="hint">
                  {{ connFilterEmptyMsg }}
                  <button class="link-btn" @click="connFilter = null">{{ t('processes.clearFilter') }}</button>
                </td>
              </tr>
              <tr v-else-if="!connections.length"><td colspan="7" class="hint">{{ t('common.noData') }}</td></tr>
              <tr v-for="(c, i) in filteredConnections" :key="i">
                <td class="mono">{{ c.proto }}</td>
                <td class="mono">{{ c.local_addr }}</td>
                <td class="mono dim">{{ c.remote_addr || '—' }}</td>
                <td>{{ c.state || '—' }}</td>
                <td class="mono">{{ c.pid || '—' }}</td>
                <td class="mono dim">{{ c.process_name || '—' }}</td>
                <td class="num">
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
.picker {
  display: flex;
  align-items: center;
  gap: 10px;
}
.picker label,
.sort label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.sub {
  margin-top: -6px;
  margin-bottom: 14px;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
.table-wrap {
  overflow-x: auto;
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
/* Segmented control for the connection filter basis (name vs PID). */
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
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
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
  color: var(--text);
}
.seg.active {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft, var(--surface-2));
}
/* Let the connections filter drop below the row on narrow screens instead of
   overflowing, and keep the <select> from bleeding past the panel edge. */
.panel-head {
  flex-wrap: wrap;
}
.sort select {
  max-width: 100%;
}
/* Native buttons that read as links: focusable (keyboard-accessible) yet inline
   with surrounding text. Used for the row "view connections" action and the
   "clear filter" affordance in the empty state. */
.link-btn {
  border: none;
  background: transparent;
  color: var(--primary);
  font: inherit;
  padding: 0;
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
.empty {
  text-align: center;
  padding: 40px 20px;
}
.empty code {
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 5px;
}
</style>
