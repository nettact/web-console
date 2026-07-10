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
  <main>
    <h2>告警规则</h2>
    <p class="hint">阈值规则驱动 §4 分层诊断（网关 / WAN / DNS / 服务）。修改后即时生效。</p>
    <p v-if="error" class="err">{{ error }}</p>

    <table>
      <thead>
        <tr>
          <th>规则</th><th>指标</th><th>目标</th><th>比较</th><th>阈值</th><th>持续(s)</th><th>层</th><th>启用</th><th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!rules.length"><td colspan="9" class="hint">无规则</td></tr>
        <tr v-for="r in rules" :key="r.id">
          <td>{{ r.name }}</td>
          <td class="mono">{{ r.metric_kind }}</td>
          <td class="mono">{{ r.target_glob }}</td>
          <td>
            <select v-model="r.comparator">
              <option value="gt">&gt;</option><option value="gte">&ge;</option>
              <option value="lt">&lt;</option><option value="lte">&le;</option><option value="eq">=</option>
            </select>
          </td>
          <td><input type="number" step="any" v-model="r.threshold" class="num" /></td>
          <td><input type="number" v-model="r.for_seconds" class="num sm" /></td>
          <td>{{ layerLabel(r.layer) }}</td>
          <td class="center"><input type="checkbox" :checked="r.enabled" @change="toggle(r)" /></td>
          <td>
            <button class="link" @click="saveThreshold(r)">保存</button>
            <span v-if="savedId === r.id" class="ok">✓</span>
          </td>
        </tr>
      </tbody>
    </table>
  </main>
</template>

<style scoped>
main {
  max-width: 960px;
  margin: 0 auto;
  padding: 20px;
}
.hint {
  color: #888;
}
.err {
  color: #c0392b;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  border: 1px solid rgba(128, 128, 128, 0.3);
  padding: 5px 10px;
  text-align: left;
}
.center {
  text-align: center;
}
.num {
  width: 72px;
}
.num.sm {
  width: 56px;
}
.link {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
}
.ok {
  color: #2e7d32;
  margin-left: 4px;
}
</style>
