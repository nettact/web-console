<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type AgentGroup, type AgentStatusRow, type EnrollmentToken } from '../api'
import { toDateLocale } from '../i18n'
import { agentLabel } from '../lib/agentLabel'
import { agentStatus, refreshAgentStatus } from '../agentStatus'
import { serverInfo } from '../serverInfo'
import { updateAvailable } from '../lib/semver'
import {
  countStatuses,
  filterAndSortAgents,
  isAgentFilter,
  matchesAgentSearch,
  matchesGroup,
  type AgentFilter,
} from '../lib/agentStatusPage'
import MonitorStateBadge from '../components/status/MonitorStateBadge.vue'
import AgentResourceCell from '../components/agents/AgentResourceCell.vue'
import OsIcon from '../components/agents/OsIcon.vue'
import EnrollExamples from '../components/EnrollExamples.vue'
import ReinstallDialog from '../components/ReinstallDialog.vue'

// KeepAlive in App.vue caches this view by name.
defineOptions({ name: 'Agents' })

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()

const SITE = 'site_default'
type Tab = 'status' | 'groups' | 'enroll'
const tab = ref<Tab>('status')

// ---- filters (URL-synced for deep links) ----
const search = ref('')
const statusFilter = ref<AgentFilter>('all')
const groupFilter = ref('all') // group id | 'ungrouped' | 'all'

function readQuery() {
  const q = route.query
  if (typeof q.tab === 'string' && ['status', 'groups', 'enroll'].includes(q.tab)) tab.value = q.tab as Tab
  if (typeof q.q === 'string') search.value = q.q
  if (typeof q.status === 'string' && isAgentFilter(q.status)) statusFilter.value = q.status
  if (typeof q.group === 'string') groupFilter.value = q.group
}
function writeQuery() {
  const query: Record<string, string> = {}
  if (tab.value !== 'status') query.tab = tab.value
  if (search.value.trim()) query.q = search.value.trim()
  if (statusFilter.value !== 'all') query.status = statusFilter.value
  if (groupFilter.value !== 'all') query.group = groupFilter.value
  router.replace({ query })
}
watch([tab, search, statusFilter, groupFilter], writeQuery)

// ---- now clock (drives sample-age display) ----
const now = ref(Date.now())
let nowTimer: number | undefined

// ---- rows / filtering ----
const groups = ref<AgentGroup[]>([])
const tokens = ref<EnrollmentToken[]>([])
const newGroupName = ref('')
const note = ref('')
const newToken = ref('')
const error = ref('')
const busy = ref(false)
// The agent row whose reinstall dialog is open (null = closed).
const reinstallAgent = ref<AgentStatusRow | null>(null)

// Rows scoped by group + search (but NOT status), so the summary-card counts and
// the status filter compose: clicking a status card narrows to exactly its count.
const scopedRows = computed(() =>
  agentStatus.agents.filter((r) => matchesGroup(r, groupFilter.value) && matchesAgentSearch(r, search.value)),
)
const counts = computed(() => countStatuses(scopedRows.value))
const visibleRows = computed(() =>
  filterAndSortAgents(agentStatus.agents, {
    search: search.value,
    groupId: groupFilter.value,
    status: statusFilter.value,
  }),
)

const summaryCards = computed(() => [
  { key: 'all' as AgentFilter, label: t('agentStatus.summaryAll'), n: scopedRows.value.length, tone: 'total' },
  { key: 'ok' as AgentFilter, label: t('agentStatus.statusOk'), n: counts.value.byStatus.ok, tone: 'good' },
  { key: 'abnormal' as AgentFilter, label: t('agentStatus.statusAbnormal'), n: counts.value.byStatus.abnormal, tone: 'warn' },
  { key: 'offline' as AgentFilter, label: t('agentStatus.statusOffline'), n: counts.value.byStatus.offline, tone: 'bad' },
])

function toggleCard(key: AgentFilter) {
  statusFilter.value = statusFilter.value === key ? 'all' : key
}
function resetFilters() {
  search.value = ''
  statusFilter.value = 'all'
  groupFilter.value = 'all'
}
const filtersActive = computed(() => !!search.value.trim() || statusFilter.value !== 'all' || groupFilter.value !== 'all')

