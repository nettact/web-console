<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api, type Agent, type Sample, type Quota } from '../api'
import MetricChart from '../components/MetricChart.vue'

const agents = ref<Agent[]>([])
const selected = ref<string>('')
const quota = ref<Quota | null>(null)
const rtt = ref<Sample[]>([])
const loss = ref<Sample[]>([])
const publicRtt = ref<Sample[]>([])
const ifaces = ref<Sample[]>([])
const error = ref('')
let timer: number | undefined

async function loadAgents() {
  try {
    ;[agents.value, quota.value] = await Promise.all([api.agents(), api.quota()])
    if (!selected.value && agents.value.length) selected.value = agents.value[0].id
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

async function loadMetrics() {
  if (!selected.value) return
  try {
    const [r, l, pr, i] = await Promise.all([
      api.metrics(selected.value, 'probe.icmp.rtt_ms', 'gateway'),
      api.metrics(selected.value, 'probe.icmp.loss_pct', 'gateway'),
      api.metrics(selected.value, 'probe.icmp.rtt_ms', undefined, 400),
      api.metrics(selected.value, 'iface.up', undefined, 200),
    ])
    rtt.value = r
    loss.value = l
    publicRtt.value = pr
    ifaces.value = i
    error.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// latest sample per target, excluding the gateway (i.e. the public targets)
function publicTargets(): Sample[] {
  const m = new Map<string, Sample>()
  for (const s of publicRtt.value) {
    if (s.target === 'gateway') continue
    m.set(s.target, s)
  }
  return [...m.values()].sort((a, b) => a.target.localeCompare(b.target))
}

function latestIfaces(): Sample[] {
  const m = new Map<string, Sample>()
  for (const s of ifaces.value) m.set(s.target, s)
  return [...m.values()].sort((a, b) => a.target.localeCompare(b.target))
}

onMounted(async () => {
  await loadAgents()
  await loadMetrics()
  timer = window.setInterval(loadMetrics, 5000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <main>
    <header class="head">
      <h2>总览</h2>
      <span v-if="quota" class="quota">Agent 配额 {{ quota.used }} / {{ quota.max === 0 ? '∞' : quota.max }}</span>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <div class="row">
      <label>
        Agent：
        <select v-model="selected" @change="loadMetrics">
          <option v-for="a in agents" :key="a.id" :value="a.id">
            {{ a.hostname || a.id }} ({{ a.platform }}) — {{ a.status }}
          </option>
        </select>
      </label>
      <button @click="loadMetrics">刷新</button>
    </div>

    <p v-if="!agents.length" class="hint">暂无 agent。到「设置」生成注册令牌，再用其启动 nettact-agent。</p>

    <template v-else>
      <div class="card"><MetricChart title="网关 RTT (ms)" unit="ms" :samples="rtt" /></div>
      <div class="card"><MetricChart title="网关丢包率 (%)" unit="%" :samples="loss" /></div>

      <h3>公网可达性（服务端下发的探测目标）</h3>
      <table>
        <thead><tr><th>目标</th><th>最近 RTT</th></tr></thead>
        <tbody>
          <tr v-if="!publicTargets().length"><td colspan="2" class="hint">尚无公网探测数据</td></tr>
          <tr v-for="s in publicTargets()" :key="s.target">
            <td>{{ s.target }}</td>
            <td>{{ s.value.toFixed(0) }} ms</td>
          </tr>
        </tbody>
      </table>

      <h3>接口状态</h3>
      <table>
        <thead><tr><th>接口</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="s in latestIfaces()" :key="s.target">
            <td>{{ s.target }}</td>
            <td :class="s.value === 1 ? 'up' : 'down'">{{ s.value === 1 ? 'UP' : 'DOWN' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </main>
</template>

<style scoped>
main {
  max-width: 920px;
  margin: 0 auto;
  padding: 20px;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.quota {
  font-size: 13px;
  padding: 2px 10px;
  border: 1px solid rgba(128, 128, 128, 0.4);
  border-radius: 999px;
}
.row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
}
.err {
  color: #c0392b;
}
.hint {
  color: #888;
}
.card {
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 8px;
  padding: 8px;
  margin: 12px 0;
}
table {
  border-collapse: collapse;
  margin-bottom: 8px;
}
th,
td {
  border: 1px solid rgba(128, 128, 128, 0.3);
  padding: 4px 14px;
  text-align: left;
}
.up {
  color: #2e7d32;
  font-weight: 600;
}
.down {
  color: #c0392b;
  font-weight: 600;
}
</style>
