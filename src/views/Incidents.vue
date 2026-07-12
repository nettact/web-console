<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
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
// Active-alert row: who fired (agent hostname, falling back to a short id) and
// why (server-rendered fault description in the current language).
const agentLabel = (a: Alert) => a.agent_host || a.agent_id.slice(0, 14) + '…'
const alertReason = (a: Alert) => (locale.value === 'en' ? a.desc_en : a.desc_zh) || a.target
const fmtTime = (s: string) => new Date(s).toLocaleTimeString(toDateLocale(locale.value))
const fmtDateTime = (s: string) => new Date(s).toLocaleString(toDateLocale(locale.value))

// ---- incidents list pagination (server-side) ----
const PAGE_SIZES = [15, 30, 50, 100]
const pageSize = ref(15)
const page = ref(1)
const total = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
function goPage(p: number) {
  const np = Math.min(Math.max(1, p), totalPages.value)
  if (np !== page.value) {
    page.value = np
    load()
  }
}
function onPageSize() {
  page.value = 1
  load()
}

// ---- timeline drawer ----
const selectedIncident = computed(() => incidents.value.find((i) => i.id === selected.value) || null)
function closeTimeline() {
  selected.value = ''
  timeline.value = []
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeTimeline()
}

async function load() {
  try {
    const [res, al] = await Promise.all([api.incidents(page.value, pageSize.value), api.alerts()])
    incidents.value = res.items
    total.value = res.total
    alerts.value = al
    // If the current page fell out of range (e.g. incidents resolved and the
    // list shrank), clamp and refetch the valid last page.
    const tp = Math.max(1, Math.ceil(total.value / pageSize.value))
    if (page.value > tp) {
      page.value = tp
      return load()
    }
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
  window.addEventListener('keydown', onKey)
  timer = window.setInterval(load, 5000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('keydown', onKey)
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
          <thead><tr><th>{{ t('incidents.thRule') }}</th><th>{{ t('incidents.thNode') }}</th><th>{{ t('incidents.thReason') }}</th><th>{{ t('incidents.thLayer') }}</th><th>{{ t('incidents.thStart') }}</th></tr></thead>
          <tbody>
            <tr v-if="!alerts.length"><td colspan="5" class="hint">{{ t('incidents.noActiveAlerts') }}</td></tr>
            <tr v-for="a in alerts" :key="a.id">
              <td>{{ a.rule_name }}</td>
              <td :title="a.agent_id">{{ agentLabel(a) }}</td>
              <td>{{ alertReason(a) }}</td>
              <td><span class="badge neutral">{{ layerLabel(a.layer) }}</span></td>
              <td class="hint">{{ fmtTime(a.started_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ t('incidents.incidents') }}</h3>
        <span class="head-hint hint">{{ t('incidents.rowHint') }}</span>
        <span class="count">{{ total }}</span>
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
      <div v-if="incidents.length" class="pager">
        <div class="pager-size">
          <span class="hint">{{ t('incidents.perPage') }}</span>
          <select v-model.number="pageSize" @change="onPageSize">
            <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div v-if="totalPages > 1" class="pager-nav">
          <button class="pager-btn" :disabled="page <= 1" @click="goPage(page - 1)" :aria-label="t('common.prev')">‹</button>
          <span class="pager-info">{{ t('incidents.pageOf', { page, total: totalPages }) }}</span>
          <button class="pager-btn" :disabled="page >= totalPages" @click="goPage(page + 1)" :aria-label="t('common.next')">›</button>
        </div>
      </div>
    </section>

    <!-- Timeline slides in as a drawer so it's immediately visible on selection,
         instead of hiding at the bottom of the page. -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="selected" class="drawer-backdrop" @click="closeTimeline"></div>
      </Transition>
      <Transition name="slide">
        <aside v-if="selected" class="drawer" role="dialog" aria-modal="true">
          <div class="drawer-head">
            <div class="drawer-title">
              <h3>{{ t('incidents.timeline') }}</h3>
              <p v-if="selectedIncident" class="drawer-sub">{{ selectedIncident.summary }}</p>
            </div>
            <button class="drawer-close" @click="closeTimeline" :aria-label="t('common.close')">×</button>
          </div>
          <div class="drawer-body">
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
        </aside>
      </Transition>
    </Teleport>
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
/* hint takes the free space so it and the count sit together on the right */
.head-hint {
  margin-left: auto;
  font-size: 12px;
}

/* ---------- pager ---------- */
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  border-top: 1px solid var(--border);
}
.pager-size {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.pager-size select {
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
.pager-nav {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}
.pager-btn {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.pager-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.pager-info {
  font-size: 13px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

/* ---------- timeline drawer ---------- */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 90;
}
.drawer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  max-height: 72vh;
  background: var(--surface-solid);
  border-top: 1px solid var(--border);
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: 0 -10px 34px rgba(0, 0, 0, 0.32);
  z-index: 100;
  display: flex;
  flex-direction: column;
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.drawer-title h3 {
  font-size: 15px;
}
.drawer-sub {
  margin-top: 5px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-dim);
}
.drawer-close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.drawer-close:hover {
  color: var(--text);
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 20px 28px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.24s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateY(100%);
}

/* ---------- timeline list ---------- */
.timeline {
  list-style: none;
  margin: 0 auto;
  padding: 6px 4px;
  max-width: 1040px;
}
.timeline li {
  display: flex;
  align-items: baseline;
  gap: 14px;
  position: relative;
  padding: 10px 0 10px 20px;
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
  flex: 0 0 auto;
  color: var(--text-muted);
  min-width: 72px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.timeline .kind {
  flex: 0 0 auto;
  font-family: var(--mono);
  font-size: 12px;
  min-width: 132px;
  white-space: nowrap;
  color: var(--primary);
}
.timeline .msg {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-dim);
  word-break: break-word;
}
</style>
