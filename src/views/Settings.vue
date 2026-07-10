<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type Quota, type EnrollmentToken } from '../api'

const quota = ref<Quota | null>(null)
const tokens = ref<EnrollmentToken[]>([])
const note = ref('')
const newToken = ref('')
const error = ref('')

async function load() {
  try {
    ;[quota.value, tokens.value] = await Promise.all([api.quota(), api.listTokens()])
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
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
input {
  padding: 6px 8px;
  min-width: 240px;
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
