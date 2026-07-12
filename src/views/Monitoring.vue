<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type ProbeTarget, type AgentGroup } from '../api'

const { t: tr } = useI18n()

const SITE = 'site_default'
const targets = ref<ProbeTarget[]>([])
const groups = ref<AgentGroup[]>([])
const error = ref('')
const busy = ref(false)

async function load() {
  try {
    ;[targets.value, groups.value] = await Promise.all([api.listTargets(SITE), api.agentGroups(SITE)])
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// Scope column: broadcast targets show "all agents"; group-scoped targets list
// their group names (applies to probes' downlink and host alerts alike).
function scopeLabel(t: ProbeTarget): string {
  if (t.all_agents) return tr('monitoring.scopeAll')
  const names = (t.group_ids || []).map((id) => groups.value.find((g) => g.id === id)?.name).filter(Boolean)
  return names.length ? names.join(', ') : tr('monitoring.scopeNone')
}

// Human label for a target's type, folding the http keyword variant into its own
// name (mirrors the form's type dropdown).
function typeLabel(t: ProbeTarget): string {
  if (t.kind === 'icmp') return tr('mform.typeIcmp')
  if (t.kind === 'tcp') return tr('mform.typeTcp')
  if (t.kind === 'dns') return tr('mform.typeDns')
  if (t.kind === 'host') return tr('mform.typeHost')
  if (t.kind === 'http') return tr('mform.typeHttp')
  return t.kind.toUpperCase()
}

// Host anchors carry a metric-series string as their target ("host" for the
// whole machine, a mount point for disk); show the whole-machine one as a label.
function targetLabel(t: ProbeTarget): string {
  if (t.kind === 'host' && t.target === 'host') return tr('monitoring.hostWhole')
  return t.target
}

async function removeTarget(t: ProbeTarget) {
  if (!t.id) return
  if (!confirm(tr('common.delete') + ' ' + (t.name || t.target) + ' ?')) return
  busy.value = true
  error.value = ''
  try {
    const rest = targets.value.filter((x) => x.id && x.id !== t.id)
    await api.setTargets(SITE, rest)
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
  if (!confirm(tr('monitoring.confirmClearHistory', { name: purgeTgt.value }))) return
  purgeMsg.value = ''
  try {
    const r = await api.purgeTarget(SITE, purgeTgt.value)
    purgeMsg.value = tr('monitoring.purgedMsg', { count: r.purged_series })
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
      <h2>{{ tr('monitoring.title') }}</h2>
      <p class="sub">{{ tr('monitoring.sub') }}</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ tr('monitoring.probeTargets') }}</h3>
        <span class="count">{{ targets.length }}</span>
        <router-link to="/monitoring/new-host" class="btn head-btn">{{ tr('monitoring.newHostMonitor') }}</router-link>
        <router-link to="/monitoring/new" class="btn btn-primary">{{ tr('monitoring.newMonitor') }}</router-link>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ tr('monitoring.thName') }}</th>
              <th>{{ tr('monitoring.thType') }}</th>
              <th>{{ tr('monitoring.thTarget') }}</th>
              <th>{{ tr('monitoring.thScope') }}</th>
              <th class="center">{{ tr('monitoring.thEnabled') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in targets" :key="t.id">
              <td>{{ t.name || tr('monitoring.unnamed') }}</td>
              <td>{{ typeLabel(t) }}</td>
              <td class="mono">{{ targetLabel(t) }}<span v-if="t.kind === 'tcp' && t.params?.port">:{{ t.params.port }}</span></td>
              <td class="scope">{{ scopeLabel(t) }}</td>
              <td class="center"><span :class="['dot', t.enabled ? 'on' : 'off']"></span></td>
              <td class="actions">
                <router-link :to="`/monitoring/${t.id}/edit`" class="link-btn">{{ tr('monitoring.editMonitor') }}</router-link>
                <button class="link-btn danger" :disabled="busy" @click="removeTarget(t)">{{ tr('common.delete') }}</button>
              </td>
            </tr>
            <tr v-if="!targets.length"><td colspan="6" class="hint">{{ tr('monitoring.noTargets') }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel danger-zone">
      <div class="panel-head">
        <h3>{{ tr('monitoring.clearHistory') }}</h3>
        <span class="tag-danger">{{ tr('monitoring.dangerOp') }}</span>
      </div>
      <div class="panel-body">
        <p class="hint">{{ tr('monitoring.clearHistoryHint') }}</p>
        <div class="row">
          <input v-model="purgeTgt" :placeholder="tr('monitoring.purgePlaceholder')" class="purge-in" />
          <button class="btn btn-danger" @click="purge">{{ tr('monitoring.clearTargetHistory') }}</button>
          <span v-if="purgeMsg" class="ok">{{ purgeMsg }}</span>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page { max-width: 960px; }
.panel { margin-bottom: 20px; }
.table-wrap { overflow-x: auto; }
.count {
  min-width: 22px; padding: 1px 9px; border-radius: var(--radius-pill);
  font-size: 12px; font-weight: 600; color: var(--text-dim);
  background: var(--surface-2); border: 1px solid var(--border); text-align: center;
}
.head-btn { margin-left: auto; margin-right: 8px; }
.mono { font-family: var(--font-mono, monospace); font-size: 12.5px; }
.scope { font-size: 12.5px; color: var(--text-dim); }
.actions { display: flex; gap: 10px; justify-content: flex-end; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
.dot.on { background: var(--ok, #34d399); }
.dot.off { background: var(--border); }
.purge-in { min-width: 280px; flex: 1; }
.panel-body { padding: 14px 18px; }
.danger-zone { border-color: rgba(248, 113, 113, 0.28); }
.tag-danger {
  margin-left: auto; padding: 2px 10px; border-radius: var(--radius-pill);
  font-size: 11.5px; font-weight: 600; color: var(--danger);
  background: var(--danger-soft); border: 1px solid rgba(248, 113, 113, 0.3);
}
</style>
