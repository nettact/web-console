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
function placeholderFor(kind: string): string {
  if (kind === 'dns') return 'example.com'
  if (kind === 'http') return 'https://example.com'
  return '1.1.1.1'
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
            <select v-model="t.kind">
              <option value="icmp">ICMP</option>
              <option value="dns">DNS</option>
              <option value="http">HTTP</option>
            </select>
          </td>
          <td><input v-model="t.target" :placeholder="placeholderFor(t.kind)" /></td>
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

    <h3 class="danger-h">清除历史数据（按目标回收空间）</h3>
    <p class="hint">删除某个目标的全部历史样本与聚合，立即释放空间（不影响正在下发的监控配置）。</p>
    <div class="row">
      <input v-model="purgeTgt" placeholder="目标，如 192.0.2.1 / example.com" />
      <button class="danger-btn" @click="purge">清除该目标历史</button>
      <span v-if="purgeMsg" class="ok">{{ purgeMsg }}</span>
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
.danger-h {
  margin-top: 28px;
  color: #c0392b;
}
.danger-btn {
  background: #c0392b;
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}
</style>
