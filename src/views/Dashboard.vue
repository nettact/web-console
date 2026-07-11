<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api, type Agent, type Sample, type Quota, type Device, type StatusEvent } from '../api'
import MetricChart from '../components/MetricChart.vue'

const SITE = 'site_default'
const agents = ref<Agent[]>([])
const selected = ref<string>('')
const quota = ref<Quota | null>(null)
const statusHistory = ref<StatusEvent[]>([])
// Two range series feed the trend charts; everything else on this page only
// needs the latest value, so it comes from a single /latest snapshot.
const rtt = ref<Sample[]>([])
const loss = ref<Sample[]>([])
const snapshot = ref<Sample[]>([])
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
    // Gateway RTT/loss keep a short range for the trend charts; the snapshot
    // covers every other panel with one round trip instead of five.
    const [r, l, snap, dv] = await Promise.all([
      api.metrics(id, 'probe.icmp.rtt_ms', 'gateway'),
      api.metrics(id, 'probe.icmp.loss_pct', 'gateway'),
      api.latest(id),
      api.listDevices(SITE),
    ])
    rtt.value = r
    loss.value = l
    snapshot.value = snap
    devices.value = dv
    error.value = ''
    statusHistory.value = await api.agentStatusHistory(id)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
const fmtTime = (s: string) => new Date(s).toLocaleString()

// The snapshot holds one point per series, so panels just filter it by kind.
const byKind = (kind: string) => snapshot.value.filter((s) => s.kind === kind)
const byTarget = (kind: string) => new Map(byKind(kind).map((s) => [s.target, s]))

function publicTargets(): Sample[] {
  return byKind('probe.icmp.rtt_ms')
    .filter((s) => s.target !== 'gateway')
    .sort((a, b) => a.target.localeCompare(b.target))
}
function dnsTargets(): Sample[] {
  return byKind('probe.dns.resolve_ms').sort((a, b) => a.target.localeCompare(b.target))
}
function httpRows() {
  const st = byTarget('probe.http.status')
  const lat = byTarget('probe.http.latency_ms')
  return [...st.keys()].sort().map((url) => ({ url, status: st.get(url)!.value, lat: lat.get(url)?.value ?? 0 }))
}
function latestIfaces(): Sample[] {
  return byKind('iface.up').sort((a, b) => a.target.localeCompare(b.target))
}

