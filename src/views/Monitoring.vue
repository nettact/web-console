<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { api, type ProbeTarget, type ProbeParams, type Rule, type Channel } from '../api'

const SITE = 'site_default'
const targets = ref<ProbeTarget[]>([])
const error = ref('')
const saved = ref(false)
const busy = ref(false)

const expanded = reactive<Record<string, boolean>>({})
const rulesByTarget = reactive<Record<string, Rule[]>>({})
const templates = ref<Rule[]>([])
const channels = ref<Channel[]>([])
const applySel = reactive<Record<string, string>>({}) // probeTaskId -> selected templateId

const METRICS = [
  'probe.icmp.loss_pct', 'probe.icmp.rtt_ms',
  'probe.dns.ok', 'probe.dns.resolve_ms',
  'probe.http.ok', 'probe.http.status', 'probe.http.latency_ms',
]

async function load() {
  try {
    ;[targets.value, templates.value, channels.value] = await Promise.all([
      api.listTargets(SITE), api.ruleTemplates(), api.channels(),
    ])
    targets.value.forEach((t) => {
      if (!t.params) t.params = {}
    })
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
function addRow() {
  targets.value.push({ kind: 'icmp', target: '', tier: 'base', params: {}, enabled: true })
}
function placeholderFor(kind: string): string {
  if (kind === 'dns') return 'example.com'
  if (kind === 'http') return 'https://example.com'
  return '1.1.1.1'
}
function removeRow(i: number) {
  targets.value.splice(i, 1)
}
// cleanParams drops blank/NaN fields so the Go API never receives "" for an int
// field (which fails JSON decode). A cleared numeric input reverts to default.
function cleanParams(p: Record<string, unknown> | undefined): ProbeParams {
  const out: Record<string, unknown> = {}
  if (p) {
    for (const [k, v] of Object.entries(p)) {
      if (v === '' || v === null || v === undefined) continue
      if (typeof v === 'number' && Number.isNaN(v)) continue
      out[k] = v
    }
  }
  return out as ProbeParams
}
async function save() {
  busy.value = true
  saved.value = false
  error.value = ''
  try {
    const clean = targets.value
      .filter((t) => t.target.trim() !== '')
      .map((t) => ({ ...t, params: cleanParams(t.params) }))
    await api.setTargets(SITE, clean)
    saved.value = true
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}
// Diagnostic layer inferred from the target kind, so fired alerts carry a
// meaningful §4 layer instead of an empty/generic one.
function layerForKind(kind: string): string {
  return kind === 'dns' ? 'dns' : kind === 'http' ? 'service' : 'internet'
}

async function toggleExpand(t: ProbeTarget) {
  if (!t.id) {
    error.value = '请先保存目标，然后再配置报警规则'
    return
  }
  expanded[t.id] = !expanded[t.id]
  if (expanded[t.id] && !rulesByTarget[t.id]) {
    rulesByTarget[t.id] = await api.targetRules(t.id)
  }
}
async function reloadRules(id: string) {
  rulesByTarget[id] = await api.targetRules(id)
}
async function addRule(t: ProbeTarget) {
  if (!t.id) return
  const metric = t.kind === 'dns' ? 'probe.dns.ok' : t.kind === 'http' ? 'probe.http.ok' : 'probe.icmp.loss_pct'
  const cmp = metric.endsWith('.ok') ? 'lt' : 'gte'
  const threshold = metric.endsWith('.ok') ? 1 : 50
  try {
    await api.createTargetRule(t.id, {
      name: `${t.target} 报警`, metric_kind: metric, comparator: cmp,
      threshold, fail_threshold: 3, severity: 'error', layer: layerForKind(t.kind), channel_ids: [],
    })
    await reloadRules(t.id)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function applyTpl(t: ProbeTarget) {
  if (!t.id || !applySel[t.id]) return
  try {
    await api.applyTemplate(t.id, applySel[t.id])
    applySel[t.id] = ''
    await reloadRules(t.id)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function saveRule(r: Rule, tid: string) {
  await api.updateRule(r.id, {
    name: r.name, metric_kind: r.metric_kind, comparator: r.comparator,
    threshold: Number(r.threshold), fail_threshold: Number(r.fail_threshold),
    for_seconds: Number(r.for_seconds || 0), layer: r.layer, severity: r.severity,
    channel_ids: r.channel_ids || [], enabled: r.enabled,
  })
  await reloadRules(tid)
}
async function delRule(r: Rule, tid: string) {
  await api.deleteRule(r.id)
  await reloadRules(tid)
}
function toggleChannel(r: Rule, id: string) {
  const ids = r.channel_ids || (r.channel_ids = [])
  const i = ids.indexOf(id)
  if (i >= 0) ids.splice(i, 1)
  else ids.push(id)
}
function channelLabel(c: Channel): string {
  return c.name || (c.type === 'webhook' ? c.config.url : c.config.to) || c.type
}

const purgeTgt = ref('')
const purgeMsg = ref('')
async function purge() {
  if (!purgeTgt.value) return
  if (!confirm(`确认删除目标「${purgeTgt.value}」的全部历史数据（不可恢复）？`)) return
  purgeMsg.value = ''
  try {
    const r = await api.purgeTarget(SITE, purgeTgt.value)
    purgeMsg.value = `已清除 ${r.purged_series} 条 series 的历史`
    purgeTgt.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
onMounted(load)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>监控目标</h2>
      <p class="sub">目标自动下发到该站点所有 agent。每个目标可按协议精细配置，并单独设置报警规则（连续失败 N 次触发）。</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head"><h3>探测目标</h3><span class="count">{{ targets.length }}</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th></th><th>类型</th><th>目标</th><th>频率档</th><th class="center">启用</th><th></th></tr>
          </thead>
          <tbody>
            <template v-for="(t, i) in targets" :key="t.id || i">
              <tr>
                <td class="center">
                  <button class="link-btn" @click="toggleExpand(t)" :title="t.id ? '配置' : '先保存'">
                    {{ t.id && expanded[t.id] ? '▾' : '▸' }}
                  </button>
                </td>
                <td>
                  <select v-model="t.kind">
                    <option value="icmp">ICMP</option>
                    <option value="dns">DNS</option>
                    <option value="http">HTTP</option>
                  </select>
                </td>
                <td><input class="target-in" v-model="t.target" :placeholder="placeholderFor(t.kind)" /></td>
                <td>
                  <select v-model="t.tier">
                    <option value="base">base</option>
                    <option value="regular">regular</option>
                  </select>
                </td>
                <td class="center"><input type="checkbox" v-model="t.enabled" /></td>
                <td><button class="link-btn danger" @click="removeRow(i)">删除</button></td>
              </tr>
              <tr v-if="t.id && expanded[t.id]" class="expand-row">
                <td></td>
                <td colspan="5">
                  <!-- protocol params -->
                  <div class="sub-block">
                    <div class="sub-title">协议参数</div>
                    <div class="params">
                      <label>检查间隔(s)<input type="number" v-model.number="t.params!.interval_seconds" class="num sm" placeholder="默认" /></label>
                      <label>超时(ms)<input type="number" v-model.number="t.params!.timeout_ms" class="num sm" placeholder="默认" /></label>
                      <template v-if="t.kind === 'icmp'">
                        <label>包大小(字节)<input type="number" v-model.number="t.params!.packet_size" class="num sm" placeholder="默认" /></label>
                        <label>重试次数<input type="number" v-model.number="t.params!.retries" class="num sm" placeholder="0" /></label>
                      </template>
                      <template v-else-if="t.kind === 'dns'">
                        <label>记录类型
                          <select v-model="t.params!.record_type"><option value="">A/AAAA</option><option value="A">A</option><option value="AAAA">AAAA</option></select>
                        </label>
                      </template>
                      <template v-else-if="t.kind === 'http'">
                        <label>方法
                          <select v-model="t.params!.method"><option value="">GET</option><option value="GET">GET</option><option value="HEAD">HEAD</option></select>
                        </label>
                        <label>期望状态码<input type="number" v-model.number="t.params!.expected_status" class="num sm" placeholder="2xx" /></label>
                      </template>
                    </div>
                    <p class="hint tiny">改动协议参数后，点上方「保存并下发」生效。</p>
                  </div>

                  <!-- per-target alarm rules -->
                  <div class="sub-block">
                    <div class="sub-title">
                      报警规则
                      <span class="apply">
                        <select v-model="applySel[t.id]">
                          <option value="">套用模板…</option>
                          <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
                        </select>
                        <button class="link-btn" @click="applyTpl(t)" :disabled="!applySel[t.id]">套用</button>
                        <button class="link-btn" @click="addRule(t)">+ 新建规则</button>
                      </span>
                    </div>
                    <div v-if="!(rulesByTarget[t.id]?.length)" class="hint tiny">暂无报警规则。</div>
                    <div v-for="r in rulesByTarget[t.id]" :key="r.id" class="rule-card">
                      <div class="rule-line">
                        <input v-model="r.name" class="rule-name" />
                        <select v-model="r.metric_kind"><option v-for="m in METRICS" :key="m" :value="m">{{ m }}</option></select>
                        <select v-model="r.comparator" class="cmp">
                          <option value="gt">&gt;</option><option value="gte">&ge;</option>
                          <option value="lt">&lt;</option><option value="lte">&le;</option><option value="eq">=</option>
                        </select>
                        <input type="number" step="any" v-model="r.threshold" class="num" />
                        <label class="inline">连续<input type="number" v-model="r.fail_threshold" class="num sm" />次</label>
                        <select v-model="r.severity">
                          <option value="info">info</option><option value="warn">warn</option>
                          <option value="error">error</option><option value="critical">critical</option>
                        </select>
                        <label class="inline"><input type="checkbox" v-model="r.enabled" />启用</label>
                      </div>
                      <div class="rule-line channels">
                        <span class="chan-label">通知渠道：</span>
                        <span v-if="!channels.length" class="hint tiny">未配置渠道（去「设置」添加）</span>
                        <label v-for="c in channels" :key="c.id" class="chan">
                          <input type="checkbox" :checked="(r.channel_ids || []).includes(c.id)" @change="toggleChannel(r, c.id)" />
                          {{ channelLabel(c) }}
                        </label>
                        <span class="spacer"></span>
                        <button class="link-btn" @click="saveRule(r, t.id!)">保存</button>
                        <button class="link-btn danger" @click="delRule(r, t.id!)">删除</button>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!targets.length"><td colspan="6" class="hint">暂无目标，点击下方添加。</td></tr>
          </tbody>
        </table>
      </div>
      <div class="panel-foot">
        <button class="btn" @click="addRow">+ 添加目标</button>
        <button class="btn btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存并下发' }}</button>
        <span v-if="saved" class="ok">✓ 已保存，已推送到 agent</span>
      </div>
    </section>

    <section class="panel danger-zone">
      <div class="panel-head">
        <h3>清除历史数据</h3>
        <span class="tag-danger">危险操作</span>
      </div>
      <div class="panel-body">
        <p class="hint">删除某个目标的全部历史样本与聚合，立即释放空间（不影响正在下发的监控配置）。此操作不可恢复。</p>
        <div class="row">
          <input v-model="purgeTgt" placeholder="目标，如 192.0.2.1 / example.com" class="purge-in" />
          <button class="btn btn-danger" @click="purge">清除该目标历史</button>
          <span v-if="purgeMsg" class="ok">{{ purgeMsg }}</span>
        </div>
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
.target-in {
  width: 100%;
  min-width: 180px;
}
.expand-row td {
  background: var(--surface-2);
}
.sub-block {
  padding: 10px 4px 14px;
}
.sub-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 10px;
}
.sub-title .apply {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  margin-left: auto;
}
.params {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.params label,
.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.rule-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--surface);
}
.rule-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.rule-line.channels {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
.rule-name {
  min-width: 130px;
}
.chan-label {
  font-size: 12.5px;
  color: var(--text-dim);
}
.chan {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font-size: 12.5px;
}
.spacer {
  flex: 1;
}
.cmp {
  padding: 6px 8px;
}
.num {
  width: 80px;
  padding: 6px 8px;
}
.num.sm {
  width: 62px;
}
.tiny {
  font-size: 11.5px;
  margin: 6px 0 0;
}
.purge-in {
  min-width: 280px;
  flex: 1;
}
.panel-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
}
.danger-zone {
  border-color: rgba(248, 113, 113, 0.28);
}
.tag-danger {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid rgba(248, 113, 113, 0.3);
}
</style>
