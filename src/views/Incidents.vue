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
  <main class="page">
    <div class="page-head">
      <h2>事故与告警</h2>
      <p class="sub">阈值告警实时聚合为分层事故，选中事故可展开处置时间线。</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head">
        <h3>活动告警</h3>
        <span class="count" :class="{ hot: alerts.length }">{{ alerts.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>规则</th><th>Agent</th><th>目标</th><th>层</th><th>值</th><th>开始</th></tr></thead>
          <tbody>
            <tr v-if="!alerts.length"><td colspan="6" class="hint">无活动告警，一切正常 ✓</td></tr>
            <tr v-for="a in alerts" :key="a.id">
              <td>{{ a.rule_name }}</td>
              <td class="mono">{{ a.agent_id.slice(0, 14) }}…</td>
              <td>{{ a.target }}</td>
              <td><span class="badge neutral">{{ layerLabel(a.layer) }}</span></td>
              <td>{{ a.value.toFixed(1) }}</td>
              <td class="hint">{{ new Date(a.started_at).toLocaleTimeString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3>事故</h3>
        <span class="count">{{ incidents.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>状态</th><th>疑似层</th><th>严重度</th><th>摘要</th><th>开始时间</th></tr></thead>
          <tbody>
            <tr v-if="!incidents.length"><td colspan="5" class="hint">暂无事故</td></tr>
            <tr v-for="i in incidents" :key="i.id" class="clickable" :class="{ selected: i.id === selected }"
              @click="select(i.id)">
              <td>
                <span class="badge" :class="i.state">
                  <span class="dot" :class="i.state === 'open' ? 'down' : 'up'"></span>
                  {{ i.state === 'open' ? '进行中' : '已恢复' }}
                </span>
              </td>
              <td>{{ layerLabel(i.suspected_layer) }}</td>
              <td>{{ i.severity }}</td>
              <td>{{ i.summary }}</td>
              <td class="hint">{{ new Date(i.opened_at).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="selected" class="panel">
      <div class="panel-head"><h3>时间线</h3></div>
      <div class="panel-body">
        <ul class="timeline">
          <li v-if="!timeline.length" class="hint">无记录</li>
          <li v-for="(t, idx) in timeline" :key="idx">
            <span class="node"></span>
            <span class="ts">{{ new Date(t.ts).toLocaleTimeString() }}</span>
            <span class="kind">{{ t.kind }}</span>
            <span class="msg">{{ t.message }}</span>
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>

<style scoped>
.panel {
  margin-bottom: 20px;
}
.table-wrap {
  overflow-x: auto;
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
.count.hot {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: rgba(248, 113, 113, 0.3);
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 6px 12px;
}
.timeline li {
  display: flex;
  align-items: baseline;
  gap: 12px;
  position: relative;
  padding: 9px 0 9px 20px;
}
.timeline li:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 20px;
  bottom: -4px;
  width: 1px;
  background: var(--border-strong);
}
.timeline .node {
  position: absolute;
  left: 0;
  top: 13px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 8px var(--primary-glow);
}
.timeline .ts {
  color: var(--text-muted);
  min-width: 84px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.timeline .kind {
  font-family: var(--mono);
  font-size: 12px;
  min-width: 130px;
  color: var(--primary);
}
.timeline .msg {
  color: var(--text-dim);
}
</style>
