<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type ProcessInfo, type ConnectionInfo, type HostSnapshot } from '../api'
import { fmtBytes } from '../lib/format'

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

function fmtRun(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${h}h ${m}m ${s}s`
}

async function onAgentChange() {
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
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !processes.length"><td colspan="9" class="hint">{{ t('processes.fetching') }}</td></tr>
              <tr v-else-if="!processes.length"><td colspan="9" class="hint">{{ t('common.noData') }}</td></tr>
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
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- connections -->
      <section class="panel" v-if="canConns" v-show="tab === 'connections'">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>{{ t('processes.thProto') }}</th><th>{{ t('processes.thLocalAddr') }}</th><th>{{ t('processes.thRemoteAddr') }}</th><th>{{ t('processes.thStatus') }}</th><th>PID</th><th>{{ t('processes.thProcess') }}</th></tr>
            </thead>
            <tbody>
              <tr v-if="loading && !connections.length"><td colspan="6" class="hint">{{ t('processes.fetching') }}</td></tr>
              <tr v-else-if="!connections.length"><td colspan="6" class="hint">{{ t('common.noData') }}</td></tr>
              <tr v-for="(c, i) in connections" :key="i">
                <td class="mono">{{ c.proto }}</td>
                <td class="mono">{{ c.local_addr }}</td>
                <td class="mono dim">{{ c.remote_addr || '—' }}</td>
                <td>{{ c.state || '—' }}</td>
                <td class="mono">{{ c.pid || '—' }}</td>
                <td class="mono dim">{{ c.process_name || '—' }}</td>
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
