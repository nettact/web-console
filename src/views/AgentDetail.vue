<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  type Agent,
  type AgentConnAlert,
  type Alert,
  type Sample,
  type StatusEvent,
} from '../api'
import { toDateLocale } from '../i18n'
import { agentLabel } from '../lib/agentLabel'
import { agentStatus, agentIndex, refreshAgentStatus } from '../agentStatus'
import { targetStatus } from '../targetStatus'
import { blockedCategory } from '../composables/usePermissionMeta'
import { serverInfo, ensureServerInfo } from '../serverInfo'
import MonitorStateBadge from '../components/status/MonitorStateBadge.vue'
import PermissionChips from '../components/status/PermissionChips.vue'
import PermissionRemediationDialog from '../components/status/PermissionRemediationDialog.vue'
import OsIcon from '../components/agents/OsIcon.vue'
import MetricChart from '../components/MetricChart.vue'
import AlertsTable from '../components/AlertsTable.vue'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const id = computed(() => String(route.params.id || ''))
const agent = ref<Agent | null>(null)
const connAlerts = ref<AgentConnAlert[]>([])
const history = ref<StatusEvent[]>([])
const ruleAlerts = ref<Alert[]>([])
const cpu = ref<Sample[]>([])
const mem = ref<Sample[]>([])
const net = ref<Sample[]>([])
const error = ref('')
const loading = ref(true)

// Live per-agent rollup from the shared store (status/resources/groups/alert).
const row = computed(() => agentIndex.value.get(id.value) || null)
// Derive the firing banner from the LIVE store row (SSE + poll fed), not the
// once-fetched connAlerts, so it appears/clears as the alert opens or resolves
// (including an immediate mute) without a page reload. connAlerts still backs the
// history table below.
const firingConn = computed(() => row.value?.connectivity_alert || null)
const associatedTargets = computed(() =>
  targetStatus.targets.filter((tt) => tt.agents.some((a) => a.agent_id === id.value)),
)

// Blocked permissions: granted by policy but not supported by this Agent's
// platform/build/run-mode (e.g. TCP traceroute granted but the Agent isn't
// running as Administrator), so the grant can never take effect.
const blockedPermissions = computed(() => {
  if (!agent.value) return []
  const supported = new Set(agent.value.supported)
  return agent.value.granted.filter((permId) => !supported.has(permId))
})
// Remediation dialog for a clicked blocked permission. Blocked here means granted
// by policy but not supported by this Agent's platform/build/run-mode, so it is
// never a "not granted" (permission_blocked) case and carries no env line — the
// category is elevation (needs Administrator, e.g. TCP traceroute) or a hard
// unsupported platform/build gap.
const remediation = ref<{ permId: string; category: 'elevation' | 'unsupported' } | null>(null)
function openRemediation(permId: string) {
  remediation.value = { permId, category: blockedCategory(permId) }
}

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(toDateLocale(locale.value)) : '—')
function agentName(): string {
  return agentLabel(agent.value || row.value || { id: id.value })
}

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [a, ca, hist, alerts, cpuS, memS, rxS, txS] = await Promise.all([
      api.agent(id.value),
      api.agentConnAlerts({ agent: id.value, status: 'all', limit: 50 }),
      api.agentStatusHistory(id.value),
      api.alerts(),
      // Explicit window + limit: the server truncates oldest-first (ORDER BY ts
      // LIMIT), so the cap must cover the whole 2h window at the fastest
      // supported collection interval (1s) or the charts silently lose their
      // NEWEST samples. The api.metrics default (limit 200) would do exactly
      // that as soon as host collection runs faster than every 36s.
      api.metrics(id.value, 'host.cpu.pct', { target: 'host', sinceSeconds: 7200, limit: 7201 }),
      api.metrics(id.value, 'host.mem.pct', { target: 'host', sinceSeconds: 7200, limit: 7201 }),
      api.metrics(id.value, 'host.net.rx_bps', { target: 'host', sinceSeconds: 7200, limit: 7201 }),
      api.metrics(id.value, 'host.net.tx_bps', { target: 'host', sinceSeconds: 7200, limit: 7201 }),
    ])
    agent.value = a
    connAlerts.value = ca
    history.value = hist
    ruleAlerts.value = alerts.filter((al) => al.agent_id === id.value)
    cpu.value = cpuS
    mem.value = memS
    // Merge rx/tx into a single overlaid net series set.
    net.value = [...rxS, ...txS]
    netMetrics.value = [
      { key: 'rx', label: t('dashboard.download'), kind: 'host.net.rx_bps', unit: 'bps', color: '#38bdf8', samples: rxS },
      { key: 'tx', label: t('dashboard.upload'), kind: 'host.net.tx_bps', unit: 'bps', color: '#a78bfa', samples: txS },
    ]
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

