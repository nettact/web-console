<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api, type Incident, type TimelineEntry, type Alert } from '../api'

const incidents = ref<Incident[]>([])
const alerts = ref<Alert[]>([])
const selected = ref<string>('')
const timeline = ref<TimelineEntry[]>([])
const error = ref('')
let timer: number | undefined

const LAYERS: Record<string, string> = {
  local: '本机', lan: '局域网', wan: 'WAN', internet: '互联网', dns: 'DNS', service: '服务', wireless: '无线',
}
const layerLabel = (l: string) => LAYERS[l] || l || '—'

async function load() {
  try {
    ;[incidents.value, alerts.value] = await Promise.all([api.incidents(), api.alerts()])
    if (selected.value) timeline.value = await api.timeline(selected.value)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function select(id: string) {
  selected.value = id
  timeline.value = await api.timeline(id)
}
onMounted(async () => {
  await load()
  timer = window.setInterval(load, 5000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <main>
    <h2>事故与告警</h2>
    <p v-if="error" class="err">{{ error }}</p>

    <h3>活动告警（{{ alerts.length }}）</h3>
    <table>
      <thead><tr><th>规则</th><th>Agent</th><th>目标</th><th>层</th><th>值</th><th>开始</th></tr></thead>
      <tbody>
        <tr v-if="!alerts.length"><td colspan="6" class="hint">无活动告警</td></tr>
        <tr v-for="a in alerts" :key="a.id">
          <td>{{ a.rule_name }}</td>
          <td class="mono">{{ a.agent_id.slice(0, 14) }}…</td>
          <td>{{ a.target }}</td>
          <td>{{ layerLabel(a.layer) }}</td>
          <td>{{ a.value.toFixed(1) }}</td>
          <td>{{ new Date(a.started_at).toLocaleTimeString() }}</td>
        </tr>
      </tbody>
    </table>

    <h3>事故</h3>
    <table>
      <thead><tr><th>状态</th><th>疑似层</th><th>严重度</th><th>摘要</th><th>开始时间</th></tr></thead>
      <tbody>
        <tr v-if="!incidents.length"><td colspan="5" class="hint">暂无事故</td></tr>
        <tr v-for="i in incidents" :key="i.id" :class="{ sel: i.id === selected }" @click="select(i.id)">
          <td><span :class="'badge ' + i.state">{{ i.state === 'open' ? '进行中' : '已恢复' }}</span></td>
          <td>{{ layerLabel(i.suspected_layer) }}</td>
          <td>{{ i.severity }}</td>
          <td>{{ i.summary }}</td>
          <td>{{ new Date(i.opened_at).toLocaleString() }}</td>
        </tr>
      </tbody>
    </table>

    <template v-if="selected">
      <h3>时间线</h3>
      <ul class="timeline">
        <li v-if="!timeline.length" class="hint">无记录</li>
        <li v-for="(t, idx) in timeline" :key="idx">
          <span class="ts">{{ new Date(t.ts).toLocaleTimeString() }}</span>
          <span class="kind">{{ t.kind }}</span>
          <span>{{ t.message }}</span>
        </li>
      </ul>
    </template>
  </main>
</template>

<style scoped>
main {
  max-width: 960px;
  margin: 0 auto;
  padding: 20px;
}
.err {
  color: #c0392b;
}
.hint {
  color: #888;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 16px;
}
th,
td {
  border: 1px solid rgba(128, 128, 128, 0.3);
  padding: 5px 12px;
  text-align: left;
}
tr.sel {
  background: rgba(59, 130, 246, 0.12);
}
tbody tr:hover {
  cursor: pointer;
  background: rgba(128, 128, 128, 0.08);
}
.badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.open {
  background: #fde2e1;
  color: #c0392b;
}
.badge.resolved {
  background: #dff0d8;
  color: #2e7d32;
}
.timeline {
  list-style: none;
  padding: 0;
}
.timeline li {
  display: flex;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px dashed rgba(128, 128, 128, 0.2);
}
.timeline .ts {
  color: #888;
  min-width: 90px;
}
.timeline .kind {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  min-width: 130px;
  color: #3b82f6;
}
</style>
