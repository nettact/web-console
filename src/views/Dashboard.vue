<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api, type Agent, type Sample, type Quota, type Device } from '../api'
import MetricChart from '../components/MetricChart.vue'

const SITE = 'site_default'
const agents = ref<Agent[]>([])
const selected = ref<string>('')
const quota = ref<Quota | null>(null)
const rtt = ref<Sample[]>([])
const loss = ref<Sample[]>([])
const publicRtt = ref<Sample[]>([])
const ifaces = ref<Sample[]>([])
const dnsMs = ref<Sample[]>([])
const httpStatus = ref<Sample[]>([])
const httpLat = ref<Sample[]>([])
const devices = ref<Device[]>([])
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
    const id = selected.value
    const [r, l, pr, i, dm, hs, hl, dv] = await Promise.all([
      api.metrics(id, 'probe.icmp.rtt_ms', 'gateway'),
      api.metrics(id, 'probe.icmp.loss_pct', 'gateway'),
      api.metrics(id, 'probe.icmp.rtt_ms', undefined, 400),
      api.metrics(id, 'iface.up', undefined, 200),
      api.metrics(id, 'probe.dns.resolve_ms', undefined, 400),
      api.metrics(id, 'probe.http.status', undefined, 400),
      api.metrics(id, 'probe.http.latency_ms', undefined, 400),
      api.listDevices(SITE),
    ])
    rtt.value = r
    loss.value = l
    publicRtt.value = pr
    ifaces.value = i
    dnsMs.value = dm
    httpStatus.value = hs
    httpLat.value = hl
    devices.value = dv
    error.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

function latestByTarget(samples: Sample[], excludeGateway = false): Map<string, Sample> {
  const m = new Map<string, Sample>()
  for (const s of samples) {
    if (excludeGateway && s.target === 'gateway') continue
    m.set(s.target, s)
  }
  return m
}
function publicTargets(): Sample[] {
  return [...latestByTarget(publicRtt.value, true).values()].sort((a, b) => a.target.localeCompare(b.target))
}
function dnsTargets(): Sample[] {
  return [...latestByTarget(dnsMs.value).values()].sort((a, b) => a.target.localeCompare(b.target))
}
function httpRows() {
  const st = latestByTarget(httpStatus.value)
  const lat = latestByTarget(httpLat.value)
  return [...st.keys()].sort().map((url) => ({ url, status: st.get(url)!.value, lat: lat.get(url)?.value ?? 0 }))
}
function latestIfaces(): Sample[] {
  return [...latestByTarget(ifaces.value).values()].sort((a, b) => a.target.localeCompare(b.target))
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

      <div class="grid">
        <div>
          <h3>公网可达性 (ICMP)</h3>
          <table>
            <thead><tr><th>目标</th><th>RTT</th></tr></thead>
            <tbody>
              <tr v-if="!publicTargets().length"><td colspan="2" class="hint">无数据</td></tr>
              <tr v-for="s in publicTargets()" :key="s.target"><td>{{ s.target }}</td><td>{{ s.value.toFixed(0) }} ms</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>DNS 解析</h3>
          <table>
            <thead><tr><th>域名</th><th>耗时</th></tr></thead>
            <tbody>
              <tr v-if="!dnsTargets().length"><td colspan="2" class="hint">无数据（去监控目标添加 DNS）</td></tr>
              <tr v-for="s in dnsTargets()" :key="s.target"><td>{{ s.target }}</td><td>{{ s.value.toFixed(0) }} ms</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <h3>HTTP/HTTPS</h3>
      <table>
        <thead><tr><th>URL</th><th>状态码</th><th>耗时</th></tr></thead>
        <tbody>
          <tr v-if="!httpRows().length"><td colspan="3" class="hint">无数据（去监控目标添加 HTTP）</td></tr>
          <tr v-for="h in httpRows()" :key="h.url">
            <td>{{ h.url }}</td>
            <td :class="h.status >= 200 && h.status < 400 ? 'up' : 'down'">{{ h.status }}</td>
            <td>{{ h.lat.toFixed(0) }} ms</td>
          </tr>
        </tbody>
      </table>

      <div class="grid">
        <div>
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
        </div>
        <div>
          <h3>局域网设备（ARP 发现）</h3>
          <table>
            <thead><tr><th>IP</th><th>MAC</th></tr></thead>
            <tbody>
              <tr v-if="!devices.length"><td colspan="2" class="hint">尚未发现设备</td></tr>
              <tr v-for="d in devices" :key="d.mac"><td>{{ d.ip }}</td><td>{{ d.mac }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
main {
  max-width: 960px;
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
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
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
  width: 100%;
}
th,
td {
  border: 1px solid rgba(128, 128, 128, 0.3);
  padding: 4px 12px;
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
