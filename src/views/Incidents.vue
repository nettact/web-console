<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type Incident, type TimelineEntry, type Alert } from '../api'
import { toDateLocale } from '../i18n'

const { t, te, locale } = useI18n()
const route = useRoute()

const incidents = ref<Incident[]>([])
const alerts = ref<Alert[]>([])
const selected = ref<string>('')
const timeline = ref<TimelineEntry[]>([])
const error = ref('')
let timer: number | undefined

const layerLabel = (l: string) => {
  const key = `incidents.layer.${l}`
  return l && te(key) ? t(key) : l || '—'
}
// Severity + timeline-kind are raw server codes; localize them for display.
const sevLabel = (s: string) => (s && te(`mform.sev_${s}`) ? t(`mform.sev_${s}`) : s || '—')
const kindLabel = (k: string) => (k && te(`incidents.kind.${k}`) ? t(`incidents.kind.${k}`) : k)
const fmtTime = (s: string) => new Date(s).toLocaleTimeString(toDateLocale(locale.value))
const fmtDateTime = (s: string) => new Date(s).toLocaleString(toDateLocale(locale.value))

async function load() {
  try {
    ;[incidents.value, alerts.value] = await Promise.all([api.incidents(), api.alerts()])
    if (selected.value) timeline.value = await api.timeline(selected.value)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function select(id: string) {
  selected.value = id
  timeline.value = await api.timeline(id)
}
onMounted(async () => {
  // Deep link from a notification: ?incident=<id> auto-opens that incident's
  // timeline. Setting selected before load() makes load() fetch the timeline too.
  const deep = route.query.incident
  if (typeof deep === 'string' && deep) selected.value = deep
  await load()
  timer = window.setInterval(load, 5000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ t('incidents.title') }}</h2>
      <p class="sub">{{ t('incidents.sub') }}</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ t('incidents.activeAlerts') }}</h3>
        <span class="count" :class="{ hot: alerts.length }">{{ alerts.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>{{ t('incidents.thRule') }}</th><th>{{ t('incidents.thAgent') }}</th><th>{{ t('incidents.thTarget') }}</th><th>{{ t('incidents.thLayer') }}</th><th>{{ t('incidents.thValue') }}</th><th>{{ t('incidents.thStart') }}</th></tr></thead>
          <tbody>
            <tr v-if="!alerts.length"><td colspan="6" class="hint">{{ t('incidents.noActiveAlerts') }}</td></tr>
            <tr v-for="a in alerts" :key="a.id">
              <td>{{ a.rule_name }}</td>
              <td class="mono">{{ a.agent_id.slice(0, 14) }}…</td>
              <td>{{ a.target }}</td>
              <td><span class="badge neutral">{{ layerLabel(a.layer) }}</span></td>
              <td>{{ a.value.toFixed(1) }}</td>
              <td class="hint">{{ fmtTime(a.started_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ t('incidents.incidents') }}</h3>
        <span class="count">{{ incidents.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>{{ t('incidents.thState') }}</th><th>{{ t('incidents.thSuspectedLayer') }}</th><th>{{ t('incidents.thSeverity') }}</th><th>{{ t('incidents.thSummary') }}</th><th>{{ t('incidents.thStartTime') }}</th></tr></thead>
          <tbody>
            <tr v-if="!incidents.length"><td colspan="5" class="hint">{{ t('incidents.noIncidents') }}</td></tr>
            <tr v-for="i in incidents" :key="i.id" class="clickable" :class="{ selected: i.id === selected }"
              @click="select(i.id)">
              <td>
                <span class="badge" :class="i.state">
                  <span class="dot" :class="i.state === 'open' ? 'down' : 'up'"></span>
                  {{ i.state === 'open' ? t('incidents.stateOpen') : t('incidents.stateResolved') }}
                </span>
              </td>
              <td>{{ layerLabel(i.suspected_layer) }}</td>
              <td><span class="badge sev" :class="i.severity">{{ sevLabel(i.severity) }}</span></td>
              <td>{{ i.summary }}</td>
              <td class="hint">{{ fmtDateTime(i.opened_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="selected" class="panel">
      <div class="panel-head"><h3>{{ t('incidents.timeline') }}</h3></div>
      <div class="panel-body">
        <ul class="timeline">
          <li v-if="!timeline.length" class="hint">{{ t('incidents.noRecords') }}</li>
          <li v-for="(entry, idx) in timeline" :key="idx">
            <span class="node"></span>
            <span class="ts">{{ fmtTime(entry.ts) }}</span>
            <span class="kind">{{ kindLabel(entry.kind) }}</span>
            <span class="msg">{{ entry.message }}</span>
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>

<style scoped>
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
.count.hot {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: rgba(248, 113, 113, 0.3);
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 6px 12px;
}
.timeline li {
  display: flex;
  align-items: baseline;
  gap: 12px;
  position: relative;
  padding: 9px 0 9px 20px;
}
.timeline li:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 20px;
  bottom: -4px;
  width: 1px;
  background: var(--border-strong);
}
.timeline .node {
  position: absolute;
  left: 0;
  top: 13px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 8px var(--primary-glow);
}
.timeline .ts {
  color: var(--text-muted);
  min-width: 84px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.timeline .kind {
  font-family: var(--mono);
  font-size: 12px;
  min-width: 130px;
  color: var(--primary);
}
.timeline .msg {
  color: var(--text-dim);
}
</style>
