<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type EnrollmentToken, type AgentGroup } from '../api'
import { toDateLocale } from '../i18n'
import { notifications } from '../notifications'
import { usePermissionMeta } from '../composables/usePermissionMeta'
import EnrollExamples from '../components/EnrollExamples.vue'
import PermissionChips from '../components/status/PermissionChips.vue'

const { t, locale } = useI18n()
const { sourceLabel } = usePermissionMeta()

const SITE = 'site_default'
const agents = ref<Agent[]>([])
const tokens = ref<EnrollmentToken[]>([])
const groups = ref<AgentGroup[]>([])
const newGroupName = ref('')
const note = ref('')
const newToken = ref('')
const error = ref('')
const busy = ref(false)
// Which agent's permission detail row is expanded (one at a time).
const expanded = ref('')
const serverUrl = window.location.origin

// Active-issue count per agent comes from the live notification store (SSE-fed),
// so the badge stays current without extra polling.
function activeIssueCount(agentId: string): number {
  return notifications.issues.filter((i) => i.agent_id === agentId && i.state === 'active').length
}
const policyHashShort = (a: Agent) => (a.policy_hash ? a.policy_hash.slice(0, 8) : '—')
function toggleDetail(id: string) {
  expanded.value = expanded.value === id ? '' : id
}

