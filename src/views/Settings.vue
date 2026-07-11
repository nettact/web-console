<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Quota, type EnrollmentToken, type Channel, type StorageStats } from '../api'
import { toDateLocale } from '../i18n'

const { t, locale } = useI18n()

const quota = ref<Quota | null>(null)
const stats = ref<StorageStats | null>(null)
const tokens = ref<EnrollmentToken[]>([])
const note = ref('')
const newToken = ref('')
const error = ref('')

const channels = ref<Channel[]>([])
// 通知渠道按类型添加：先选类型，再展示对应表单。新增类型时在此登记即可。
const CHANNEL_TYPES = [
  { value: 'webhook', label: 'Webhook' },
  { value: 'email', label: 'Email' },
]
const addType = ref('webhook')
const webhook = reactive({ name: '', url: '' })
const email = reactive({ name: '', host: '', port: '587', from: '', to: '', username: '', password: '' })

async function load() {
  try {
    ;[quota.value, stats.value, tokens.value, channels.value] = await Promise.all([
      api.quota(), api.stats(), api.listTokens(), api.channels(),
    ])
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function addWebhook() {
  if (!webhook.url) return
  await api.createChannel(webhook.name || 'Webhook', 'webhook', { url: webhook.url })
  webhook.name = ''
  webhook.url = ''
  await load()
}
async function addEmail() {
  if (!email.host || !email.from || !email.to) return
  const { name, ...cfg } = email
  await api.createChannel(name || 'Email', 'email', { ...cfg })
  await load()
}
async function toggleChannel(c: Channel) {
  await api.updateChannel(c.id, { name: c.name, enabled: !c.enabled })
  await load()
}
async function renameChannel(c: Channel) {
  await api.updateChannel(c.id, { name: c.name, enabled: c.enabled })
}
async function removeChannel(id: string) {
  await api.deleteChannel(id)
  await load()
}
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
    used: t('settings.tokenUsed'),
    expired: t('settings.tokenExpired'),
    available: t('settings.tokenAvailable'),
  })[tokenState(tok)]
