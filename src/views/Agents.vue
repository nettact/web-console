<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Agent, type EnrollmentToken } from '../api'
import { toDateLocale } from '../i18n'

const { t, locale } = useI18n()

const agents = ref<Agent[]>([])
const tokens = ref<EnrollmentToken[]>([])
const note = ref('')
const newToken = ref('')
const error = ref('')
const busy = ref(false)

async function load() {
  try {
    ;[agents.value, tokens.value] = await Promise.all([api.agents(), api.listTokens()])
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
onMounted(load)
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
              <th>{{ t('agents.thLastSeen') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!agents.length"><td colspan="7" class="hint">{{ t('agents.noAgents') }}</td></tr>
            <tr v-for="a in agents" :key="a.id">
              <td><input v-model="a.display_name" class="name-in" :placeholder="t('agents.namePlaceholder')" @blur="rename(a)" /></td>
              <td class="mono">{{ a.hostname || '—' }}</td>
              <td>{{ a.platform || '—' }}</td>
              <td class="mono">{{ a.agent_version || '—' }}</td>
              <td class="center">
                <span class="badge" :class="a.status === 'online' ? 'up' : 'neutral'">
                  {{ a.status === 'online' ? t('agents.statusOnline') : t('agents.statusOffline') }}
                </span>
              </td>
              <td class="hint">{{ a.last_seen_at ? fmtDateTime(a.last_seen_at) : t('agents.neverSeen') }}</td>
              <td class="actions">
                <button class="link-btn danger" :disabled="busy" @click="removeAgent(a)">{{ t('common.delete') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('agents.enrollTokens') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('agents.addAgentHint') }}</p>
        <p class="hint">{{ t('agents.enrollHintPrefix') }}<code>nettact-agent --server &lt;URL&gt; --enroll-token &lt;token&gt;</code></p>
        <div class="row">
          <input v-model="note" :placeholder="t('agents.notePlaceholder')" />
          <button class="btn btn-primary" @click="create">{{ t('agents.genToken') }}</button>
        </div>
        <div v-if="newToken" class="token">
          <span class="token-label">{{ t('agents.tokenOnce') }}</span>
          <code>{{ newToken }}</code>
          <button class="link-btn" @click="copyToken">{{ t('agents.copy') }}</button>
        </div>
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
.token code {
  background: var(--code-bg);
  word-break: break-all;
  color: var(--primary);
  border-color: transparent;
}
</style>