// ---- per-row helpers ----
const fmtDateTime = (s: string | null) => (s ? new Date(s).toLocaleString(toDateLocale(locale.value)) : '—')
// The reason text shown under the status badge.
function reasonText(r: AgentStatusRow): string {
  if (r.status === 'offline' && r.connectivity_alert) {
    return t('agentStatus.offlineReason', { reason: t(`agentStatus.reason.${r.connectivity_alert.reason}`) })
  }
  if (r.status === 'offline' && r.last_disconnect_kind) {
    return t(`agentStatus.disconnect.${r.last_disconnect_kind}`)
  }
  if (r.status === 'abnormal') {
    const parts: string[] = []
    if (r.firing_faults) parts.push(t('agentStatus.reasonFaults', { n: r.firing_faults }))
    if (r.active_issues) parts.push(t('agentStatus.reasonIssues', { n: r.active_issues }))
    return parts.join(' · ')
  }
  return ''
}

// Flags an Agent left behind by a newer agent release. Both versions have to
// parse for this to fire (see lib/semver), so agents reporting '' or an
// unstamped 'dev' build are never marked — and nothing shows at all until the
// server has learnt the latest agent version.
const latestAgentVersion = computed(() => serverInfo.update?.latest_agent_version ?? '')
function agentOutdated(version: string): boolean {
  return updateAvailable(latestAgentVersion.value, version)
}

