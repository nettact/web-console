<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  type Agent,
  type AgentPermission,
  type FaultSignal,
  type Sample,
  type StatusEvent,
} from '../api'
import { toDateLocale } from '../i18n'
import { agentLabel } from '../lib/agentLabel'
import { agentStatus, agentIndex, refreshAgentStatus } from '../agentStatus'
import { targetStatus } from '../targetStatus'
import {
  agentPlatform,
  bucketAgentPermissions,
  categoryFor,
  permissionById,
  type RemediationCategory,
} from '../lib/agentPermissions'
import { serverInfo, ensureServerInfo } from '../serverInfo'
import MonitorStateBadge from '../components/status/MonitorStateBadge.vue'
import PermissionChips from '../components/status/PermissionChips.vue'
import PermissionRemediationDialog from '../components/status/PermissionRemediationDialog.vue'
import OsIcon from '../components/agents/OsIcon.vue'
import MetricChart from '../components/MetricChart.vue'
import FaultSignalsTable from '../components/FaultSignalsTable.vue'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const id = computed(() => String(route.params.id || ''))
const agent = ref<Agent | null>(null)
const connFaults = ref<FaultSignal[]>([])
const history = ref<StatusEvent[]>([])
const targetFaults = ref<FaultSignal[]>([])
const cpu = ref<Sample[]>([])
const mem = ref<Sample[]>([])
const rx = ref<Sample[]>([])
const tx = ref<Sample[]>([])
const error = ref('')
const loading = ref(true)

// One series as MetricChart consumes them (it plots an array of these). Derived
// rather than stored, because t() must re-evaluate on a locale switch: a stored
// label would leave the legend and tooltip in the language the page loaded in
// while the chart title (translated in the template) switched.
type ChartMetric = { key: string; label: string; kind: string; unit: string; color: string; samples: Sample[] }
const cpuMetrics = computed<ChartMetric[]>(() => [
  { key: 'cpu', label: t('agentStatus.chartCpu'), kind: 'host.cpu.pct', unit: 'pct', color: '#38bdf8', samples: cpu.value },
])
const memMetrics = computed<ChartMetric[]>(() => [
  { key: 'mem', label: t('agentStatus.chartMem'), kind: 'host.mem.pct', unit: 'pct', color: '#34d399', samples: mem.value },
])
const netMetrics = computed<ChartMetric[]>(() => [
  { key: 'rx', label: t('dashboard.download'), kind: 'host.net.rx_bps', unit: 'bps', color: '#38bdf8', samples: rx.value },
  { key: 'tx', label: t('dashboard.upload'), kind: 'host.net.tx_bps', unit: 'bps', color: '#a78bfa', samples: tx.value },
])

// Live per-agent rollup from the shared store (status/resources/groups/alert).
const row = computed(() => agentIndex.value.get(id.value) || null)
// Derive the firing banner from the LIVE store row (SSE + poll fed), not the
// once-fetched history, so it appears/clears as the fault opens or resolves
// (including an immediate mute) without a page reload. connFaults still backs the
// history table below.
const firingConn = computed(() => row.value?.connectivity_alert || null)
const associatedTargets = computed(() =>
  targetStatus.targets.filter((tt) => tt.agents.some((a) => a.agent_id === id.value)),
)

// The Agent's whole permission catalog, not just what it reported having: the
// permissions it does NOT have are the actionable half of this card — an operator
// needs to see which capabilities are still available and what to configure to
// turn them on.
const permissions = ref<AgentPermission[]>([])
const permBuckets = computed(() => bucketAgentPermissions(permissions.value))