const netMetrics = ref<Array<{ key: string; label: string; kind: string; unit: string; color: string; samples: Sample[] }>>([])

async function toggleMute() {
  if (!agent.value) return
  error.value = ''
  try {
    const next = !agent.value.connectivity_alerts_muted
    agent.value = await api.updateAgent(id.value, { connectivity_alerts_muted: next })
    await refreshAgentStatus()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function saveName() {
  if (!agent.value) return
  error.value = ''
  try {
    await api.updateAgent(id.value, { display_name: agent.value.display_name })
    await refreshAgentStatus()
  } catch (e) {
    error.value = String((e as Error).message || e)
    // v-model already mutated display_name; restore the persisted value so the page
    // doesn't keep showing an unsaved name that vanishes on reload.
    try {
      agent.value = await api.agent(id.value)
    } catch {
      /* keep the original error visible */
    }
  }
}

watch(id, loadAll)
onMounted(() => {
  loadAll()
  ensureServerInfo()
  if (!agentStatus.loaded) refreshAgentStatus()
})
</script>

<template>
  <main class="page">
    <div class="page-head">
      <button class="link-btn back" @click="router.push('/agents')">← {{ t('agentStatus.backToList') }}</button>
      <h2 class="agent-title">
        <OsIcon v-if="agent" :platform="agent.platform" :size="22" />
        {{ agentName() }}
      </h2>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <!-- connection / identity card -->
    <section class="card conn-card" v-if="agent">
      <div class="conn-head">
        <MonitorStateBadge v-if="row" dim="agent" :state="row.status" />
        <span v-if="agent.connectivity_alerts_muted" class="muted-tag">{{ t('agentStatus.mutedTag') }}</span>
        <span class="spacer"></span>
        <button class="link-btn" @click="toggleMute">
          {{ agent.connectivity_alerts_muted ? t('agentStatus.unmute') : t('agentStatus.mute') }}
        </button>
      </div>
      <dl class="facts">
        <div><dt>{{ t('agentStatus.thName') }}</dt><dd><input v-model="agent.display_name" class="name-in" :placeholder="t('agents.namePlaceholder')" @blur="saveName" /></dd></div>
        <div><dt>{{ t('agents.thHostname') }}</dt><dd class="mono">{{ agent.hostname || '—' }}</dd></div>
        <div><dt>{{ t('agents.thPlatform') }}</dt><dd>{{ agent.platform || '—' }}</dd></div>
        <div><dt>{{ t('agents.thVersion') }}</dt><dd class="mono">{{ agent.agent_version || '—' }}</dd></div>
        <div><dt>{{ t('agentStatus.factStatusSince') }}</dt><dd>{{ fmt(row?.status_since) }}</dd></div>
        <div><dt>{{ t('agentStatus.thLastSeen') }}</dt><dd>{{ fmt(agent.last_seen_at) }}</dd></div>
        <div><dt>{{ t('agentStatus.factFirstConnected') }}</dt><dd>{{ agent.first_connected_at ? fmt(agent.first_connected_at) : t('agentStatus.statusNeverConnected') }}</dd></div>
        <div v-if="agent.last_disconnect_kind"><dt>{{ t('agentStatus.factLastDisconnect') }}</dt><dd>{{ t(`agentStatus.disconnect.${agent.last_disconnect_kind}`) }}</dd></div>
      </dl>
      <div class="perms">
        <PermissionChips :label="t('agents.permEffective')" :ids="agent.effective" tone="effective" />
        <PermissionChips
          v-if="blockedPermissions.length"
          :label="t('agents.permBlocked')"
          :ids="blockedPermissions"
          tone="blocked"
          interactive
          @select="openRemediation"
        />
        <p v-if="blockedPermissions.length" class="perm-hint">{{ t('permRemediation.blockedChipsHint') }}</p>
      </div>
    </section>

    <PermissionRemediationDialog
      :open="!!remediation"
      :perm-id="remediation?.permId || ''"
      :category="remediation?.category || 'unsupported'"
      :desktop="serverInfo.desktop"
      @close="remediation = null"
    />

    <!-- firing connectivity alert banner -->
    <section v-if="firingConn" class="card alert-banner">
      <strong>{{ t('agentStatus.connAlertFiring') }}</strong>
      <span>{{ t(`agentStatus.reason.${firingConn.reason}`) }}</span>
      <span class="hint">· {{ t('agentStatus.offlineSince', { time: fmt(firingConn.offline_since) }) }}</span>
    </section>

    <div class="grid">
      <!-- resource trends -->
      <section class="card">
        <h3>{{ t('agentStatus.sectResources') }}</h3>
        <div class="charts">
          <MetricChart :title="t('agentStatus.chartCpu')" unit="pct" :samples="cpu" color="#38bdf8" />
          <MetricChart :title="t('agentStatus.chartMem')" unit="pct" :samples="mem" color="#34d399" />
          <MetricChart :title="t('agentStatus.chartNet')" :metrics="netMetrics" />
        </div>
        <router-link class="link" :to="`/host-metrics?agent=${encodeURIComponent(id)}`">{{ t('agentStatus.fullHistory') }} →</router-link>
      </section>

      <!-- associated targets -->
      <section class="card">
        <h3>{{ t('agentStatus.sectTargets') }}</h3>
        <p v-if="!associatedTargets.length" class="hint">{{ t('agentStatus.noTargets') }}</p>
        <ul v-else class="target-list">
          <li v-for="tt in associatedTargets" :key="tt.target_id">
            <MonitorStateBadge dim="display" :state="tt.display_state" />
            <span class="tname">{{ tt.name || tt.target }}</span>
          </li>
        </ul>
        <router-link class="link" to="/target-status">{{ t('agentStatus.viewTargetStatus') }} →</router-link>
      </section>
    </div>

    <!-- active rule alerts -->
    <section class="card">
      <AlertsTable :alerts="ruleAlerts" />
    </section>

    <!-- connectivity alert history -->
    <section class="card" v-if="connAlerts.length">
      <h3>{{ t('agentStatus.sectConnHistory') }}</h3>
      <table class="data-table">
        <thead>
          <tr><th>{{ t('agentStatus.thStatus') }}</th><th>{{ t('agentStatus.thReason') }}</th><th>{{ t('agentStatus.thOpened') }}</th><th>{{ t('agentStatus.thResolved') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in connAlerts" :key="a.id">
            <td><span class="badge" :class="a.status === 'firing' ? 'down' : 'up'">{{ a.status === 'firing' ? t('agentStatus.firing') : t('agentStatus.resolved') }}</span></td>
            <td>{{ t(`agentStatus.reason.${a.reason}`) }}</td>
            <td class="hint">{{ fmt(a.opened_at) }}</td>
            <td class="hint">{{ a.resolved_at ? fmt(a.resolved_at) : '—' }}<span v-if="a.resolve_reason"> ({{ t(`agentStatus.resolveReason.${a.resolve_reason}`) }})</span></td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- status history timeline -->
    <section class="card" v-if="history.length">
      <h3>{{ t('agentStatus.sectHistory') }}</h3>
      <ul class="timeline">
        <li v-for="(h, i) in history" :key="i">
          <span class="dot" :class="h.status === 'online' ? 'up' : 'down'"></span>
          <span class="ts">{{ fmt(h.changed_at) }}</span>
          <span>{{ h.status === 'online' ? t('agents.statusOnline') : t('agents.statusOffline') }}</span>
          <span v-if="h.reason" class="hint">· {{ t(`agentStatus.disconnect.${h.reason}`) }}</span>
        </li>
      </ul>
    </section>

    <p v-if="loading" class="hint">{{ t('agentStatus.loading') }}</p>
  </main>
</template>

<style scoped>
.page-head .back {
  display: block;
  margin-bottom: 6px;
}
.agent-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card {
  padding: 16px 18px;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.card h3 {
  margin: 0 0 12px;
  font-size: 14px;
}
.conn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.conn-head .spacer {
  flex: 1;
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px 20px;
  margin: 0;
}
.facts > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.facts dt {
  font-size: 11.5px;
  color: var(--text-muted);
}
.facts dd {
  margin: 0;
  font-size: 13px;
}
.name-in {
  max-width: 200px;
}
.mono {
  font-family: var(--mono, monospace);
  font-size: 12.5px;
}
.perms {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.perms > .perm-list + .perm-list {
  margin-top: 8px;
}
.perm-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}
.alert-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.08);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}
.charts {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.link {
  display: inline-block;
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--primary);
}
.muted-tag {
  font-size: 10.5px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
}
.target-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.target-list li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tname {
  font-size: 13px;
}
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.timeline li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.timeline .ts {
  color: var(--text-dim);
  font-size: 12px;
  min-width: 160px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot.up {
  background: #34d399;
}
.dot.down {
  background: #f87171;
}
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
</style>
