<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { api, type Rule } from '../api'

const templates = ref<Rule[]>([])
const error = ref('')
const savedId = ref('')

const METRICS = [
  'probe.icmp.loss_pct', 'probe.icmp.rtt_ms',
  'probe.dns.ok', 'probe.dns.resolve_ms',
  'probe.http.ok', 'probe.http.status', 'probe.http.latency_ms',
]

// Infer the §4 diagnostic layer from the metric so applied templates carry the
// right layer instead of always defaulting to internet.
function layerForMetric(metric: string): string {
  if (metric.startsWith('probe.dns')) return 'dns'
  if (metric.startsWith('probe.http')) return 'service'
  return 'internet'
}

const draft = reactive<Partial<Rule>>({
  name: '', metric_kind: 'probe.icmp.loss_pct', comparator: 'gte',
  threshold: 50, fail_threshold: 3, severity: 'error',
})

async function load() {
  try {
    templates.value = await api.ruleTemplates()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function addTemplate() {
  if (!draft.name) return
  error.value = ''
  try {
    await api.createTemplate({ ...draft, layer: layerForMetric(draft.metric_kind || ''), channel_ids: [] })
    draft.name = ''
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function saveRow(t: Rule) {
  await api.updateTemplate(t.id, {
    name: t.name, metric_kind: t.metric_kind, comparator: t.comparator,
    threshold: Number(t.threshold), fail_threshold: Number(t.fail_threshold),
    for_seconds: Number(t.for_seconds), layer: layerForMetric(t.metric_kind), severity: t.severity,
    channel_ids: t.channel_ids || [], enabled: t.enabled,
  })
  savedId.value = t.id
  setTimeout(() => (savedId.value = ''), 1500)
}
async function removeRow(t: Rule) {
  if (!confirm(`删除模板「${t.name}」？`)) return
  await api.deleteTemplate(t.id)
  await load()
}
onMounted(load)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>报警模板</h2>
      <p class="sub">预置的报警规则模板，可在「监控目标」中一键套用到具体目标。修改模板不影响已套用的规则。</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head"><h3>新建模板</h3></div>
      <div class="panel-body">
        <div class="row field-row wrap">
          <input v-model="draft.name" placeholder="模板名称，如「公网不可达」" />
          <select v-model="draft.metric_kind">
            <option v-for="m in METRICS" :key="m" :value="m">{{ m }}</option>
          </select>
          <select v-model="draft.comparator" class="cmp">
            <option value="gt">&gt;</option><option value="gte">&ge;</option>
            <option value="lt">&lt;</option><option value="lte">&le;</option><option value="eq">=</option>
          </select>
          <input type="number" step="any" v-model="draft.threshold" class="num" placeholder="阈值" />
          <label class="inline">连续失败 <input type="number" v-model="draft.fail_threshold" class="num sm" /> 次</label>
          <select v-model="draft.severity">
            <option value="info">info</option><option value="warn">warn</option>
            <option value="error">error</option><option value="critical">critical</option>
          </select>
          <button class="btn btn-primary" @click="addTemplate">添加模板</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>模板</h3><span class="count">{{ templates.length }}</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>名称</th><th>指标</th><th>比较</th><th>阈值</th><th>连续失败</th><th>严重级</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!templates.length"><td colspan="7" class="hint">暂无模板</td></tr>
            <tr v-for="t in templates" :key="t.id">
              <td><input v-model="t.name" class="target-in" /></td>
              <td>
                <select v-model="t.metric_kind">
                  <option v-for="m in METRICS" :key="m" :value="m">{{ m }}</option>
                </select>
              </td>
              <td>
                <select v-model="t.comparator" class="cmp">
                  <option value="gt">&gt;</option><option value="gte">&ge;</option>
                  <option value="lt">&lt;</option><option value="lte">&le;</option><option value="eq">=</option>
                </select>
              </td>
              <td><input type="number" step="any" v-model="t.threshold" class="num" /></td>
              <td><input type="number" v-model="t.fail_threshold" class="num sm" /></td>
              <td>
                <select v-model="t.severity">
                  <option value="info">info</option><option value="warn">warn</option>
                  <option value="error">error</option><option value="critical">critical</option>
                </select>
              </td>
              <td class="nowrap">
                <button class="link-btn" @click="saveRow(t)">保存</button>
                <span v-if="savedId === t.id" class="ok">✓</span>
                <button class="link-btn danger" @click="removeRow(t)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
}
.panel-body {
  padding: 16px 18px;
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
.field-row.wrap {
  flex-wrap: wrap;
  gap: 10px;
}
.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.cmp {
  padding: 6px 8px;
}
.num {
  width: 84px;
  padding: 6px 8px;
}
.num.sm {
  width: 60px;
}
.target-in {
  min-width: 140px;
}
.nowrap {
  white-space: nowrap;
}
.ok {
  margin: 0 6px;
}
</style>
