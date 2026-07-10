<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type ProbeTarget } from '../api'

const SITE = 'site_default'
const targets = ref<ProbeTarget[]>([])
const error = ref('')
const saved = ref(false)
const busy = ref(false)

async function load() {
  try {
    targets.value = await api.listTargets(SITE)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
function addRow() {
  targets.value.push({ kind: 'icmp', target: '', tier: 'base', enabled: true })
}
function removeRow(i: number) {
  targets.value.splice(i, 1)
}
async function save() {
  busy.value = true
  saved.value = false
  error.value = ''
  try {
    const clean = targets.value.filter((t) => t.target.trim() !== '')
    await api.setTargets(SITE, clean)
    saved.value = true
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <main>
    <h2>监控目标</h2>
    <p class="hint">这些目标会自动下发到该站点的所有 agent（agent 端无需任何配置）。保存后配置版本 +1，agent 下次上报时应用。</p>
    <p v-if="error" class="err">{{ error }}</p>

    <table>
      <thead>
        <tr><th>类型</th><th>目标</th><th>频率档</th><th>启用</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="(t, i) in targets" :key="i">
          <td>
            <select v-model="t.kind"><option value="icmp">ICMP</option></select>
          </td>
          <td><input v-model="t.target" placeholder="1.1.1.1 / example.com" /></td>
          <td>
            <select v-model="t.tier"><option value="base">base</option><option value="regular">regular</option></select>
          </td>
          <td class="center"><input type="checkbox" v-model="t.enabled" /></td>
          <td><button class="link" @click="removeRow(i)">删除</button></td>
        </tr>
        <tr v-if="!targets.length"><td colspan="5" class="hint">暂无目标，点击下方添加。</td></tr>
      </tbody>
    </table>

    <div class="row">
      <button @click="addRow">+ 添加目标</button>
      <button class="primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存并下发' }}</button>
      <span v-if="saved" class="ok">已保存，已推送到 agent</span>
    </div>
  </main>
</template>

<style scoped>
main {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px;
}
.hint {
  color: #888;
}
.err {
  color: #c0392b;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}
th,
td {
  border: 1px solid rgba(128, 128, 128, 0.3);
  padding: 6px 10px;
  text-align: left;
}
.center {
  text-align: center;
}
input,
select {
  padding: 4px 6px;
}
.row {
  display: flex;
  gap: 12px;
  align-items: center;
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
  color: #c0392b;
  cursor: pointer;
}
.ok {
  color: #2e7d32;
}
</style>
