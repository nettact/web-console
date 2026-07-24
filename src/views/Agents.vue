<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type AgentGroup, type AgentStatusRow, type EnrollmentToken } from '../api'
import { toDateLocale } from '../i18n'
import { agentStatus, refreshAgentStatus } from '../agentStatus'
import {
  countStatuses,
  filterAndSortAgents,
  isAgentFilter,
  matchesAgentSearch,
  matchesGroup,
  sampleAge,
  type AgentFilter,
} from '../lib/agentStatusPage'
import MonitorStateBadge from '../components/status/MonitorStateBadge.vue'
import AgentResourceCell from '../components/agents/AgentResourceCell.vue'
import OsIcon from '../components/agents/OsIcon.vue'
import EnrollExamples from '../components/EnrollExamples.vue'

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
const serverUrl = window.location.origin

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
  { key: 'offline' as AgentFilter, label: t('agentStatus.statusOffline'), n: counts.value.byStatus.offline, tone: 'bad' },
  { key: 'abnormal' as AgentFilter, label: t('agentStatus.statusAbnormal'), n: counts.value.byStatus.abnormal, tone: 'warn' },
  { key: 'never_connected' as AgentFilter, label: t('agentStatus.statusNeverConnected'), n: counts.value.byStatus.never_connected, tone: 'unknown' },
  { key: 'ok' as AgentFilter, label: t('agentStatus.statusOk'), n: counts.value.byStatus.ok, tone: 'good' },
  { key: 'muted' as AgentFilter, label: t('agentStatus.muted'), n: counts.value.muted, tone: 'unknown' },
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
function relTime(iso: string | null): string {
  const secs = sampleAge(iso, now.value)
  if (secs == null) return '—'
  if (secs < 60) return t('agentStatus.ageSeconds', { n: secs })
  if (secs < 3600) return t('agentStatus.ageMinutes', { n: Math.floor(secs / 60) })
  if (secs < 86400) return t('agentStatus.ageHours', { n: Math.floor(secs / 3600) })
  return t('agentStatus.ageDays', { n: Math.floor(secs / 86400) })
}
function agentName(r: AgentStatusRow): string {
  return r.display_name || r.hostname || r.id
}
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
    if (r.firing_alerts) parts.push(t('agentStatus.reasonAlerts', { n: r.firing_alerts }))
    if (r.active_issues) parts.push(t('agentStatus.reasonIssues', { n: r.active_issues }))
    return parts.join(' · ')
  }
  return ''
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
  if (!confirm(t('agents.confirmDelete', { name: agentName(r) }))) return
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
function agentLabel(id: string): string {
  const a = agentStatus.agents.find((x) => x.id === id)
  return a ? agentName(a) : id
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
type TokenState = 'used' | 'expired' | 'available'
function tokenState(tok: EnrollmentToken): TokenState {
  if (tok.used_at) return 'used'
  return new Date(tok.expires_at) < new Date() ? 'expired' : 'available'
}
const tokenStateLabel = (tok: EnrollmentToken) =>
  ({ used: t('agents.tokenUsed'), expired: t('agents.tokenExpired'), available: t('agents.tokenAvailable') })[
    tokenState(tok)
  ]

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
    <div class="page-head">
      <h2>{{ t('agents.title') }}</h2>
      <p class="sub">{{ t('agents.sub') }}</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <nav class="tabs">
      <button :class="{ active: tab === 'status' }" @click="tab = 'status'">{{ t('agentStatus.tabStatus') }}</button>
      <button :class="{ active: tab === 'groups' }" @click="tab = 'groups'">{{ t('agentStatus.tabGroups') }}</button>
      <button :class="{ active: tab === 'enroll' }" @click="tab = 'enroll'">{{ t('agentStatus.tabEnroll') }}</button>
    </nav>

    <!-- ============ STATUS LIST ============ -->
    <section v-show="tab === 'status'">
      <p v-if="agentStatus.stale" class="hint stale-note">{{ t('agentStatus.staleSnapshot') }}</p>
      <div class="cards">
        <button
          v-for="c in summaryCards"
          :key="c.key"
          class="card"
          :class="[`tone-${c.tone}`, { active: statusFilter === c.key }]"
          @click="toggleCard(c.key)"
        >
          <span class="card-n">{{ c.n }}</span>
          <span class="card-l">{{ c.label }}</span>
        </button>
      </div>

      <div class="filter-bar">
        <input v-model="search" type="search" class="search" :placeholder="t('agentStatus.searchPlaceholder')" />
        <select v-model="groupFilter">
          <option value="all">{{ t('agentStatus.allGroups') }}</option>
          <option value="ungrouped">{{ t('agentStatus.ungrouped') }}</option>
          <option v-for="g in groupFilterOptions" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <select v-model="statusFilter">
          <option value="all">{{ t('agentStatus.allStatuses') }}</option>
          <option value="offline">{{ t('agentStatus.statusOffline') }}</option>
          <option value="abnormal">{{ t('agentStatus.statusAbnormal') }}</option>
          <option value="never_connected">{{ t('agentStatus.statusNeverConnected') }}</option>
          <option value="ok">{{ t('agentStatus.statusOk') }}</option>
          <option value="muted">{{ t('agentStatus.muted') }}</option>
        </select>
        <button v-if="filtersActive" class="link-btn" @click="resetFilters">{{ t('agentStatus.reset') }}</button>
        <span class="spacer"></span>
        <span class="count">{{ visibleRows.length }}</span>
      </div>

      <div class="table-wrap">
        <table class="data-table agents-table">
          <thead>
            <tr>
              <th>{{ t('agentStatus.thName') }}</th>
              <th>{{ t('agentStatus.thGroups') }}</th>
              <th>{{ t('agentStatus.thStatus') }}</th>
              <th>{{ t('agentStatus.thLastSeen') }}</th>
              <th>{{ t('agentStatus.thVersion') }}</th>
              <th>{{ t('agentStatus.thUptime') }}</th>
              <th>CPU</th>
              <th>{{ t('agentStatus.thLoad') }}</th>
              <th>{{ t('agentStatus.thMemory') }}</th>
              <th>{{ t('agentStatus.thDisk') }}</th>
              <th>{{ t('agentStatus.thNet') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="agentStatus.error && !agentStatus.loaded">
              <td colspan="12" class="err">{{ agentStatus.error }}</td>
            </tr>
            <tr v-else-if="!visibleRows.length">
              <td colspan="12" class="hint">{{ agentStatus.loaded ? t('agentStatus.noneMatch') : t('agents.noAgents') }}</td>
            </tr>
            <tr v-for="r in visibleRows" :key="r.id" class="agent-row" @click="openAgent(r)">
              <td>
                <div class="name-cell">
                  <OsIcon :platform="r.platform" :size="16" />
                  <div class="name-lines">
                    <div class="name">{{ agentName(r) }}</div>
                    <div v-if="r.hostname && r.display_name" class="hint mono">{{ r.hostname }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span v-if="!r.groups.length" class="hint">—</span>
                <span v-for="g in r.groups" :key="g.id" class="grp-chip">{{ g.name }}</span>
              </td>
              <td>
                <div class="status-cell">
                  <MonitorStateBadge dim="agent" :state="r.status" />
                  <span v-if="r.connectivity_alerts_muted" class="muted-tag">{{ t('agentStatus.mutedTag') }}</span>
                </div>
                <div v-if="reasonText(r)" class="hint reason">{{ reasonText(r) }}</div>
              </td>
              <td class="hint">{{ relTime(r.last_seen_at) }}</td>
              <td class="mono">{{ r.agent_version || '—' }}</td>
              <td><AgentResourceCell kind="uptime" :resources="r.resources" :now="now" /></td>
              <td><AgentResourceCell kind="cpu" :resources="r.resources" :now="now" /></td>
              <td><AgentResourceCell kind="load" :resources="r.resources" :now="now" /></td>
              <td><AgentResourceCell kind="memory" :resources="r.resources" :now="now" /></td>
              <td><AgentResourceCell kind="disk" :resources="r.resources" :now="now" /></td>
              <td><AgentResourceCell kind="net" :resources="r.resources" :now="now" /></td>
              <td class="actions" @click.stop>
                <button class="link-btn" @click="toggleMute(r)">
                  {{ r.connectivity_alerts_muted ? t('agentStatus.unmute') : t('agentStatus.mute') }}
                </button>
                <button class="link-btn danger" :disabled="busy" @click="removeAgent(r)">{{ t('common.delete') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
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
              <span>{{ agentLabel(a.id) }}</span>
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
        <EnrollExamples class="enroll-examples" :server-url="serverUrl" :token="newToken" />
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>{{ t('agents.thNote') }}</th><th>{{ t('agents.thExpires') }}</th><th>{{ t('agents.thState') }}</th></tr>
          </thead>
          <tbody>
            <tr v-if="!tokens.length"><td colspan="3" class="hint">{{ t('agents.noTokens') }}</td></tr>
            <tr v-for="(tok, i) in tokens" :key="i">
              <td>{{ tok.note || '—' }}</td>
              <td class="hint">{{ fmtDateTime(tok.expires_at) }}</td>
              <td><span class="badge" :class="tokenState(tok) === 'available' ? 'up' : 'neutral'">{{ tokenStateLabel(tok) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* The status table is wide (12 columns); widen the page past the global 1160px
   cap so it fits without horizontal scrolling on typical screens. The scoped
   selector outranks the global .page rule. */
.page {
  max-width: 1600px;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.tabs button {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  padding: 8px 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tabs button.active {
  color: var(--text);
  border-bottom-color: var(--primary);
}
.cards {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 96px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: pointer;
}
.card.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.card-n {
  font-size: 22px;
  font-weight: 700;
}
.card-l {
  font-size: 12px;
  color: var(--text-dim);
}
.card.tone-bad .card-n {
  color: #fca5a5;
}
.card.tone-warn .card-n {
  color: #fcd34d;
}
.card.tone-good .card-n {
  color: #6ee7b7;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.filter-bar .search {
  min-width: 220px;
}
.filter-bar .spacer {
  flex: 1;
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
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.agents-table {
  min-width: 1240px;
}
.agent-row {
  cursor: pointer;
}
.agent-row:hover {
  background: var(--surface-2);
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name-lines {
  min-width: 0;
}
.name {
  font-weight: 600;
}
.mono {
  font-family: var(--mono, monospace);
  font-size: 12px;
}
.grp-chip {
  display: inline-block;
  font-size: 11px;
  padding: 1px 8px;
  margin: 1px 3px 1px 0;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-dim);
}
.status-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.reason {
  margin-top: 2px;
}
.muted-tag {
  font-size: 10.5px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  white-space: nowrap;
}
.stale-note {
  margin: 0 0 8px;
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
.link-btn.danger {
  color: var(--danger);
}
.panel {
  margin-bottom: 20px;
}
.panel-body {
  padding: 4px 2px 16px;
}
.panel-body .row {
  margin: 12px 0 0;
}
.tiny {
  font-size: 11.5px;
  margin: 8px 0 0;
}
.group-card {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.group-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.group-head .spacer {
  flex: 1;
}
.group-name {
  min-width: 180px;
  font-weight: 600;
}
.group-members {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.member-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.member-chip input {
  width: auto;
}
.token {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  margin-top: 12px;
  background: var(--primary-soft);
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: var(--radius-sm);
  flex-wrap: wrap;
}
.token-label {
  font-size: 12px;
  color: var(--text-dim);
}
.token code {
  font-family: var(--mono);
  background: var(--code-bg);
  word-break: break-all;
  color: var(--primary);
  padding: 1px 6px;
  border-radius: 5px;
}
.enroll-examples {
  margin-top: 16px;
}
</style>
