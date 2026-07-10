<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type Rule } from '../api'

const rules = ref<Rule[]>([])
const error = ref('')
const savedId = ref('')

const LAYERS: Record<string, string> = {
  local: '本机', lan: '局域网', wan: 'WAN', internet: '互联网', dns: 'DNS', service: '服务', wireless: '无线',
}
const layerLabel = (l: string) => LAYERS[l] || l || '—'

async function load() {
  try {
    rules.value = await api.rules()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function toggle(r: Rule) {
  await api.updateRule(r.id, { enabled: !r.enabled })
  await load()
}
async function saveThreshold(r: Rule) {
  await api.updateRule(r.id, {
    comparator: r.comparator,
    threshold: Number(r.threshold),
    for_seconds: Number(r.for_seconds),
  })
  savedId.value = r.id
  setTimeout(() => (savedId.value = ''), 1500)
}
onMounted(load)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>告警规则</h2>
      <p class="sub">阈值规则驱动 §4 分层诊断（网关 / WAN / DNS / 服务）。修改后即时生效。</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head"><h3>规则</h3><span class="count">{{ rules.length }}</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>规则</th><th>指标</th><th>目标</th><th>比较</th><th>阈值</th><th>持续(s)</th><th>层</th>
              <th class="center">启用</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!rules.length"><td colspan="9" class="hint">无规则</td></tr>
            <tr v-for="r in rules" :key="r.id">
              <td>{{ r.name }}</td>
              <td class="mono">{{ r.metric_kind }}</td>
              <td class="mono">{{ r.target_glob }}</td>
              <td>
                <select v-model="r.comparator" class="cmp">
                  <option value="gt">&gt;</option><option value="gte">&ge;</option>
                  <option value="lt">&lt;</option><option value="lte">&le;</option><option value="eq">=</option>
                </select>
              </td>
              <td><input type="number" step="any" v-model="r.threshold" class="num" /></td>
              <td><input type="number" v-model="r.for_seconds" class="num sm" /></td>
              <td><span class="badge neutral">{{ layerLabel(r.layer) }}</span></td>
              <td class="center"><input type="checkbox" :checked="r.enabled" @change="toggle(r)" /></td>
              <td class="nowrap">
                <button class="link-btn" @click="saveThreshold(r)">保存</button>
                <span v-if="savedId === r.id" class="ok">✓</span>
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
.cmp {
  padding: 6px 8px;
}
.num {
  width: 84px;
  padding: 6px 8px;
}
.num.sm {
  width: 68px;
}
.nowrap {
  white-space: nowrap;
}
.ok {
  margin-left: 6px;
}
</style>
