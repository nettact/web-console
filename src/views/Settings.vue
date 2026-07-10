<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { api, type Quota, type EnrollmentToken, type Channel, type StorageStats } from '../api'

const quota = ref<Quota | null>(null)
const stats = ref<StorageStats | null>(null)
const tokens = ref<EnrollmentToken[]>([])
const note = ref('')
const newToken = ref('')
const error = ref('')

const channels = ref<Channel[]>([])
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
function tokenState(t: EnrollmentToken): string {
  if (t.used_at) return '已使用'
  return new Date(t.expires_at) < new Date() ? '已过期' : '可用'
}
onMounted(load)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>设置</h2>
      <p class="sub">配额、存储、注册令牌与通知渠道。</p>
    </div>

    <div class="stat-grid">
      <div class="stat" v-if="quota">
        <div class="label">Agent 配额</div>
        <div class="value">{{ quota.used }}<span class="unit">/ {{ quota.max === 0 ? '∞' : quota.max }}</span></div>
        <div class="foot">已注册 / 上限</div>
      </div>
      <template v-if="stats">
        <div class="stat">
          <div class="label">Series</div>
          <div class="value">{{ stats.series }}</div>
          <div class="foot">时序数量</div>
        </div>
        <div class="stat">
          <div class="label">Raw 样本</div>
          <div class="value">{{ stats.samples }}</div>
          <div class="foot">短期原始点</div>
        </div>
        <div class="stat">
          <div class="label">降采样</div>
          <div class="value rollup">{{ stats.rollup_1m }}<span class="sep">·</span>{{ stats.rollup_1h }}<span
              class="sep">·</span>{{ stats.rollup_1d }}</div>
          <div class="foot">1 分钟 · 1 小时 · 1 天</div>
        </div>
      </template>
    </div>
    <p class="hint storage-note" v-if="stats">
      原始样本短期保留，按 1 分钟 / 1 小时 / 1 天降采样分级长期保留 → 多年历史占用可控。
    </p>

    <section class="panel">
      <div class="panel-head"><h3>注册令牌</h3></div>
      <div class="panel-body">
        <p class="hint">一次性令牌，用于新 agent 注册：<code>nettact-agent --server &lt;URL&gt; --enroll-token &lt;令牌&gt;</code></p>
        <div class="row">
          <input v-model="note" placeholder="备注（可选）" />
          <button class="btn btn-primary" @click="create">生成令牌</button>
        </div>
        <div v-if="newToken" class="token">
          <span class="token-label">令牌（仅显示一次）</span>
          <code>{{ newToken }}</code>
          <button class="link-btn" @click="copyToken">复制</button>
        </div>
        <p v-if="error" class="err">{{ error }}</p>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>备注</th><th>过期时间</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr v-if="!tokens.length"><td colspan="3" class="hint">暂无令牌</td></tr>
            <tr v-for="(t, i) in tokens" :key="i">
              <td>{{ t.note || '—' }}</td>
              <td class="hint">{{ new Date(t.expires_at).toLocaleString() }}</td>
              <td>
                <span class="badge" :class="tokenState(t) === '可用' ? 'up' : 'neutral'">{{ tokenState(t) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>通知渠道</h3><span class="count">{{ channels.length }}</span></div>
      <div class="panel-body">
        <p class="hint">可添加多个渠道，并在「监控目标」的每条报警规则上单独勾选要通知的渠道。</p>

        <div class="row field-row">
          <b class="ftag">Webhook</b>
          <input v-model="webhook.name" placeholder="名称" class="tiny-name" />
          <input v-model="webhook.url" placeholder="https://hooks.example.com/…" class="wide" />
          <button class="btn btn-primary" @click="addWebhook">添加</button>
        </div>

        <div class="row field-row wrap">
          <b class="ftag">Email</b>
          <input v-model="email.name" placeholder="名称" class="tiny-name" />
          <input v-model="email.host" placeholder="smtp 主机" />
          <input v-model="email.port" placeholder="端口" class="tiny" />
          <input v-model="email.from" placeholder="发件人" />
          <input v-model="email.to" placeholder="收件人" />
          <input v-model="email.username" placeholder="用户名(可选)" />
          <input v-model="email.password" type="password" placeholder="密码(可选)" />
          <button class="btn btn-primary" @click="addEmail">添加</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>名称</th><th>类型</th><th>配置</th><th class="center">启用</th><th></th></tr></thead>
          <tbody>
            <tr v-if="!channels.length"><td colspan="5" class="hint">暂无渠道</td></tr>
            <tr v-for="c in channels" :key="c.id">
              <td><input v-model="c.name" class="name-in" @blur="renameChannel(c)" /></td>
              <td><span class="badge neutral">{{ c.type }}</span></td>
              <td class="mono">{{ c.type === 'webhook' ? c.config.url : (c.config.from + ' → ' + c.config.to + ' @ ' + c.config.host) }}</td>
              <td class="center"><input type="checkbox" :checked="c.enabled" @change="toggleChannel(c)" /></td>
              <td><button class="link-btn danger" @click="removeChannel(c.id)">删除</button></td>
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