// Remediation dialog for a clicked permission. Everything the dialog needs comes
// from the server-computed entry: the cause (policy / privilege / platform /
// dependency) and, when a policy change is part of the fix, the full
// dependency-closed NETTACT_AGENT_PERMISSIONS line. The console never derives that
// closure itself.
const remediation = ref<{
  permId: string
  category: RemediationCategory
  env: string
  requires: string[]
  grantMissing: boolean
} | null>(null)
function openRemediation(permId: string) {
  const p = permissionById(permissions.value, permId)
  if (!p) return
  remediation.value = {
    permId,
    // Whether a capability gap is fixable by elevation depends on the agent's
    // platform, so the cause is decided with it rather than from the id alone.
    category: categoryFor(p, agentPlatform(agent.value?.platform || '')),
    env: p.permissions_env || '',
    requires: p.requires || [],
    grantMissing: !p.granted,
  }
}

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(toDateLocale(locale.value)) : '—')
function agentName(): string {
  return agentLabel(agent.value || row.value || { id: id.value })
}

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [a, perms, ca, hist, faults, cpuS, memS, rxS, txS] = await Promise.all([
      api.agent(id.value),
      api.agentPermissions(id.value),
      api.faultSignals({ agent: id.value, detector: 'agent_connectivity', limit: 50 }),
      api.agentStatusHistory(id.value),
      api.faultSignals({ agent: id.value, detector: 'availability', limit: 50 }),
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
    permissions.value = perms.permissions
    connFaults.value = ca
    history.value = hist
    targetFaults.value = faults
    cpu.value = cpuS
    mem.value = memS
    rx.value = rxS
    tx.value = txS
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

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
      <!-- Every permission, grouped by whether it works and why not. The three
           non-effective rows are clickable: each opens the cause and, where a
           policy change is the fix, the exact configuration line. -->
      <div class="perms">
        <PermissionChips :label="t('agents.permEffective')" :ids="permBuckets.effective" tone="effective" />
        <template v-if="permBuckets.notGranted.length">
          <PermissionChips
            :label="t('agents.permNotGranted')"
            :ids="permBuckets.notGranted"
            tone="missing"
            interactive
            @select="openRemediation"
          />
          <p class="perm-hint">
            {{ t('permRemediation.notGrantedChipsHint') }}
            <a :href="t('docs.permissionsUrl')" target="_blank" rel="noopener noreferrer">
              {{ t('permRemediation.docsLink') }} →
            </a>
          </p>
        </template>
        <template v-if="permBuckets.blocked.length">
          <PermissionChips
            :label="t('agents.permBlocked')"
            :ids="permBuckets.blocked"
            tone="blocked"
            interactive
            @select="openRemediation"
          />
          <p class="perm-hint">{{ t('permRemediation.blockedChipsHint') }}</p>
        </template>
        <template v-if="permBuckets.unsupported.length">
          <PermissionChips
            :label="t('agents.permUnsupported')"
            :ids="permBuckets.unsupported"
            tone="neutral"
            interactive
            @select="openRemediation"
          />
          <p class="perm-hint">{{ t('permRemediation.unsupportedGroupHint') }}</p>
        </template>
      </div>
    </section>

    <PermissionRemediationDialog
      :open="!!remediation"
      :perm-id="remediation?.permId || ''"
      :category="remediation?.category || 'unsupported'"
      :permissions-env="remediation?.env"
      :requires="remediation?.requires"
      :grant-missing="remediation?.grantMissing"
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
          <MetricChart :title="t('agentStatus.chartCpu')" :metrics="cpuMetrics" />
          <MetricChart :title="t('agentStatus.chartMem')" :metrics="memMetrics" />
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

    <!-- this Agent's target faults -->
    <FaultSignalsTable :signals="targetFaults" />

    <!-- connectivity fault history -->
    <section class="card" v-if="connFaults.length">
      <h3>{{ t('agentStatus.sectConnHistory') }}</h3>
      <table class="data-table">
        <thead>
          <tr><th>{{ t('agentStatus.thStatus') }}</th><th>{{ t('agentStatus.thReason') }}</th><th>{{ t('agentStatus.thOpened') }}</th><th>{{ t('agentStatus.thResolved') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in connFaults" :key="a.id">
            <td><span class="badge" :class="a.state === 'firing' ? 'down' : 'up'">{{ a.state === 'firing' ? t('agentStatus.firing') : t('agentStatus.resolved') }}</span></td>
            <td>{{ a.reason_detail ? t(`agentStatus.reason.${a.reason_detail}`) : '—' }}</td>
            <td class="hint">{{ fmt(a.confirmed_at) }}</td>
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
/* A group followed by its own hint needs a little more air before the next one. */
.perms > .perm-hint + .perm-list {
  margin-top: 12px;
}
.perm-hint {
  margin: 6px 0 0;
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
