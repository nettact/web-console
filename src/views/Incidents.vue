<script setup lang="ts">
// Incidents page: the site's parallel incidents (INCIDENT-001) with a group-aware
// list and an accessible detail drawer (INCIDENT-002 snapshot + DIAG-001 traces).
// The list keeps server pagination; a lightweight state/group filter narrows the
// currently-loaded page. Selecting an incident mounts IncidentDetail keyed by its
// id, which owns detail loading and self-paced polling.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type Incident, type Alert } from '../api'
import { toDateLocale } from '../i18n'
import { useIncidentLabels, severityTone } from '../composables/useIncidentLabels'
import IncidentDetail from '../components/incident/IncidentDetail.vue'

const { t, locale } = useI18n()
const route = useRoute()
const { sevLabel, layerLabel } = useIncidentLabels()

const incidents = ref<Incident[]>([])
const alerts = ref<Alert[]>([])
const selected = ref<string>('')
const error = ref('')
let timer: number | undefined

// Active-alert row helpers: who fired (agent hostname → short id) and why
// (server-rendered fault text in the current language, else first evidence).
const agentLabel = (a: Alert) => a.agent_host || a.agent_id.slice(0, 14) + '…'
const alertReason = (a: Alert) =>
  (locale.value === 'en' ? a.desc_en : a.desc_zh) ||
  a.evidence[0]?.target_name ||
  a.evidence[0]?.target_addr ||
  a.rule_name
const fmtTime = (s: string) => new Date(s).toLocaleTimeString(toDateLocale(locale.value))
const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value)) : '—'

// ---- filters (client-side, over the loaded page; server pagination preserved) ----
const stateFilter = ref<'all' | 'open' | 'resolved'>('all')
const groupFilter = ref<string>('all')
const groupOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const i of incidents.value) if (i.group_id) seen.set(i.group_id, i.group_name || i.group_id)
  return Array.from(seen, ([id, name]) => ({ id, name }))
})
const filteredIncidents = computed(() =>
  incidents.value.filter(
    (i) =>
      (stateFilter.value === 'all' || i.state === stateFilter.value) &&
      (groupFilter.value === 'all' || i.group_id === groupFilter.value),
  ),
)

// ---- pagination (server-side) ----
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

async function load() {
  try {
    const [res, al] = await Promise.all([api.incidents(page.value, pageSize.value), api.alerts()])
    incidents.value = res.items
    total.value = res.total
    alerts.value = al
    const tp = Math.max(1, Math.ceil(total.value / pageSize.value))
    if (page.value > tp) {
      page.value = tp
      return load()
    }
    error.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

function openIncident(id: string) {
  selected.value = id
}
function closeDetail() {
  selected.value = ''
}

onMounted(async () => {
  // Deep link from a notification: ?incident=<id> auto-opens that incident.
  const deep = route.query.incident
  if (typeof deep === 'string' && deep) selected.value = deep
  await load()
  // The list refresh keeps the overview coherent; the drawer polls its own detail.
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
          <thead>
            <tr>
              <th>{{ t('incidents.thRule') }}</th>
              <th>{{ t('incidents.thNode') }}</th>
              <th>{{ t('incidents.thReason') }}</th>
              <th>{{ t('incidents.thLayer') }}</th>
              <th>{{ t('incidents.thStart') }}</th>
            </tr>
          </thead>
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

      <div class="filters">
        <label class="filter">
          <span class="hint">{{ t('incidents.filterState') }}</span>
          <select v-model="stateFilter">
            <option value="all">{{ t('incidents.filterAll') }}</option>
            <option value="open">{{ t('incidents.stateOpen') }}</option>
            <option value="resolved">{{ t('incidents.stateResolved') }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="hint">{{ t('incidents.filterGroup') }}</span>
          <select v-model="groupFilter">
            <option value="all">{{ t('incidents.filterAll') }}</option>
            <option v-for="g in groupOptions" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </label>
        <span v-if="stateFilter !== 'all' || groupFilter !== 'all'" class="hint filter-note">
          {{ t('incidents.filterNote') }}
        </span>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ t('incidents.thState') }}</th>
              <th>{{ t('incidents.thGroup') }}</th>
              <th>{{ t('incidents.thSeverity') }}</th>
              <th>{{ t('incidents.thSuspectedLayer') }}</th>
              <th>{{ t('incidents.thMembers') }}</th>
              <th>{{ t('incidents.thStartTime') }}</th>
              <th>{{ t('incidents.thResolvedTime') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredIncidents.length"><td colspan="7" class="hint">{{ t('incidents.noIncidents') }}</td></tr>
            <tr
              v-for="i in filteredIncidents"
              :key="i.id"
              class="clickable"
              :class="{ selected: i.id === selected }"
              tabindex="0"
              role="button"
              :aria-label="t('incidents.openDetailAria', { group: i.group_name || '—' })"
              @click="openIncident(i.id)"
              @keydown.enter.prevent="openIncident(i.id)"
              @keydown.space.prevent="openIncident(i.id)"
            >
              <td>
                <span class="badge" :class="i.state">
                  <span class="dot" :class="i.state === 'open' ? 'down' : 'up'"></span>
                  {{ i.state === 'open' ? t('incidents.stateOpen') : t('incidents.stateResolved') }}
                </span>
                <span
                  v-if="i.state === 'resolved' && i.resolve_reason === 'configuration_changed'"
                  class="badge warn tiny"
                >{{ t('incidents.badgeTerminated') }}</span>
                <span v-if="i.evidence_expired" class="badge neutral tiny">{{ t('incidents.badgeExpired') }}</span>
              </td>
              <td>{{ i.group_name || '—' }}</td>
              <td><span class="badge" :class="severityTone(i.severity)">{{ sevLabel(i.severity) }}</span></td>
              <td>{{ layerLabel(i.suspected_layer) }}</td>
              <td class="mono">{{ i.active_member_count }} / {{ i.member_count }}</td>
              <td class="hint">{{ fmtDateTime(i.opened_at) }}</td>
              <td class="hint">{{ fmtDateTime(i.resolved_at) }}</td>
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

    <Teleport to="body">
      <IncidentDetail v-if="selected" :key="selected" :incident-id="selected" @close="closeDetail" />
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
.head-hint {
  margin-left: auto;
  font-size: 12px;
}
.filters {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 14px 4px;
}
.filter {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.filter select {
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
.filter-note {
  font-size: 12px;
}
.badge.tiny {
  padding: 1px 7px;
  font-size: 10.5px;
  margin-left: 6px;
}
tr.clickable {
  cursor: pointer;
}
tr.clickable:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
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
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