async function load() {
  try {
    ;[agents.value, tokens.value, groups.value] = await Promise.all([
      api.agents(),
      api.listTokens(),
      api.agentGroups(SITE),
    ])
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// Agent status now flips within seconds server-side, so poll just the agent
// list (tokens/groups change only via user actions on this page, which reload).
// Skip a tick while a previous fetch is in flight, and while any input on the
// page is focused — replacing agents.value re-renders the rename inputs and
// would clobber an in-progress edit before its @blur save fires. The focus
// check runs both before AND after the await: the user may have started
// typing while the request was in flight.
let refreshInFlight = false
async function refreshAgents() {
  if (refreshInFlight) return
  if (document.activeElement instanceof HTMLInputElement) return
  refreshInFlight = true
  try {
    const next = await api.agents()
    if (document.activeElement instanceof HTMLInputElement) return
    agents.value = next
  } catch {
    /* transient poll failure — keep showing the last known list */
  } finally {
    refreshInFlight = false
  }
}

// ---- agent groups: named sets of agents used to scope monitoring targets ----
function agentLabel(id: string): string {
  const a = agents.value.find((x) => x.id === id)
  return a ? a.display_name || a.hostname || a.id : id
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
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function saveGroup(g: AgentGroup) {
  error.value = ''
  try {
    await api.updateAgentGroup(g.id, g.name.trim(), g.agent_ids)
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
    await load()
  }
}
async function removeGroup(g: AgentGroup) {
  if (!confirm(t('agents.groupConfirmDelete', { name: g.name }))) return
  error.value = ''
  try {
    await api.deleteAgentGroup(g.id)
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// Save the operator-edited display name on blur (reported fields stay read-only).
// v-model has already mutated a.display_name by the time this runs, so on failure
// reload to restore the persisted value rather than leave an unsaved name showing.
async function rename(a: Agent) {
  error.value = ''
  try {
    await api.updateAgent(a.id, a.display_name)
  } catch (e) {
    error.value = String((e as Error).message || e)
    await load()
  }
}

async function removeAgent(a: Agent) {
  const label = a.display_name || a.hostname || a.id
  if (!confirm(t('agents.confirmDelete', { name: label }))) return
  busy.value = true
  error.value = ''
  try {
    await api.deleteAgent(a.id)
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// Generating a token IS how an agent is "added": the agent self-enrolls with it.
async function create() {
  error.value = ''
  newToken.value = ''
  try {
    const r = await api.createToken(note.value)
    newToken.value = r.token
    note.value = ''
    await load()
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
  ({
    used: t('agents.tokenUsed'),
    expired: t('agents.tokenExpired'),
    available: t('agents.tokenAvailable'),
  })[tokenState(tok)]

const fmtDateTime = (s: string) => new Date(s).toLocaleString(toDateLocale(locale.value))

let timer: number | undefined
onMounted(() => {
  load()
  timer = window.setInterval(refreshAgents, 5000)
})
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ t('agents.title') }}</h2>
      <p class="sub">{{ t('agents.sub') }}</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ t('agents.agentList') }}</h3>
        <span class="count">{{ agents.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ t('agents.thDisplayName') }}</th>
              <th>{{ t('agents.thHostname') }}</th>
              <th>{{ t('agents.thPlatform') }}</th>
              <th>{{ t('agents.thVersion') }}</th>
              <th class="center">{{ t('agents.thStatus') }}</th>
              <th>{{ t('agents.thPermissions') }}</th>
              <th>{{ t('agents.thLastSeen') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!agents.length"><td colspan="8" class="hint">{{ t('agents.noAgents') }}</td></tr>
            <template v-for="a in agents" :key="a.id">
              <tr>
                <td><input v-model="a.display_name" class="name-in" :placeholder="t('agents.namePlaceholder')" @blur="rename(a)" /></td>
                <td class="mono">{{ a.hostname || '—' }}</td>
                <td>{{ a.platform || '—' }}</td>
                <td class="mono">{{ a.agent_version || '—' }}</td>
                <td class="center">
                  <span class="badge" :class="a.status === 'online' ? 'up' : 'neutral'">
                    {{ a.status === 'online' ? t('agents.statusOnline') : t('agents.statusOffline') }}
                  </span>
                </td>
                <td>
                  <div class="perm-cell">
                    <span class="src-badge">{{ sourceLabel(a.policy_source) }}</span>
                    <span class="hash mono" :title="a.policy_hash">{{ policyHashShort(a) }}</span>
                    <span v-if="activeIssueCount(a.id)" class="issue-badge">{{ t('agents.activeIssues', { n: activeIssueCount(a.id) }) }}</span>
                    <button class="link-btn" @click="toggleDetail(a.id)">
                      {{ expanded === a.id ? t('agents.detailHide') : t('agents.detailShow') }}
                    </button>
                  </div>
                </td>
                <td class="hint">{{ a.last_seen_at ? fmtDateTime(a.last_seen_at) : t('agents.neverSeen') }}</td>
                <td class="actions">
                  <button class="link-btn danger" :disabled="busy" @click="removeAgent(a)">{{ t('common.delete') }}</button>
                </td>
              </tr>
              <tr v-if="expanded === a.id" class="detail-row">
                <td colspan="8">
                  <div class="perm-detail">
                    <PermissionChips :label="t('agents.permSupported')" :ids="a.supported" tone="neutral" />
                    <PermissionChips :label="t('agents.permGranted')" :ids="a.granted" tone="granted" />
                    <PermissionChips :label="t('agents.permEffective')" :ids="a.effective" tone="effective" />
                    <p class="src-explain" v-if="a.policy_source === 'desktop_full_access'">{{ t('permissionSource.desktopFullAccessExplain') }}</p>
                    <p class="hash-full hint">{{ t('agents.policyHash') }}: <span class="mono">{{ a.policy_hash || '—' }}</span></p>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ t('agents.groupsTitle') }}</h3>
        <span class="count">{{ groups.length }}</span>
      </div>
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
            <span v-if="!agents.length" class="hint tiny">{{ t('agents.noAgents') }}</span>
            <label v-for="a in agents" :key="a.id" class="member-chip">
              <input type="checkbox" :checked="g.agent_ids.includes(a.id)" @change="toggleMember(g, a.id)" />
              <span>{{ agentLabel(a.id) }}</span>
            </label>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('agents.enrollTitle') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('agents.addAgentHint') }}</p>
        <div class="row">
          <input v-model="note" :placeholder="t('agents.notePlaceholder')" />
          <button class="btn btn-primary" @click="create">{{ t('agents.genToken') }}</button>
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
              <td>
                <span class="badge" :class="tokenState(tok) === 'available' ? 'up' : 'neutral'">{{ tokenStateLabel(tok) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 960px;
}
.panel {
  margin-bottom: 20px;
}
.table-wrap {
  overflow-x: auto;
  border-top: 1px solid var(--border);
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
.panel-body {
  padding: 16px 18px;
}
.panel-body .row {
  margin: 12px 0 0;
}
.mono {
  font-family: var(--mono, monospace);
  font-size: 12.5px;
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.name-in {
  min-width: 140px;
}
code {
  font-family: var(--mono);
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--surface-2);
  border: 1px solid var(--border);
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
.token code {
  background: var(--code-bg);
  word-break: break-all;
  color: var(--primary);
  border-color: transparent;
}
.enroll-examples {
  margin-top: 16px;
}
.perm-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.src-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-dim);
}
.hash {
  font-size: 11.5px;
  color: var(--text-muted);
}
.issue-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  color: #fca5a5;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}
.detail-row td {
  background: var(--surface-2);
}
.perm-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px 2px;
}
.src-explain {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.hash-full {
  margin: 0;
  font-size: 11.5px;
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
</style>
