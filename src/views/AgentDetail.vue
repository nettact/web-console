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
import { chartColor } from '../lib/chartColor'
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
import { updateAvailable } from '../lib/semver'
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
  { key: 'cpu', label: t('agentStatus.chartCpu'), kind: 'host.cpu.pct', unit: 'pct', color: chartColor('--color-info', '#38bdf8'), samples: cpu.value },
])
const memMetrics = computed<ChartMetric[]>(() => [
  { key: 'mem', label: t('agentStatus.chartMem'), kind: 'host.mem.pct', unit: 'pct', color: chartColor('--color-success', '#34d399'), samples: mem.value },
])
const netMetrics = computed<ChartMetric[]>(() => [
  { key: 'rx', label: t('dashboard.download'), kind: 'host.net.rx_bps', unit: 'bps', color: chartColor('--color-info', '#38bdf8'), samples: rx.value },
  { key: 'tx', label: t('dashboard.upload'), kind: 'host.net.tx_bps', unit: 'bps', color: chartColor('--color-chart-secondary', '#f472b6'), samples: tx.value },
])

// Live per-agent rollup from the shared store (status/resources/groups/alert).
const row = computed(() => agentIndex.value.get(id.value) || null)

// Same "this Agent is behind the newest release" indicator as the Agents list.
// Both versions must parse (see lib/semver), so an unstamped build is not flagged.
const latestAgentVersion = computed(() => serverInfo.update?.latest_agent_version ?? '')
const agentOutdated = computed(() =>
  updateAvailable(latestAgentVersion.value, agent.value?.agent_version ?? ''),
)
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
  unsupportedReason: string
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
    // The agent's own account of why the capability is missing, passed through
    // verbatim. Empty is a real answer — it means the capability was never
    // probed — and the dialog falls back to explaining the likeliest cause.
    unsupportedReason: p.unsupported_reason || '',
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
        <div>
          <dt>{{ t('agents.thVersion') }}</dt>
          <dd class="mono version-fact">
            {{ agent.agent_version || '—' }}
            <span
              v-if="agentOutdated"
              class="version-outdated"
              :title="t('agentStatus.outdatedAgent', { version: latestAgentVersion })"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20V6" />
                <path d="m6 12 6-6 6 6" />
              </svg>
            </span>
          </dd>
        </div>
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
      :unsupported-reason="remediation?.unsupportedReason"
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
/* Hallmark · genre: custom application · macrostructure: Workbench · design-system: design.md · designed-as-app
 * pre-emit critique: P5 H5 E4 S4 R5 V4
 */
.page-head .back {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-bottom: var(--space-2xs);
}

.agent-title {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  letter-spacing: -0.028em;
  font-style: normal;
}

.card {
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-paper-2);
  box-shadow: var(--shadow-card);
}

.conn-card {
  border-radius: var(--radius-panel);
  background: var(--color-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.card h3 {
  margin: 0 0 var(--space-xs);
  font-family: var(--font-display);
  font-size: var(--text-base);
  letter-spacing: -0.018em;
  font-style: normal;
}

.conn-head {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.conn-head .spacer {
  flex: 1;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-xs) var(--space-md);
  margin: 0;
}

.facts > div {
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
  min-width: 0;
}

.facts dt {
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  color: var(--color-muted);
}

.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--color-ink-2);
  font-size: var(--text-sm);
}

.version-fact {
  display: flex;
  align-items: center;
  gap: var(--space-3xs);
}

.version-outdated {
  display: inline-flex;
  flex: none;
  color: var(--color-warning-text);
}

.version-outdated svg {
  width: 14px;
  height: 14px;
}

.name-in {
  width: 100%;
  max-width: 260px;
  min-height: 44px;
}

.mono {
  font-family: var(--font-outlier);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.perms {
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: var(--rule-hair) solid var(--color-rule);
}

.perms > .perm-list + .perm-list {
  margin-top: var(--space-2xs);
}

.perms > .perm-hint + .perm-list {
  margin-top: var(--space-xs);
}

.perm-hint {
  margin: var(--space-2xs) 0 0;
  font-size: var(--text-xs);
  color: var(--color-muted);
}

.alert-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  border-color: var(--color-danger);
  background: var(--color-paper-2);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-sm);
}

.charts {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-top: var(--space-xs);
  color: var(--color-accent-text);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.muted-tag {
  padding: var(--space-3xs) var(--space-2xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
  border-radius: var(--radius-pill);
  border: var(--rule-hair) solid var(--color-rule-2);
}

.target-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.target-list li {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.tname {
  font-size: var(--text-sm);
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.timeline li {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 44px;
  font-size: var(--text-sm);
}

.timeline .ts {
  min-width: 160px;
  color: var(--color-ink-2);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
}

.dot.up {
  background: var(--color-success);
}

.dot.down {
  background: var(--color-danger);
}

.link-btn {
  min-height: 44px;
  border: none;
  background: transparent;
  color: var(--color-accent-text);
  font: inherit;
  padding: 0 var(--space-3xs);
  cursor: pointer;
  white-space: nowrap;
}

.link-btn:hover {
  text-decoration: underline;
}

.link-btn:focus-visible,
.link:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
  border-radius: var(--radius-xs);
}

.card:has(.data-table) {
  overflow-x: auto;
}

.data-table {
  min-width: 760px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 768px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 414px) {
  .card {
    padding: var(--space-sm);
  }

  .facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .conn-head {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .conn-head .spacer {
    display: none;
  }

  .conn-head .link-btn {
    flex-basis: 100%;
    justify-content: flex-start;
  }

  .timeline li {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .timeline .ts {
    min-width: 0;
    flex-basis: 100%;
  }
}
</style>