function openAgent(r: AgentStatusRow) {
  router.push(`/agents/${encodeURIComponent(r.id)}`)
}
async function toggleMute(r: AgentStatusRow) {
  error.value = ''
  try {
    await api.updateAgent(r.id, { connectivity_alerts_muted: !r.connectivity_alerts_muted })
    await refreshAgentStatus()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function removeAgent(r: AgentStatusRow) {
  if (!confirm(t('agents.confirmDelete', { name: agentLabel(r) }))) return
  busy.value = true
  error.value = ''
  try {
    await api.deleteAgent(r.id)
    await refreshAgentStatus()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// ---- groups + tokens (loaded lazily; refreshed on their tab) ----
async function loadGroups() {
  try {
    groups.value = await api.agentGroups(SITE)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function loadTokens() {
  try {
    tokens.value = await api.listTokens()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
function groupAgentLabel(id: string): string {
  const a = agentStatus.agents.find((x) => x.id === id)
  return a ? agentLabel(a) : id
}
function toggleMember(g: AgentGroup, agentId: string) {
  const i = g.agent_ids.indexOf(agentId)
  if (i >= 0) g.agent_ids.splice(i, 1)
  else g.agent_ids.push(agentId)
}
async function createGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  error.value = ''
  try {
    await api.createAgentGroup(SITE, name)
    newGroupName.value = ''
    await loadGroups()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function saveGroup(g: AgentGroup) {
  error.value = ''
  try {
    await api.updateAgentGroup(g.id, g.name.trim(), g.agent_ids)
    await loadGroups()
    // The rename/membership change alters status-row group chips; refresh the
    // shared store so the status tab reflects it immediately (other consoles
    // converge via the config.changed SSE bridge).
    await refreshAgentStatus()
  } catch (e) {
    error.value = String((e as Error).message || e)
    await loadGroups()
  }
}
async function removeGroup(g: AgentGroup) {
  if (!confirm(t('agents.groupConfirmDelete', { name: g.name }))) return
  error.value = ''
  try {
    await api.deleteAgentGroup(g.id)
    await loadGroups()
    await refreshAgentStatus()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
const groupFilterOptions = computed(() => groups.value.map((g) => ({ id: g.id, name: g.name })))

async function createToken() {
  error.value = ''
  newToken.value = ''
  try {
    const r = await api.createToken(note.value)
    newToken.value = r.token
    note.value = ''
    await loadTokens()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
function copyToken() {
  navigator.clipboard?.writeText(newToken.value)
}
type TokenState = 'used' | 'expired' | 'available' | 'revoked'
function tokenState(tok: EnrollmentToken): TokenState {
  if (tok.revoked) return 'revoked'
  if (tok.used_at) return 'used'
  return new Date(tok.expires_at) < new Date() ? 'expired' : 'available'
}
const tokenStateLabel = (tok: EnrollmentToken) =>
  ({
    used: t('agents.tokenUsed'),
    expired: t('agents.tokenExpired'),
    available: t('agents.tokenAvailable'),
    revoked: t('agents.tokenRevoked'),
  })[tokenState(tok)]

async function revokeToken(tok: EnrollmentToken) {
  if (!confirm(t('agents.revokeConfirm'))) return
  error.value = ''
  try {
    await api.revokeToken(tok.token_hash)
    await loadTokens()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

watch(tab, (v) => {
  if (v === 'groups') loadGroups()
  if (v === 'enroll') loadTokens()
})

onMounted(() => {
  nowTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 15000)
})
// This view is KeepAlive-cached, so onMounted runs only once. Re-read the URL and
// refresh on every activation (including the first render, where onActivated fires
// after onMounted), so re-entering via a different /agents?… URL applies the
// current query instead of the stale cached filters.
onActivated(() => {
  readQuery()
  refreshAgentStatus()
  loadGroups() // group filter options + chip names
  if (tab.value === 'enroll') loadTokens()
})
onBeforeUnmount(() => {
  if (nowTimer) window.clearInterval(nowTimer)
})
</script>

<template>
  <main class="page">
    <header class="agents-hero">
      <div>
        <div class="eyebrow">NETTACT / AGENT FLEET</div>
        <h2>{{ t('agents.title') }}</h2>
        <p>{{ t('agents.sub') }}</p>
      </div>
      <div class="hero-actions">
        <span class="sync-state" :class="{ stale: agentStatus.stale, syncing: !agentStatus.stale && agentStatus.syncing }">
          <i></i>
          {{ agentStatus.stale ? t('agentStatus.syncStale') : agentStatus.syncing ? t('agentStatus.syncing') : t('agentStatus.liveSync') }}
        </span>
        <button class="btn btn-primary add-agent" @click="tab = 'enroll'">
          <span aria-hidden="true">＋</span>{{ t('agents.addAgent') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="err page-error">{{ error }}</p>

    <div class="console-surface">
      <nav class="tabs">
        <button :class="{ active: tab === 'status' }" @click="tab = 'status'">{{ t('agentStatus.tabStatus') }}</button>
        <button :class="{ active: tab === 'groups' }" @click="tab = 'groups'">{{ t('agentStatus.tabGroups') }}</button>
        <button :class="{ active: tab === 'enroll' }" @click="tab = 'enroll'">{{ t('agentStatus.tabEnroll') }}</button>
      </nav>

      <!-- ============ STATUS LIST ============ -->
      <section v-show="tab === 'status'" class="status-pane">
        <div class="summary-grid" role="group" :aria-label="t('agentStatus.summaryAll')">
          <button
            v-for="c in summaryCards"
            :key="c.key"
            class="summary-card"
            :class="[`tone-${c.tone}`, { active: statusFilter === c.key }]"
            :aria-pressed="statusFilter === c.key"
            @click="toggleCard(c.key)"
          >
            <span class="radar" aria-hidden="true"><i></i><b></b></span>
            <span class="summary-copy">
              <small>{{ c.label }}</small>
              <strong>{{ c.n }}</strong>
            </span>
            <svg class="spark" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 23 10 19 18 22 27 13 36 18 45 11 55 17 65 8 75 15 84 6 94 12 104 5 120 9" />
            </svg>
          </button>
        </div>

        <p v-if="agentStatus.stale" class="hint stale-note">{{ t('agentStatus.staleSnapshot') }}</p>
        <div class="filter-bar">
          <label class="search-control">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <input v-model="search" type="search" :placeholder="t('agentStatus.searchPlaceholder')" />
          </label>
          <select v-model="groupFilter" :aria-label="t('agentStatus.allGroups')">
            <option value="all">{{ t('agentStatus.allGroups') }}</option>
            <option value="ungrouped">{{ t('agentStatus.ungrouped') }}</option>
            <option v-for="g in groupFilterOptions" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <select v-model="statusFilter" :aria-label="t('agentStatus.allStatuses')">
            <option value="all">{{ t('agentStatus.allStatuses') }}</option>
            <option value="offline">{{ t('agentStatus.statusOffline') }}</option>
            <option value="abnormal">{{ t('agentStatus.statusAbnormal') }}</option>
            <option value="never_connected">{{ t('agentStatus.statusNeverConnected') }}</option>
            <option value="ok">{{ t('agentStatus.statusOk') }}</option>
            <option value="muted">{{ t('agentStatus.muted') }}</option>
          </select>
          <button v-if="filtersActive" class="reset-btn" @click="resetFilters">{{ t('agentStatus.reset') }}</button>
          <span class="spacer"></span>
          <span class="result-count">{{ t('agentStatus.resultCount', { n: visibleRows.length }) }}</span>
        </div>

        <div class="status-scroll">
          <div class="status-list">
            <div class="status-grid list-head" aria-hidden="true">
              <span>{{ t('agentStatus.thName') }}</span>
              <span>{{ t('agentStatus.thGroups') }}</span>
              <span>{{ t('agentStatus.thStatus') }}</span>
              <span>{{ t('agentStatus.thUptime') }}</span>
              <span>{{ t('agentStatus.thVersion') }}</span>
              <div class="resource-head">
                <span>CPU</span>
                <span>{{ t('agentStatus.thLoad') }}</span>
                <span>{{ t('agentStatus.thMemory') }}</span>
                <span>{{ t('agentStatus.thDisk') }}</span>
                <span>{{ t('agentStatus.thNet') }}</span>
              </div>
              <span></span>
            </div>

            <div v-if="agentStatus.error && !agentStatus.loaded" class="list-message err">{{ agentStatus.error }}</div>
            <div v-else-if="!visibleRows.length" class="list-message hint">
              {{ agentStatus.loaded ? t('agentStatus.noneMatch') : t('agents.noAgents') }}
            </div>

            <article
              v-for="r in visibleRows"
              :key="r.id"
              class="status-grid agent-strip"
              :class="`state-${r.status}`"
              tabindex="0"
              @click="openAgent(r)"
              @keyup.enter="openAgent(r)"
            >
              <div class="identity-cell">
                <span class="device-orbit"><OsIcon :platform="r.platform" :size="21" /></span>
                <div class="name-lines">
                  <strong>{{ agentLabel(r) }}</strong>
                  <span class="mono">{{ r.hostname || r.id }}</span>
                </div>
              </div>

              <div class="groups-cell">
                <span v-if="!r.groups.length" class="empty-value">—</span>
                <span v-for="g in r.groups" :key="g.id" class="grp-chip">{{ g.name }}</span>
              </div>

              <div class="agent-state-cell">
                <div class="status-cell">
                  <MonitorStateBadge dim="agent" :state="r.status" />
                  <span v-if="r.connectivity_alerts_muted" class="muted-tag">{{ t('agentStatus.mutedTag') }}</span>
                </div>
                <span v-if="reasonText(r)" class="reason">{{ reasonText(r) }}</span>
              </div>

              <AgentResourceCell kind="uptime" :resources="r.resources" :now="now" />
              <span class="version mono">
                {{ r.agent_version || '—' }}
                <span
                  v-if="agentOutdated(r.agent_version)"
                  class="version-outdated"
                  :title="t('agentStatus.outdatedAgent', { version: latestAgentVersion })"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 20V6" />
                    <path d="m6 12 6-6 6 6" />
                  </svg>
                </span>
              </span>

              <div class="resource-grid">
                <AgentResourceCell kind="cpu" :resources="r.resources" :now="now" />
                <AgentResourceCell kind="load" :resources="r.resources" :now="now" />
                <AgentResourceCell kind="memory" :resources="r.resources" :now="now" />
                <AgentResourceCell kind="disk" :resources="r.resources" :now="now" />
                <AgentResourceCell kind="net" :resources="r.resources" :now="now" />
              </div>

              <div class="row-actions" @click.stop>
                <button
                  class="icon-action"
                  :class="{ active: r.connectivity_alerts_muted }"
                  :title="r.connectivity_alerts_muted ? t('agentStatus.unmute') : t('agentStatus.mute')"
                  @click="toggleMute(r)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-1.2-1.1-1.7-1.9-3.2" /><path d="M10 21h4M3 3l18 18" /></svg>
                </button>
                <!--
                  Reinstall is offered only while the agent is not connected
                  (offline, or enrolled but never connected). A live agent is
                  proof the install works, so the button there is at best noise
                  and at worst an invitation to tear down a healthy agent next to
                  the delete button. `presence` is the raw connection fact rather
                  than the rolled-up `status`, which folds a connected-but-faulty
                  agent into `abnormal`.
                -->
                <button
                  v-if="r.presence !== 'online'"
                  class="icon-action"
                  :title="t('agents.reinstallAction')"
                  @click="reinstallAgent = r"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 1 3 6.7M3 21v-5h5" /></svg>
                </button>
                <button class="icon-action danger" :disabled="busy" :title="t('common.delete')" @click="removeAgent(r)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>

    <!-- ============ GROUPS ============ -->
    <section v-show="tab === 'groups'" class="panel">
      <div class="panel-body">
        <p class="hint">{{ t('agents.groupsHint') }}</p>
        <div class="row">
          <input v-model="newGroupName" :placeholder="t('agents.groupNamePlaceholder')" @keyup.enter="createGroup" />
          <button class="btn btn-primary" @click="createGroup">{{ t('agents.groupCreate') }}</button>
        </div>
        <p v-if="!groups.length" class="hint tiny">{{ t('agents.noGroups') }}</p>
        <div v-for="g in groups" :key="g.id" class="group-card">
          <div class="group-head">
            <input v-model="g.name" class="group-name" :placeholder="t('agents.groupNamePlaceholder')" />
            <span class="spacer"></span>
            <button class="link-btn" @click="saveGroup(g)">{{ t('common.save') }}</button>
            <button class="link-btn danger" @click="removeGroup(g)">{{ t('common.delete') }}</button>
          </div>
          <div class="group-members">
            <span v-if="!agentStatus.agents.length" class="hint tiny">{{ t('agents.noAgents') }}</span>
            <label v-for="a in agentStatus.agents" :key="a.id" class="member-chip">
              <input type="checkbox" :checked="g.agent_ids.includes(a.id)" @change="toggleMember(g, a.id)" />
              <span>{{ groupAgentLabel(a.id) }}</span>
            </label>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ ENROLL ============ -->
    <section v-show="tab === 'enroll'" class="panel">
      <div class="panel-body">
        <p class="hint">{{ t('agents.addAgentHint') }}</p>
        <div class="row">
          <input v-model="note" :placeholder="t('agents.notePlaceholder')" />
          <button class="btn btn-primary" @click="createToken">{{ t('agents.genToken') }}</button>
        </div>
        <div v-if="newToken" class="token">
          <span class="token-label">{{ t('agents.tokenOnce') }}</span>
          <code>{{ newToken }}</code>
          <button class="link-btn" @click="copyToken">{{ t('agents.copy') }}</button>
        </div>
        <EnrollExamples class="enroll-examples" :token="newToken" />
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ t('agents.thNote') }}</th>
              <th>{{ t('agents.thAgent') }}</th>
              <th>{{ t('agents.thExpires') }}</th>
              <th>{{ t('agents.thState') }}</th>
              <th>{{ t('agents.thActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!tokens.length"><td colspan="5" class="hint">{{ t('agents.noTokens') }}</td></tr>
            <tr v-for="tok in tokens" :key="tok.token_hash">
              <td>{{ tok.agent_id ? t('agents.tokenReinstall') : tok.note || '—' }}</td>
              <td>{{ tok.agent_id ? groupAgentLabel(tok.agent_id) : '—' }}</td>
              <td class="hint">{{ fmtDateTime(tok.expires_at) }}</td>
              <td><span class="badge" :class="tokenState(tok) === 'available' ? 'up' : 'neutral'">{{ tokenStateLabel(tok) }}</span></td>
              <td>
                <button v-if="!tok.used_at && !tok.revoked" class="link-btn danger" @click="revokeToken(tok)">
                  {{ t('agents.revoke') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    </div>
  </main>
  <ReinstallDialog :open="!!reinstallAgent" :agent="reinstallAgent" @close="reinstallAgent = null" />
</template>

<style scoped>
/* Hallmark · genre: custom application · macrostructure: Index-First · design-system: design.md · designed-as-app
 * pre-emit critique: P5 H5 E5 S5 R5 V4 · contrast: pass (40–41)
 */
.agents-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.agents-hero h2 {
  min-width: 0;
  margin-top: var(--space-3xs);
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  letter-spacing: -0.028em;
  font-style: normal;
}
.agents-hero p {
  margin: var(--space-3xs) 0 0;
  color: var(--color-ink-2);
  font-size: var(--text-sm);
}
.eyebrow {
  color: var(--color-accent-text);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.12em;
}
.hero-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.sync-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.sync-state i {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--color-success);
}
.sync-state i::after {
  content: none;
}
.sync-state.stale i {
  background: var(--color-warning);
}
/* Frozen snapshot (hidden tab / refresh in flight): drop the "live" glow and the
   outward pulse so a stale-but-plausible reading never reads as a live one. */
.sync-state.syncing i {
  background: var(--color-muted);
  box-shadow: none;
}
.sync-state.syncing i::after {
  display: none;
}
.add-agent {
  min-height: 44px;
  padding-inline: var(--space-sm);
}
.add-agent span {
  font-size: var(--text-md);
  font-weight: 400;
  line-height: 1;
}
.page-error {
  margin: 0 0 var(--space-sm);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(170px, 1fr));
  gap: var(--rule-hair);
  margin-bottom: var(--space-md);
  overflow: hidden;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-rule);
}
.summary-card {
  --tone: var(--color-accent);
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  min-height: 84px;
  padding: var(--space-sm);
  overflow: hidden;
  color: var(--color-ink);
  text-align: left;
  border: 0;
  border-radius: 0;
  background: var(--color-glass-strong);
  cursor: pointer;
  transition: background-color var(--dur-micro) var(--ease-out);
}
.summary-card::after {
  position: absolute;
  right: var(--space-sm);
  bottom: 0;
  left: var(--space-sm);
  height: var(--rule-fine);
  border-radius: var(--radius-pill) var(--radius-pill) 0 0;
  background: var(--tone);
  content: "";
  opacity: 0;
  transform: scaleX(.6);
  transition: opacity var(--dur-micro) var(--ease-out), transform var(--dur-micro) var(--ease-out);
}
.summary-card:hover {
  background: var(--color-glass-hover);
}
.summary-card.active {
  background: var(--color-paper-3);
}
.summary-card.active::after {
  opacity: 1;
  transform: scaleX(1);
}
.summary-card:focus-visible { outline: var(--rule-fine) solid var(--color-focus); outline-offset: var(--space-3xs); }
.summary-card.tone-good { --tone: var(--color-success); }
.summary-card.tone-warn { --tone: var(--color-warning); }
.summary-card.tone-bad { --tone: var(--color-danger); }
.radar {
  position: relative;
  width: 14px;
  height: 14px;
  border: var(--rule-fine) solid var(--tone);
  border-radius: var(--radius-pill);
  background: var(--color-paper-3);
}
.radar::before,
.radar::after,
.radar i,
.radar b {
  content: none;
  display: none;
}
.summary-copy {
  z-index: 1;
  display: grid;
  justify-items: end;
}
.summary-copy small {
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 600;
}
.summary-copy strong {
  margin-top: var(--space-3xs);
  font-family: var(--font-outlier);
  font-size: var(--text-2xl);
  line-height: 1;
  letter-spacing: -.04em;
}
.spark {
  display: none;
}
.spark path {
  fill: none;
  stroke: var(--tone);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.console-surface {
  position: relative;
  overflow: hidden;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-panel);
  background: var(--color-glass);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.console-surface::before {
  content: none;
}
.tabs {
  display: flex;
  gap: var(--space-3xs);
  min-height: 52px;
  padding: var(--space-3xs) var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-strong);
}
.tabs button {
  position: relative;
  min-height: 44px;
  padding: 0 var(--space-sm);
  color: var(--color-ink-2);
  font: inherit;
  font-size: var(--text-sm);
  border: 0;
  border-radius: var(--radius-input);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.tabs button::after {
  content: none;
}
.tabs button:hover { background: var(--color-glass-hover); color: var(--color-ink); }
.tabs button.active { color: var(--color-primary-action-text); background: var(--color-primary-action-bg); }
.tabs button:focus-visible { outline: var(--rule-fine) solid var(--color-focus); outline-offset: var(--space-3xs); }
.status-pane { padding: var(--space-sm) var(--space-xs) var(--space-xs); }
.stale-note { margin: 0 var(--space-3xs) var(--space-xs); color: var(--color-warning-text); }
.filter-bar {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0 var(--space-3xs) var(--space-sm);
  flex-wrap: wrap;
}
.search-control {
  position: relative;
  display: block;
  min-width: 250px;
}
.search-control svg {
  position: absolute;
  top: 50%;
  left: var(--space-xs);
  width: 16px;
  fill: none;
  stroke: var(--color-muted);
  stroke-width: 1.8;
  transform: translateY(-50%);
  pointer-events: none;
}
.search-control input { width: 100%; padding-left: 35px !important; }
.filter-bar select { min-width: 130px; }
.reset-btn {
  min-height: 44px;
  padding: var(--space-2xs) var(--space-xs);
  color: var(--color-accent-text);
  font: inherit;
  font-size: var(--text-xs);
  border: 0;
  background: transparent;
  cursor: pointer;
}
.result-count {
  padding: var(--space-3xs) var(--space-xs);
  color: var(--color-ink-2);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-pill);
  background: var(--color-paper-3);
}
.status-scroll {
  overflow-x: auto;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-paper-2);
}
/* The version column carries an optional "newer agent available" arrow after the
   number, so it is 28px wider than the text alone needs — and the list min-width
   grows by the same 28px, or the extra column width would come out of the
   resource grid. */
.status-list { min-width: 1514px; }
.status-grid {
  display: grid;
  grid-template-columns: minmax(235px, 1.25fr) 120px 165px 100px 100px minmax(560px, 2.5fr) 150px;
  align-items: center;
  gap: 14px;
}
.list-head {
  min-height: 40px;
  padding: 0 var(--space-sm);
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-weight: 650;
  letter-spacing: .06em;
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-paper-3);
}
.resource-head,
.resource-grid {
  display: grid;
  grid-template-columns: 72px 82px 105px 112px minmax(145px, 1fr);
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.resource-head > span:last-child { color: var(--color-ink-2); }
.list-message { padding: 34px 20px; text-align: center; }
.list-message.err { margin: 12px; }
.agent-strip {
  min-height: 82px;
  padding: var(--space-xs) var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  outline: none;
  cursor: pointer;
  transition: background-color var(--dur-micro) var(--ease-out);
}
.agent-strip:last-child { border-bottom: 0; }
.agent-strip::before {
  content: none;
}
.agent-strip:hover,
.agent-strip:focus-visible {
  background: var(--color-glass-hover);
}
.agent-strip:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(var(--rule-fine) * -1);
}
.identity-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.device-orbit {
  display: grid;
  width: 42px;
  height: 42px;
  flex: none;
  place-items: center;
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-input);
  background: var(--color-paper-3);
}
.device-orbit::after {
  content: none;
}
.state-ok .device-orbit { border-color: var(--color-success); }
.state-abnormal .device-orbit { border-color: var(--color-warning); }
.state-offline .device-orbit { border-color: var(--color-danger); }
.name-lines { display: grid; min-width: 0; }
.name-lines strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.name-lines .mono { margin-top: var(--space-3xs); overflow: hidden; color: var(--color-muted); font-family: var(--font-outlier); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.groups-cell { min-width: 0; }
.grp-chip {
  display: inline-block;
  max-width: 108px;
  padding: var(--space-3xs) var(--space-2xs);
  margin: var(--space-3xs) var(--space-3xs) var(--space-3xs) 0;
  overflow: hidden;
  color: var(--color-accent-text);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-xs);
  background: var(--color-glass-subtle);
}
.empty-value { color: var(--color-muted); }
.agent-state-cell { display: grid; gap: 5px; min-width: 0; }
.status-cell { display: flex; align-items: center; gap: 5px; }
.reason { overflow: hidden; color: var(--color-warning-text); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.state-offline .reason { color: var(--color-danger-text); }
.muted-tag { padding: var(--space-3xs) var(--space-2xs); color: var(--color-muted); font-size: var(--text-xs); border: var(--rule-hair) solid var(--color-rule-2); border-radius: var(--radius-pill); }
.version {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3xs);
  color: var(--color-accent-text);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.version-outdated {
  display: inline-flex;
  flex: none;
  color: var(--color-warning-text);
}
.version-outdated svg { width: 14px; height: 14px; }
.row-actions { display: flex; justify-content: flex-end; gap: 3px; opacity: .42; transition: opacity .15s ease; }
.agent-strip:hover .row-actions,
.row-actions:focus-within { opacity: 1; }
.icon-action {
  display: grid;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--color-ink-2);
  border: var(--rule-hair) solid transparent;
  border-radius: var(--radius-input);
  background: transparent;
  place-items: center;
  cursor: pointer;
}
.icon-action:hover,
.icon-action.active { color: var(--color-accent-text); border-color: var(--color-rule); background: var(--color-paper-3); }
.icon-action.danger:hover { color: var(--color-danger-text); }
.icon-action:focus-visible { outline: var(--rule-fine) solid var(--color-focus); outline-offset: var(--space-3xs); }
.icon-action:disabled { opacity: .45; cursor: not-allowed; }
.icon-action svg { width: 14px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

.console-surface > .panel {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.panel-body { padding: var(--space-md); }
.panel-body .row { margin: var(--space-xs) 0 0; }
.tiny { margin: var(--space-2xs) 0 0; font-size: var(--text-xs); }
.group-card { margin-top: var(--space-xs); padding: var(--space-sm); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-card); background: var(--color-paper-2); }
.group-head { display: flex; align-items: center; gap: var(--space-xs); }
.group-head .spacer { flex: 1; }
.group-name { min-width: 180px; font-weight: 600; }
.group-members { display: flex; flex-wrap: wrap; gap: var(--space-2xs) var(--space-xs); margin-top: var(--space-xs); padding-top: var(--space-xs); border-top: var(--rule-hair) solid var(--color-rule); }
.member-chip { display: inline-flex; align-items: center; gap: var(--space-2xs); min-height: 44px; color: var(--color-ink-2); font-size: var(--text-sm); }
.member-chip input { width: auto; }
.token { display: flex; align-items: center; gap: var(--space-xs); padding: var(--space-xs) var(--space-sm); margin-top: var(--space-xs); flex-wrap: wrap; border: var(--rule-hair) solid var(--color-rule-2); border-radius: var(--radius-card); background: var(--color-paper-3); }
.token-label { color: var(--color-ink-2); font-size: var(--text-xs); }
.token code { padding: var(--space-3xs) var(--space-2xs); color: var(--color-accent-text); font-family: var(--font-outlier); word-break: break-all; border-radius: var(--radius-xs); background: var(--color-paper); }
.enroll-examples { margin-top: var(--space-sm); }
.table-wrap { overflow-x: auto; border-top: var(--rule-hair) solid var(--color-rule); }

@media (max-width: 1100px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(170px, 1fr)); }
  .agents-hero { align-items: flex-start; }
}
@media (max-width: 768px) {
  .agents-hero { display: grid; }
  .hero-actions { justify-content: space-between; }
  .summary-grid { grid-template-columns: 1fr; }
  .summary-card { min-height: 76px; }
  .filter-bar { align-items: stretch; }
  .search-control,
  .filter-bar select { width: 100%; }
  .filter-bar .spacer { display: none; }
  .result-count { margin-left: auto; align-self: center; }
}

@media (max-width: 414px) {
  .hero-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding-inline: var(--space-2xs);
  }

  .tabs button {
    min-width: 0;
    padding-inline: var(--space-2xs);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .summary-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .group-head {
    align-items: stretch;
    flex-direction: column;
  }

  .group-head .spacer {
    display: none;
  }

  .group-name {
    width: 100%;
    min-width: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .summary-card,
  .agent-strip {
    transition-duration: var(--dur-micro);
  }
}
</style>