const fmtDateTime = (s: string) => new Date(s).toLocaleString(toDateLocale(locale.value))
onMounted(load)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ t('settings.title') }}</h2>
      <p class="sub">{{ t('settings.sub') }}</p>
    </div>

    <div class="stat-grid">
      <div class="stat" v-if="quota">
        <div class="label">{{ t('settings.agentQuota') }}</div>
        <div class="value">{{ quota.used }}<span class="unit">/ {{ quota.max === 0 ? '∞' : quota.max }}</span></div>
        <div class="foot">{{ t('settings.agentQuotaFoot') }}</div>
      </div>
      <template v-if="stats">
        <div class="stat">
          <div class="label">Series</div>
          <div class="value">{{ stats.series }}</div>
          <div class="foot">{{ t('settings.seriesFoot') }}</div>
        </div>
        <div class="stat">
          <div class="label">{{ t('settings.rawSamples') }}</div>
          <div class="value">{{ stats.samples }}</div>
          <div class="foot">{{ t('settings.rawSamplesFoot') }}</div>
        </div>
        <div class="stat">
          <div class="label">{{ t('settings.rollup') }}</div>
          <div class="value rollup">{{ stats.rollup_1m }}<span class="sep">·</span>{{ stats.rollup_1h }}<span
              class="sep">·</span>{{ stats.rollup_1d }}</div>
          <div class="foot">{{ t('settings.rollupFoot') }}</div>
        </div>
      </template>
    </div>
    <p class="hint storage-note" v-if="stats">
      {{ t('settings.storageNote') }}
    </p>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.enrollTokens') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.enrollHintPrefix') }}<code>nettact-agent --server &lt;URL&gt; --enroll-token &lt;token&gt;</code></p>
        <div class="row">
          <input v-model="note" :placeholder="t('settings.notePlaceholder')" />
          <button class="btn btn-primary" @click="create">{{ t('settings.genToken') }}</button>
        </div>
        <div v-if="newToken" class="token">
          <span class="token-label">{{ t('settings.tokenOnce') }}</span>
          <code>{{ newToken }}</code>
          <button class="link-btn" @click="copyToken">{{ t('settings.copy') }}</button>
        </div>
        <p v-if="error" class="err">{{ error }}</p>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>{{ t('settings.thNote') }}</th><th>{{ t('settings.thExpires') }}</th><th>{{ t('settings.thState') }}</th></tr>
          </thead>
          <tbody>
            <tr v-if="!tokens.length"><td colspan="3" class="hint">{{ t('settings.noTokens') }}</td></tr>
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

    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.channels') }}</h3><span class="count">{{ channels.length }}</span></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.channelsHint') }}</p>

        <div class="type-tabs" role="tablist">
          <span class="type-label">{{ t('settings.addChannelType') }}</span>
          <button
            v-for="ct in CHANNEL_TYPES" :key="ct.value"
            class="type-tab" :class="{ active: addType === ct.value }"
            @click="addType = ct.value">
            {{ ct.label }}
          </button>
        </div>

        <div v-if="addType === 'webhook'" class="row field-row">
          <b class="ftag">Webhook</b>
          <input v-model="webhook.name" :placeholder="t('settings.namePlaceholder')" class="tiny-name" />
          <input v-model="webhook.url" placeholder="https://hooks.example.com/…" class="wide" />
          <button class="btn btn-primary" @click="addWebhook">{{ t('settings.addBtn') }}</button>
        </div>

        <div v-else-if="addType === 'email'" class="row field-row wrap">
          <b class="ftag">Email</b>
          <input v-model="email.name" :placeholder="t('settings.namePlaceholder')" class="tiny-name" />
          <input v-model="email.host" :placeholder="t('settings.smtpHost')" />
          <input v-model="email.port" :placeholder="t('settings.port')" class="tiny" />
          <input v-model="email.from" :placeholder="t('settings.from')" />
          <input v-model="email.to" :placeholder="t('settings.to')" />
          <input v-model="email.username" :placeholder="t('settings.usernameOpt')" />
          <input v-model="email.password" type="password" :placeholder="t('settings.passwordOpt')" />
          <button class="btn btn-primary" @click="addEmail">{{ t('settings.addBtn') }}</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>{{ t('settings.thName') }}</th><th>{{ t('settings.thType') }}</th><th>{{ t('settings.thConfig') }}</th><th class="center">{{ t('settings.thEnabled') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-if="!channels.length"><td colspan="5" class="hint">{{ t('settings.noChannels') }}</td></tr>
            <tr v-for="c in channels" :key="c.id">
              <td><input v-model="c.name" class="name-in" @blur="renameChannel(c)" /></td>
              <td><span class="badge neutral">{{ c.type }}</span></td>
              <td class="mono">{{ c.type === 'webhook' ? c.config.url : (c.config.from + ' → ' + c.config.to + ' @ ' + c.config.host) }}</td>
              <td class="center"><input type="checkbox" :checked="c.enabled" @change="toggleChannel(c)" /></td>
              <td><button class="link-btn danger" @click="removeChannel(c.id)">{{ t('common.delete') }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 900px;
}
.panel {
  margin-bottom: 20px;
}
.table-wrap {
  overflow-x: auto;
  border-top: 1px solid var(--border);
}
.count {
  margin-left: auto;
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
.rollup {
  font-size: 22px;
}
.rollup .sep {
  margin: 0 7px;
  color: var(--text-muted);
  font-weight: 400;
}
.storage-note {
  margin: -8px 0 22px;
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
  background: rgba(0, 0, 0, 0.25);
  word-break: break-all;
  color: var(--primary);
  border-color: transparent;
}
.type-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 2px;
}
.type-label {
  font-size: 13px;
  color: var(--text-dim);
  margin-right: 4px;
}
.type-tab {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background 0.16s, color 0.16s, border-color 0.16s;
}
.type-tab:hover {
  color: var(--text);
}
.type-tab.active {
  color: var(--primary);
  background: var(--primary-soft);
  border-color: rgba(56, 189, 248, 0.35);
}
.field-row .ftag {
  min-width: 62px;
  font-size: 13px;
  color: var(--text-dim);
}
input {
  min-width: 140px;
}
input.wide {
  min-width: 320px;
  flex: 1;
}
input.tiny {
  min-width: 64px;
  width: 64px;
}
input.tiny-name {
  min-width: 96px;
  width: 96px;
}
.name-in {
  min-width: 120px;
}
</style>
