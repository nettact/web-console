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
  <main class="page agents-page">
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

    <section v-show="tab === 'status'" class="summary-grid" :aria-label="t('agentStatus.summaryAll')">
      <button
        v-for="c in summaryCards"
        :key="c.key"
        class="summary-card"
        :class="[`tone-${c.tone}`, { active: statusFilter === c.key }]"
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
    </section>

    <div class="console-surface">
      <nav class="tabs">
        <button :class="{ active: tab === 'status' }" @click="tab = 'status'">{{ t('agentStatus.tabStatus') }}</button>
        <button :class="{ active: tab === 'groups' }" @click="tab = 'groups'">{{ t('agentStatus.tabGroups') }}</button>
        <button :class="{ active: tab === 'enroll' }" @click="tab = 'enroll'">{{ t('agentStatus.tabEnroll') }}</button>
      </nav>

      <!-- ============ STATUS LIST ============ -->
      <section v-show="tab === 'status'" class="status-pane">
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
                  <strong>{{ agentName(r) }}</strong>
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
              <span class="version mono">{{ r.agent_version || '—' }}</span>

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
    </div>
  </main>
</template>

<style scoped>
.agents-page {
  max-width: 1600px;
  padding-top: 24px;
}
.agents-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}
.agents-hero h2 {
  margin-top: 3px;
  font-size: 27px;
  letter-spacing: -.025em;
}
.agents-hero p {
  margin: 5px 0 0;
  color: var(--text-dim);
  font-size: 12.5px;
}
.eyebrow {
  color: var(--primary);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .16em;
}
.hero-actions {
  display: flex;
  align-items: center;
  gap: 18px;
}
.sync-state {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}
.sync-state i {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22d3ee;
  box-shadow: 0 0 12px #22d3ee;
}
.sync-state i::after {
  content: '';
  position: absolute;
  inset: -5px;
  border: 1px solid color-mix(in srgb, #22d3ee 48%, transparent);
  border-radius: 50%;
  animation: sync-pulse 2s ease-out infinite;
}
.sync-state.stale i {
  background: var(--warning);
  box-shadow: 0 0 12px var(--warning);
}
/* Frozen snapshot (hidden tab / refresh in flight): drop the "live" glow and the
   outward pulse so a stale-but-plausible reading never reads as a live one. */
.sync-state.syncing i {
  background: var(--text-muted);
  box-shadow: none;
}
.sync-state.syncing i::after {
  display: none;
}
.add-agent {
  min-height: 38px;
  padding-inline: 17px;
}
.add-agent span {
  font-size: 18px;
  font-weight: 400;
  line-height: 1;
}
.page-error {
  margin: -8px 0 16px;
}
@keyframes sync-pulse {
  70%, 100% { opacity: 0; transform: scale(1.7); }
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(170px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.summary-card {
  --tone: var(--primary);
  position: relative;
  display: grid;
  grid-template-columns: 58px 1fr;
  align-items: center;
  min-height: 112px;
  padding: 16px 18px;
  overflow: hidden;
  color: var(--text);
  text-align: left;
  border: 1px solid color-mix(in srgb, var(--tone) 38%, var(--border));
  border-radius: 11px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--tone) 7%, transparent), transparent 58%),
    color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: inset 0 1px color-mix(in srgb, var(--tone) 16%, transparent), var(--shadow-soft);
  cursor: pointer;
  transition: border-color .16s ease, transform .16s ease, background .16s ease;
}
.summary-card:hover,
.summary-card.active {
  border-color: color-mix(in srgb, var(--tone) 75%, transparent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--tone) 13%, transparent), transparent 62%),
    color-mix(in srgb, var(--surface) 95%, transparent);
}
.summary-card:hover { transform: translateY(-1px); }
.summary-card.active { box-shadow: inset 0 0 24px color-mix(in srgb, var(--tone) 7%, transparent), 0 0 18px color-mix(in srgb, var(--tone) 10%, transparent); }
.summary-card.tone-good { --tone: var(--success); }
.summary-card.tone-warn { --tone: var(--warning); }
.summary-card.tone-bad { --tone: var(--danger); }
.radar {
  position: relative;
  width: 48px;
  height: 48px;
  border: 1px solid color-mix(in srgb, var(--tone) 48%, transparent);
  border-radius: 50%;
  background: radial-gradient(circle, transparent 27%, color-mix(in srgb, var(--tone) 12%, transparent) 28% 30%, transparent 31% 54%, color-mix(in srgb, var(--tone) 13%, transparent) 55% 57%, transparent 58%);
  box-shadow: 0 0 18px color-mix(in srgb, var(--tone) 18%, transparent);
}
.radar::before,
.radar::after {
  content: '';
  position: absolute;
  background: color-mix(in srgb, var(--tone) 38%, transparent);
}
.radar::before { top: 50%; left: -5px; width: 56px; height: 1px; }
.radar::after { top: -5px; left: 50%; width: 1px; height: 56px; }
.radar i {
  position: absolute;
  inset: 9px;
  border: 1px solid var(--tone);
  border-radius: 50%;
}
.radar b {
  position: absolute;
  top: 8px;
  left: 50%;
  width: 1px;
  height: 16px;
  background: var(--tone);
  box-shadow: 0 0 7px var(--tone);
  transform: rotate(42deg);
  transform-origin: 50% 16px;
}
.summary-copy {
  z-index: 1;
  display: grid;
  justify-items: end;
}
.summary-copy small {
  color: color-mix(in srgb, var(--tone) 78%, var(--text));
  font-size: 11px;
  font-weight: 600;
}
.summary-copy strong {
  margin-top: 3px;
  font-family: var(--mono);
  font-size: 31px;
  line-height: 1;
  letter-spacing: -.04em;
}
.spark {
  position: absolute;
  right: 12px;
  bottom: 8px;
  width: 46%;
  height: 22px;
  opacity: .65;
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
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  border-radius: 13px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  box-shadow: inset 0 1px rgba(255,255,255,.025), var(--shadow);
  backdrop-filter: blur(16px);
}
.console-surface::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 220px;
  height: 1px;
  background: linear-gradient(90deg, var(--primary), transparent);
  box-shadow: 0 0 10px var(--primary);
}
.tabs {
  display: flex;
  gap: 3px;
  min-height: 48px;
  padding: 0 15px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(90deg, color-mix(in srgb, var(--primary-soft) 45%, transparent), transparent 38%);
}
.tabs button {
  position: relative;
  padding: 0 18px;
  color: var(--text-dim);
  font: inherit;
  font-size: 12.5px;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.tabs button::after {
  content: '';
  position: absolute;
  right: 14px;
  bottom: -1px;
  left: 14px;
  height: 2px;
  background: transparent;
}
.tabs button.active { color: var(--primary); }
.tabs button.active::after { background: var(--primary); box-shadow: 0 0 9px var(--primary); }
.status-pane { padding: 16px 10px 10px; }
.stale-note { margin: 0 4px 10px; color: var(--warning); }
.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px 14px;
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
  left: 11px;
  width: 16px;
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1.8;
  transform: translateY(-50%);
  pointer-events: none;
}
.search-control input { width: 100%; padding-left: 35px !important; }
.filter-bar select { min-width: 130px; }
.reset-btn {
  padding: 7px 9px;
  color: var(--primary);
  font: inherit;
  font-size: 11px;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.result-count {
  padding: 4px 10px;
  color: var(--text-dim);
  font-size: 10.5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}
.status-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-0) 34%, transparent);
}
.status-list { min-width: 1370px; }
.status-grid {
  display: grid;
  grid-template-columns: minmax(235px, 1.25fr) 120px 165px 100px 72px minmax(560px, 2.5fr) 68px;
  align-items: center;
  gap: 14px;
}
.list-head {
  min-height: 40px;
  padding: 0 14px;
  color: var(--text-muted);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: .06em;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--primary-soft) 28%, transparent), transparent);
}
.resource-head,
.resource-grid {
  display: grid;
  grid-template-columns: 72px 82px 105px 112px minmax(145px, 1fr);
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.resource-head > span:last-child { color: var(--text-dim); }
.list-message { padding: 34px 20px; text-align: center; }
.list-message.err { margin: 12px; }
.agent-strip {
  position: relative;
  min-height: 82px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  outline: none;
  cursor: pointer;
  transition: background .15s ease, box-shadow .15s ease;
}
.agent-strip:last-child { border-bottom: 0; }
.agent-strip::before {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 0;
  width: 2px;
  border-radius: 0 3px 3px 0;
  background: var(--primary);
  box-shadow: 0 0 9px var(--primary);
}
.agent-strip.state-ok::before { background: #22d3ee; box-shadow: 0 0 9px #22d3ee; }
.agent-strip.state-abnormal::before { background: var(--warning); box-shadow: 0 0 9px var(--warning); }
.agent-strip.state-offline::before { background: var(--danger); box-shadow: 0 0 9px var(--danger); }
.agent-strip.state-never_connected::before { background: var(--text-muted); box-shadow: none; }
.agent-strip:hover,
.agent-strip:focus-visible {
  background: linear-gradient(90deg, color-mix(in srgb, var(--primary-soft) 34%, transparent), var(--overlay-hover) 55%, transparent);
  box-shadow: inset 0 0 24px color-mix(in srgb, var(--primary) 3%, transparent);
}
.identity-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.device-orbit {
  position: relative;
  display: grid;
  width: 42px;
  height: 42px;
  flex: none;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--primary) 70%, transparent);
  border-radius: 50%;
  background: radial-gradient(circle, var(--primary-soft), transparent 68%);
  box-shadow: inset 0 0 12px var(--primary-soft), 0 0 11px color-mix(in srgb, var(--primary) 22%, transparent);
}
.device-orbit::after {
  content: '';
  position: absolute;
  inset: 4px;
  border: 1px dashed color-mix(in srgb, var(--primary) 35%, transparent);
  border-radius: 50%;
}
.state-abnormal .device-orbit { border-color: var(--warning); box-shadow: inset 0 0 12px var(--warning-soft), 0 0 11px color-mix(in srgb, var(--warning) 25%, transparent); }
.state-offline .device-orbit { border-color: var(--danger); box-shadow: inset 0 0 12px var(--danger-soft), 0 0 11px color-mix(in srgb, var(--danger) 25%, transparent); }
.name-lines { display: grid; min-width: 0; }
.name-lines strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.name-lines .mono { margin-top: 3px; overflow: hidden; color: var(--text-muted); font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
.groups-cell { min-width: 0; }
.grp-chip {
  display: inline-block;
  max-width: 108px;
  padding: 2px 7px;
  margin: 2px 3px 2px 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--primary) 75%, var(--text));
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--primary-soft) 45%, transparent);
}
.empty-value { color: var(--text-muted); }
.agent-state-cell { display: grid; gap: 5px; min-width: 0; }
.status-cell { display: flex; align-items: center; gap: 5px; }
.reason { overflow: hidden; color: var(--warning); font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
.state-offline .reason { color: var(--danger); }
.muted-tag { padding: 1px 5px; color: var(--text-muted); font-size: 8px; border: 1px solid var(--border-strong); border-radius: 999px; }
.version { color: var(--primary); font-size: 10.5px; }
.row-actions { display: flex; justify-content: flex-end; gap: 3px; opacity: .42; transition: opacity .15s ease; }
.agent-strip:hover .row-actions,
.row-actions:focus-within { opacity: 1; }
.icon-action {
  display: grid;
  width: 27px;
  height: 27px;
  padding: 0;
  color: var(--text-dim);
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  place-items: center;
  cursor: pointer;
}
.icon-action:hover,
.icon-action.active { color: var(--primary); border-color: var(--border); background: var(--surface-2); }
.icon-action.danger:hover { color: var(--danger); }
.icon-action:disabled { opacity: .45; cursor: not-allowed; }
.icon-action svg { width: 14px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

.console-surface > .panel {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.panel-body { padding: 18px; }
.panel-body .row { margin: 12px 0 0; }
.tiny { margin: 8px 0 0; font-size: 11.5px; }
.group-card { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
.group-head { display: flex; align-items: center; gap: 10px; }
.group-head .spacer { flex: 1; }
.group-name { min-width: 180px; font-weight: 600; }
.group-members { display: flex; flex-wrap: wrap; gap: 8px 12px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); }
.member-chip { display: inline-flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 12.5px; }
.member-chip input { width: auto; }
.token { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-top: 12px; flex-wrap: wrap; border: 1px solid color-mix(in srgb, var(--primary) 28%, transparent); border-radius: var(--radius-sm); background: var(--primary-soft); }
.token-label { color: var(--text-dim); font-size: 12px; }
.token code { padding: 1px 6px; color: var(--primary); font-family: var(--mono); word-break: break-all; border-radius: 5px; background: var(--code-bg); }
.enroll-examples { margin-top: 16px; }
.table-wrap { overflow-x: auto; border-top: 1px solid var(--border); }

@media (max-width: 1100px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(170px, 1fr)); }
  .agents-hero { align-items: flex-start; }
}
@media (max-width: 700px) {
  .agents-page { padding: 20px 14px 44px; }
  .agents-hero { display: grid; }
  .hero-actions { justify-content: space-between; }
  .summary-grid { grid-template-columns: 1fr; }
  .summary-card { min-height: 96px; }
  .filter-bar { align-items: stretch; }
  .search-control,
  .filter-bar select { width: 100%; }
  .filter-bar .spacer { display: none; }
  .result-count { margin-left: auto; align-self: center; }
}
</style>