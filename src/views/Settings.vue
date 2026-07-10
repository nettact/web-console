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
const webhookUrl = ref('')
const email = reactive({ host: '', port: '587', from: '', to: '', username: '', password: '' })

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
  if (!webhookUrl.value) return
  await api.createChannel('webhook', { url: webhookUrl.value })
  webhookUrl.value = ''
  await load()
}
async function addEmail() {
  if (!email.host || !email.from || !email.to) return
  await api.createChannel('email', { ...email })
  await load()
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
  <main>
    <h2>设置</h2>

    <section>
      <h3>Agent 配额</h3>
      <p v-if="quota">已用 <b>{{ quota.used }}</b> / {{ quota.max === 0 ? '不限' : quota.max }}</p>
    </section>

    <section v-if="stats">
      <h3>存储用量（时序）</h3>
      <p class="hint">原始样本短期保留、按 1 分钟 / 1 小时 / 1 天降采样分级长期保留 → 多年历史占用可控。</p>
      <table>
        <thead><tr><th>series</th><th>raw 样本</th><th>1 分钟</th><th>1 小时</th><th>1 天</th></tr></thead>
        <tbody>
          <tr>
            <td>{{ stats.series }}</td><td>{{ stats.samples }}</td>
            <td>{{ stats.rollup_1m }}</td><td>{{ stats.rollup_1h }}</td><td>{{ stats.rollup_1d }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h3>注册令牌</h3>
      <p class="hint">一次性令牌，用于新 agent 注册：<code>nettact-agent --server &lt;URL&gt; --enroll-token &lt;令牌&gt;</code></p>
      <div class="row">
        <input v-model="note" placeholder="备注（可选）" />
        <button class="primary" @click="create">生成令牌</button>
      </div>
      <div v-if="newToken" class="token">
        <span>令牌（仅显示一次）：</span>
        <code>{{ newToken }}</code>
        <button class="link" @click="copyToken">复制</button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>

      <table>
        <thead>
          <tr><th>备注</th><th>过期时间</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-if="!tokens.length"><td colspan="3" class="hint">暂无令牌</td></tr>
          <tr v-for="(t, i) in tokens" :key="i">
            <td>{{ t.note || '—' }}</td>
            <td>{{ new Date(t.expires_at).toLocaleString() }}</td>
            <td>{{ tokenState(t) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h3>通知渠道</h3>
      <p class="hint">事故发生/恢复时向以下渠道推送。</p>

      <div class="row">
        <b>Webhook</b>
        <input v-model="webhookUrl" placeholder="https://hooks.example.com/…" class="wide" />
        <button class="primary" @click="addWebhook">添加</button>
      </div>

      <div class="row wrap">
        <b>Email</b>
        <input v-model="email.host" placeholder="smtp 主机" />
        <input v-model="email.port" placeholder="端口" class="tiny" />
        <input v-model="email.from" placeholder="发件人" />
        <input v-model="email.to" placeholder="收件人" />
        <input v-model="email.username" placeholder="用户名(可选)" />
        <input v-model="email.password" type="password" placeholder="密码(可选)" />
        <button class="primary" @click="addEmail">添加</button>
      </div>

      <table>
        <thead><tr><th>类型</th><th>配置</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!channels.length"><td colspan="3" class="hint">暂无渠道</td></tr>
          <tr v-for="c in channels" :key="c.id">
            <td>{{ c.type }}</td>
            <td class="mono">{{ c.type === 'webhook' ? c.config.url : (c.config.from + ' → ' + c.config.to + ' @ ' + c.config.host) }}</td>
            <td><button class="link danger" @click="removeChannel(c.id)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
main {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px;
}
section {
  margin-bottom: 28px;
}
.hint {
  color: #888;
}
.err {
  color: #c0392b;
}
.row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 8px 0;
}
.row.wrap {
  flex-wrap: wrap;
}
input {
  padding: 6px 8px;
  min-width: 140px;
}
input.wide {
  min-width: 320px;
}
input.tiny {
  min-width: 60px;
  width: 60px;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.danger {
  color: #c0392b;
}
.primary {
  background: #3b82f6;
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}
.link {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
}
.token {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px;
  margin: 8px 0;
  background: rgba(59, 130, 246, 0.08);
  border-radius: 6px;
  flex-wrap: wrap;
}
.token code {
  font-family: ui-monospace, monospace;
  word-break: break-all;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin-top: 12px;
}
th,
td {
  border: 1px solid rgba(128, 128, 128, 0.3);
  padding: 6px 10px;
  text-align: left;
}
</style>