// --- host / system metrics (stored series, delivered via /latest) ---
const hasHost = () => snapshot.value.some((s) => s.kind.startsWith('host.'))
function hostVal(kind: string, target = 'host'): number | null {
  const s = snapshot.value.find((x) => x.kind === kind && x.target === target)
  return s ? s.value : null
}
function coreNum(t: string): number {
  const m = /(\d+)/.exec(t)
  return m ? +m[1] : 0
}
function cpuCores(): Sample[] {
  return byKind('host.cpu.core.pct').sort((a, b) => coreNum(a.target) - coreNum(b.target))
}
function diskMounts(): string[] {
  return [...new Set(byKind('host.disk.pct').map((s) => s.target))].sort()
}
function fmtBytes(v: number | null): string {
  if (v == null) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let n = v
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}
const fmtBps = (v: number | null) => (v == null ? '—' : `${fmtBytes(v)}/s`)
function fmtUptime(sec: number | null): string {
  if (sec == null) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${d}d ${h}h ${m}m`
}
function barClass(pct: number | null): string {
  if (pct == null) return ''
  return pct < 60 ? 'is-good' : pct < 85 ? 'is-warn' : 'is-bad'
}

// --- headline KPIs (latest gateway sample by timestamp) ---
function latestVal(samples: Sample[]): number | null {
  let best: Sample | null = null
  for (const s of samples) {
    if (!best || new Date(s.ts).getTime() > new Date(best.ts).getTime()) best = s
  }
  return best ? best.value : null
}
function rttClass(v: number | null): string {
  if (v == null) return ''
  return v < 50 ? 'is-good' : v < 150 ? 'is-warn' : 'is-bad'
}
function lossClass(v: number | null): string {
  if (v == null) return ''
  return v === 0 ? 'is-good' : v < 2 ? 'is-warn' : 'is-bad'
}
function onlineCount(): number {
  return agents.value.filter((a) => a.status === 'online').length
}
const fmt = (v: number | null, digits = 0) => (v == null ? '—' : v.toFixed(digits))

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
  <main class="page">
    <div class="page-head">
      <h2>总览</h2>
      <span v-if="quota" class="pill">
        <span class="dot live"></span>
        Agent 配额 {{ quota.used }} / {{ quota.max === 0 ? '∞' : quota.max }}
      </span>
      <span class="spacer"></span>
      <div class="picker" v-if="agents.length">
        <label>Agent</label>
        <select v-model="selected" @change="loadMetrics">
          <option v-for="a in agents" :key="a.id" :value="a.id">
            {{ a.hostname || a.id }} ({{ a.platform }}) — {{ a.status }}
          </option>
        </select>
        <button class="btn" @click="loadMetrics">刷新</button>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="!agents.length" class="card empty">
      <div class="empty-ico">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </div>
      <h3>暂无 agent</h3>
      <p class="hint">到「设置」生成注册令牌，再用其启动 nettact-agent 即可上线。</p>
    </div>

    <template v-else>
      <!-- KPI tiles -->
      <div class="stat-grid">
        <div class="stat" :class="rttClass(latestVal(rtt))">
          <div class="label">网关 RTT</div>
          <div class="value">{{ fmt(latestVal(rtt)) }}<span class="unit">ms</span></div>
          <div class="foot">默认网关往返时延</div>
        </div>
        <div class="stat" :class="lossClass(latestVal(loss))">
          <div class="label">网关丢包率</div>
          <div class="value">{{ fmt(latestVal(loss), 1) }}<span class="unit">%</span></div>
          <div class="foot">ICMP 探测丢包</div>
        </div>
        <div class="stat is-good">
          <div class="label">在线 Agent</div>
          <div class="value">{{ onlineCount() }}<span class="unit">/ {{ agents.length }}</span></div>
          <div class="foot">已连接采集端</div>
        </div>
        <div class="stat">
          <div class="label">局域网设备</div>
          <div class="value">{{ devices.length }}</div>
          <div class="foot">ARP 发现主机</div>
        </div>
      </div>

      <!-- host / system status (only when the agent reports it) -->
      <section v-if="hasHost()" class="panel host-panel">
        <div class="panel-head">
          <h3>系统状态</h3>
          <RouterLink class="btn ghost sm" :to="{ path: '/processes', query: { agent: selected } }">
            实时进程 / 网络连接 →
          </RouterLink>
        </div>
        <div class="host-grid">
          <!-- CPU -->
          <div class="host-card">
            <div class="hc-head"><span>CPU 使用率</span><b>{{ fmt(hostVal('host.cpu.pct'), 1) }}%</b></div>
            <div class="bar"><span :class="barClass(hostVal('host.cpu.pct'))" :style="{ width: (hostVal('host.cpu.pct') ?? 0) + '%' }"></span></div>
            <div class="cores">
              <div class="core" v-for="c in cpuCores()" :key="c.target">
                <span class="core-label">{{ c.target }}</span>
                <span class="bar sm"><span :class="barClass(c.value)" :style="{ width: c.value + '%' }"></span></span>
                <span class="core-val">{{ c.value.toFixed(0) }}%</span>
              </div>
            </div>
          </div>
          <!-- Memory -->
          <div class="host-card">
            <div class="hc-head"><span>内存</span><b>{{ fmt(hostVal('host.mem.pct'), 1) }}%</b></div>
            <div class="bar"><span :class="barClass(hostVal('host.mem.pct'))" :style="{ width: (hostVal('host.mem.pct') ?? 0) + '%' }"></span></div>
            <dl class="kv">
              <div><dt>总量</dt><dd>{{ fmtBytes(hostVal('host.mem.total')) }}</dd></div>
              <div><dt>已用</dt><dd>{{ fmtBytes(hostVal('host.mem.used')) }}</dd></div>
              <div><dt>可用</dt><dd>{{ fmtBytes(hostVal('host.mem.free')) }}</dd></div>
            </dl>
          </div>
          <!-- Storage -->
          <div class="host-card">
            <div class="hc-head"><span>存储</span></div>
            <div v-for="mp in diskMounts()" :key="mp" class="disk">
              <div class="disk-head"><span class="mono">{{ mp }}</span><b>{{ fmt(hostVal('host.disk.pct', mp), 1) }}%</b></div>
              <div class="bar sm"><span :class="barClass(hostVal('host.disk.pct', mp))" :style="{ width: (hostVal('host.disk.pct', mp) ?? 0) + '%' }"></span></div>
              <div class="disk-foot hint">
                {{ fmtBytes(hostVal('host.disk.used', mp)) }} / {{ fmtBytes(hostVal('host.disk.total', mp)) }}
                · 可用 {{ fmtBytes(hostVal('host.disk.free', mp)) }}
              </div>
            </div>
          </div>
          <!-- System -->
          <div class="host-card">
            <div class="hc-head"><span>系统</span></div>
            <dl class="kv">
              <div><dt>运行时长</dt><dd>{{ fmtUptime(hostVal('host.uptime_s')) }}</dd></div>
              <div><dt>1m 负载</dt><dd>{{ fmt(hostVal('host.load.1m'), 2) }}</dd></div>
              <div><dt>5m 负载</dt><dd>{{ fmt(hostVal('host.load.5m'), 2) }}</dd></div>
              <div><dt>15m 负载</dt><dd>{{ fmt(hostVal('host.load.15m'), 2) }}</dd></div>
            </dl>
          </div>
          <!-- Network I/O -->
          <div class="host-card">
            <div class="hc-head"><span>网络 I/O</span></div>
            <dl class="kv">
              <div><dt>↓ 接收</dt><dd>{{ fmtBps(hostVal('host.net.rx_bps')) }}</dd></div>
              <div><dt>↑ 发送</dt><dd>{{ fmtBps(hostVal('host.net.tx_bps')) }}</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <!-- charts -->
      <div class="chart-grid">
        <div class="card chart-card"><MetricChart title="网关 RTT (ms)" unit="ms" :samples="rtt" /></div>
        <div class="card chart-card">
          <MetricChart title="网关丢包率 (%)" unit="%" :samples="loss" color="#fbbf24" />
        </div>
      </div>

      <!-- reachability + dns -->
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head">
            <h3>公网可达性 (ICMP)</h3>
            <span class="count">{{ publicTargets().length }}</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>目标</th><th>RTT</th></tr></thead>
              <tbody>
                <tr v-if="!publicTargets().length"><td colspan="2" class="hint">无数据</td></tr>
                <tr v-for="s in publicTargets()" :key="s.target">
                  <td class="mono">{{ s.target }}</td>
                  <td>{{ s.value.toFixed(0) }} ms</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>DNS 解析</h3>
            <span class="count">{{ dnsTargets().length }}</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>域名</th><th>耗时</th></tr></thead>
              <tbody>
                <tr v-if="!dnsTargets().length"><td colspan="2" class="hint">无数据（去监控目标添加 DNS）</td></tr>
                <tr v-for="s in dnsTargets()" :key="s.target">
                  <td class="mono">{{ s.target }}</td>
                  <td>{{ s.value.toFixed(0) }} ms</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- http -->
      <section class="panel">
        <div class="panel-head">
          <h3>HTTP / HTTPS</h3>
          <span class="count">{{ httpRows().length }}</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>URL</th><th>状态码</th><th>耗时</th></tr></thead>
            <tbody>
              <tr v-if="!httpRows().length"><td colspan="3" class="hint">无数据（去监控目标添加 HTTP）</td></tr>
              <tr v-for="h in httpRows()" :key="h.url">
                <td class="mono">{{ h.url }}</td>
                <td>
                  <span class="badge" :class="h.status >= 200 && h.status < 400 ? 'up' : 'down'">{{ h.status }}</span>
                </td>
                <td>{{ h.lat.toFixed(0) }} ms</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ifaces + lan devices -->
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h3>接口状态</h3><span class="count">{{ latestIfaces().length }}</span></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>接口</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-if="!latestIfaces().length"><td colspan="2" class="hint">无数据</td></tr>
                <tr v-for="s in latestIfaces()" :key="s.target">
                  <td class="mono">{{ s.target }}</td>
                  <td>
                    <span class="badge" :class="s.value === 1 ? 'up' : 'down'">
                      <span class="dot" :class="s.value === 1 ? 'up' : 'down'"></span>
                      {{ s.value === 1 ? 'UP' : 'DOWN' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>局域网设备（ARP 发现）</h3><span class="count">{{ devices.length }}</span></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>IP</th><th>MAC</th></tr></thead>
              <tbody>
                <tr v-if="!devices.length"><td colspan="2" class="hint">尚未发现设备</td></tr>
                <tr v-for="d in devices" :key="d.mac">
                  <td class="mono">{{ d.ip }}</td>
                  <td class="mono">{{ d.mac }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- agent online/offline history -->
      <section class="panel">
        <div class="panel-head"><h3>Agent 在线/离线历史</h3><span class="count">{{ statusHistory.length }}</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>状态</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-if="!statusHistory.length"><td colspan="2" class="hint">暂无状态变更记录</td></tr>
              <tr v-for="(h, i) in statusHistory" :key="i">
                <td>
                  <span class="badge" :class="h.status === 'online' ? 'up' : 'down'">
                    <span class="dot" :class="h.status === 'online' ? 'up' : 'down'"></span>
                    {{ h.status === 'online' ? '上线' : '离线' }}
                  </span>
                </td>
                <td class="hint">{{ fmtTime(h.changed_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.picker {
  display: flex;
  align-items: center;
  gap: 10px;
}
.picker label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.picker select {
  max-width: 320px;
}

.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-bottom: 20px;
}
.chart-card {
  padding: 8px 6px 4px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
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

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 54px 20px;
}
.empty-ico {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  color: var(--primary);
  background: var(--primary-soft);
  margin-bottom: 6px;
}
.empty h3 {
  font-size: 17px;
}

/* host / system status */
.host-panel {
  margin-bottom: 20px;
}
.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.host-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
}
.hc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.hc-head b {
  font-size: 16px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.bar {
  height: 8px;
  border-radius: 6px;
  background: var(--surface);
  overflow: hidden;
}
.bar.sm {
  height: 5px;
}
.bar > span {
  display: block;
  height: 100%;
  border-radius: 6px;
  background: var(--primary);
  transition: width 0.4s ease;
}
.bar > span.is-good {
  background: #34d399;
}
.bar > span.is-warn {
  background: #fbbf24;
}
.bar > span.is-bad {
  background: #f87171;
}
.cores {
  display: grid;
  gap: 5px;
  margin-top: 10px;
}
.core {
  display: grid;
  grid-template-columns: 46px 1fr 40px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
.core-val {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.kv {
  display: grid;
  gap: 6px;
  margin: 0;
}
.kv > div {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.kv dt {
  color: var(--text-muted);
}
.kv dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.disk {
  margin-bottom: 10px;
}
.disk-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 4px;
}
.disk-foot {
  margin-top: 4px;
  font-size: 11px;
}
.btn.ghost.sm {
  font-size: 12px;
  padding: 4px 10px;
}

@media (max-width: 860px) {
  .chart-grid,
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
