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
  <main class="page">
    <div class="page-head">
      <h2>监控目标</h2>
      <p class="sub">这些目标会自动下发到该站点的所有 agent（agent 端无需任何配置）。保存后配置版本 +1，agent 下次上报时应用。</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head"><h3>探测目标</h3><span class="count">{{ targets.length }}</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>类型</th><th>目标</th><th>频率档</th><th class="center">启用</th><th></th></tr>
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
            <tr v-if="!targets.length"><td colspan="5" class="hint">暂无目标，点击下方添加。</td></tr>
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
  max-width: 860px;
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
