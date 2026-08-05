<script setup lang="ts">
// Fault centre (ALERT-002): the one place a fault lives, whether or not anyone
// was notified about it. Detection is unconditional now, so this page is the
// complete record — current faults, history, evidence and what was sent — and it
// no longer has to be assembled from three separate lists (connectivity alerts,
// firing alerts, incidents) the way the rule-era page did.
//
// Filtering is SERVER-side: narrowing to "open, critical, this group" must search
// the whole history, not just the page already loaded.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type AlertStorm, type Incident, type IncidentFilter } from '../api'
import { toDateLocale } from '../i18n'
import { useIncidentLabels, severityTone } from '../composables/useIncidentLabels'
import IncidentDetail from '../components/incident/IncidentDetail.vue'
import { onSSE } from '../lib/sse'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { sevLabel, layerLabel, attributionLabel } = useIncidentLabels()

const incidents = ref<Incident[]>([])
const summary = ref({ open: 0, opened_24h: 0, resolved_24h: 0, top_layer: '' })
// Open storms for the site, unfiltered — see IncidentPage.storms.
const storms = ref<AlertStorm[]>([])
const selected = ref<string>('')
const error = ref('')
const loading = ref(false)
let timer: number | undefined
let offSSE: (() => void) | undefined

const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value)) : '—'

// duration renders how long a fault lasted (or has lasted), from opened_at.
function duration(i: Incident): string {
  return since(i.opened_at, i.resolved_at)
}

function since(from: string, to: string | null): string {
  const end = to ? new Date(to).getTime() : Date.now()
  const secs = Math.max(0, Math.round((end - new Date(from).getTime()) / 1000))
  if (secs < 60) return t('incidents.durSeconds', { n: secs })
  if (secs < 3600) return t('incidents.durMinutes', { n: Math.round(secs / 60) })
  if (secs < 86400) return t('incidents.durHours', { n: Math.round(secs / 360) / 10 })
  return t('incidents.durDays', { n: Math.round(secs / 8640) / 10 })
}

// ---- tabs + filters (server-side) ----
const tab = ref<'open' | 'resolved'>('open')
const severity = ref('')
const groupId = ref('')
const kind = ref('')
const stormId = ref('')
const search = ref('')

const filter = computed<IncidentFilter>(() => ({
  // Filtering to a storm deliberately drops the open/resolved constraint: a
  // burst is ONE event, and splitting its members across two tabs would make a
  // recovery notification's deep link land on an empty table (every member is
  // resolved by the time that notification is sent). "Show me this burst" means
  // all of it.
  state: stormId.value ? undefined : tab.value,
  severity: severity.value || undefined,
  group: groupId.value || undefined,
  kind: kind.value || undefined,
  storm: stormId.value || undefined,
  q: search.value.trim() || undefined,
}))

// The storm currently being filtered to, if it is still open. Resolved storms
// fall out of the banner list but the filter stays valid, so the chip below the
// banner is what tells the reader a narrowing is active.
const activeStorm = computed(() => storms.value.find((s) => s.id === stormId.value))

function showStorm(id: string) {
  stormId.value = stormId.value === id ? '' : id
}

// Keep ?storm= in step with the filter. Without this a page opened from a storm
// notification keeps the original id in its URL after the reader clears or
// switches the filter, so a reload silently restores a narrowing they dismissed
// — and openIncident would spread the stale id into every detail link it builds.
watch(stormId, (id) => {
  const q = { ...route.query }
  if (id) q.storm = id
  else delete q.storm
  router.replace({ query: q })
})

// Group choices come from the site's actual monitor groups, not from the page of
// incidents on screen: filtering is server-side, so deriving the options from the
// current page would make a group unselectable precisely when it has no fault on
// this page — and picking one would then narrow the options down to itself.
//
// Groups seen on the current page are merged in on top, because an incident
// freezes its group name: a group deleted after the fact still filters its own
// history correctly and must stay reachable.
const siteGroups = ref<{ id: string; name: string }[]>([])
const groupOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const g of siteGroups.value) seen.set(g.id, g.name)
  for (const i of incidents.value) {
    if (i.group_id && !seen.has(i.group_id)) seen.set(i.group_id, i.group_name || i.group_id)
  }
  return Array.from(seen, ([id, name]) => ({ id, name }))
})

const PROBE_KINDS = ['icmp', 'gateway', 'tcp', 'http', 'dns', 'nat', 'agent_connectivity']

// notifyState summarizes an incident's delivery records for the list: announced,
// waiting out its delay, or recorded only. "Recorded only" is a legitimate state,
// not a failure, so it reads as neutral rather than as a warning.
//
// Both counts already include the records of the storm that announced this fault
// on its behalf (see deliveryForIncident server-side), so the state is derived
// from what was actually SENT — never from storm membership alone. A storm can
// form with no channels configured, with every channel opted out of merging, or
// while its summary is still waiting out the delay; in all three cases nobody
// has been told yet, and saying otherwise would be a lie about the one thing
// this column exists to answer.
function notifyState(i: Incident): { key: string; tone: string } {
  if (i.notified_count > 0) {
    return { key: i.storm_id ? 'incidents.notifyInStorm' : 'incidents.notifySent', tone: 'ok' }
  }
  if (i.pending_notify_count > 0) return { key: 'incidents.notifyPending', tone: 'neutral' }
  return { key: 'incidents.notifyRecordedOnly', tone: 'neutral' }
}

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

// Three things can start a load at once — a debounced filter edit, an SSE push
// and the safety poll — and they do not come back in the order they were sent.
// Without this guard a slow request for the old filter can land last and repaint
// the table with results the operator already narrowed away.
let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await api.incidents(page.value, pageSize.value, filter.value)
    if (seq !== loadSeq) return // a newer request is already in flight
    incidents.value = res.items
    total.value = res.total
    summary.value = res.summary
    storms.value = res.storms
    const tp = Math.max(1, Math.ceil(total.value / pageSize.value))
    if (page.value > tp) {
      page.value = tp
      return load()
    }
    error.value = ''
  } catch (e) {
    if (seq !== loadSeq) return
    error.value = String((e as Error).message || e)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

// Any filter change restarts at page 1: staying on page 4 of a narrower result
// set would show an empty table for no visible reason.
let debounce: number | undefined
watch(filter, () => {
  page.value = 1
  if (debounce) clearTimeout(debounce)
  debounce = window.setTimeout(load, 200)
})

function openIncident(id: string) {
  selected.value = id
  // Keep the deep link honest so a reload or a shared URL reopens the same fault.
  router.replace({ query: { ...route.query, incident: id } })
}
function closeDetail() {
  selected.value = ''
  const q = { ...route.query }
  delete q.incident
  router.replace({ query: q })
}

const SITE = 'site_default'

onMounted(async () => {
  // Deep link from a notification or the tray: ?incident=<id> auto-opens it.
  const deep = route.query.incident
  if (typeof deep === 'string' && deep) selected.value = deep
  // ?storm=<id> comes from a storm summary notification and lands on exactly the
  // faults that notification summarized.
  const deepStorm = route.query.storm
  if (typeof deepStorm === 'string' && deepStorm) stormId.value = deepStorm
  // The filter list is a convenience, not a prerequisite: if it cannot be read
  // the page still works, falling back to the groups visible on the page.
  api
    .monitorGroups(SITE)
    .then((gs) => {
      siteGroups.value = gs.map((g) => ({ id: g.id, name: g.name }))
    })
    .catch(() => {})
  await load()
  // The server pushes incident lifecycle changes; the slow poll is only a safety
  // net for a dropped stream, so the list cannot silently go stale.
  offSSE = onSSE('incident', () => load())
  timer = window.setInterval(load, 15000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (debounce) clearTimeout(debounce)
  offSSE?.()
})
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ t('incidents.title') }}</h2>
      <p class="sub">{{ t('incidents.sub') }}</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="summary">
      <div class="stat">
        <span class="stat-value" :class="{ hot: summary.open > 0 }">{{ summary.open }}</span>
        <span class="stat-label">{{ t('incidents.statOpen') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ summary.opened_24h }}</span>
        <span class="stat-label">{{ t('incidents.statOpened24h') }}</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ summary.resolved_24h }}</span>
        <span class="stat-label">{{ t('incidents.statResolved24h') }}</span>
      </div>
      <div v-if="summary.top_layer" class="stat">
        <span class="stat-value small">{{ layerLabel(summary.top_layer) }}</span>
        <span class="stat-label">{{ t('incidents.statTopLayer') }}</span>
      </div>
    </section>

    <!-- Storm banner: when many faults break out at once under one Agent, the
         page must read as ONE event with N parts, not as N unrelated rows. -->
    <section v-if="storms.length" class="storms">
      <button
        v-for="s in storms"
        :key="s.id"
        type="button"
        class="storm-card"
        :class="{ active: stormId === s.id }"
        :aria-pressed="stormId === s.id"
        @click="showStorm(s.id)"
      >
        <div class="storm-head">
          <span class="badge" :class="severityTone(s.severity)">{{ sevLabel(s.severity) }}</span>
          <span class="storm-title">
            {{ t('incidents.storm.title', { layer: layerLabel(s.suspected_layer) }) }}
          </span>
        </div>
        <p class="storm-sub">
          {{ t('incidents.storm.sub', { faults: s.fault_count, groups: s.group_count, agent: s.agent_name }) }}
        </p>
        <p class="storm-meta hint">
          <span>{{ t('incidents.storm.open', { n: s.open_fault_count }) }}</span>
          <span>{{ since(s.opened_at, s.resolved_at) }}</span>
          <span v-if="s.notified_count > 0">{{ t('incidents.storm.notified') }}</span>
          <span v-else-if="s.pending_notify_count > 0">{{ t('incidents.notifyPending') }}</span>
          <span v-else>{{ t('incidents.notifyRecordedOnly') }}</span>
        </p>
        <span class="storm-cta">
          {{ stormId === s.id ? t('incidents.storm.showAll') : t('incidents.storm.showMembers') }}
        </span>
      </button>
    </section>

    <section class="panel">
      <div class="tabs" role="tablist">
        <!-- Picking a tab means "browse by state", which is the opposite of the
             storm narrowing (that spans both states), so it clears it — leaving a
             tab looking selected while a storm filter overrode it would be a lie
             about what the table below is showing. -->
        <button
          class="tab"
          role="tab"
          :class="{ active: tab === 'open' && !stormId }"
          :aria-selected="tab === 'open' && !stormId"
          @click="tab = 'open'; stormId = ''"
        >{{ t('incidents.tabCurrent') }}</button>
        <button
          class="tab"
          role="tab"
          :class="{ active: tab === 'resolved' && !stormId }"
          :aria-selected="tab === 'resolved' && !stormId"
          @click="tab = 'resolved'; stormId = ''"
        >{{ t('incidents.tabHistory') }}</button>
        <span class="count">{{ total }}</span>
      </div>

      <div class="filters">
        <label class="filter">
          <span class="hint">{{ t('incidents.filterSeverity') }}</span>
          <select v-model="severity">
            <option value="">{{ t('incidents.filterAll') }}</option>
            <option value="critical">{{ sevLabel('critical') }}</option>
            <option value="error">{{ sevLabel('error') }}</option>
            <option value="warn">{{ sevLabel('warn') }}</option>
            <option value="info">{{ sevLabel('info') }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="hint">{{ t('incidents.filterGroup') }}</span>
          <select v-model="groupId">
            <option value="">{{ t('incidents.filterAll') }}</option>
            <option v-for="g in groupOptions" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="hint">{{ t('incidents.filterKind') }}</span>
          <select v-model="kind">
            <option value="">{{ t('incidents.filterAll') }}</option>
            <option v-for="k in PROBE_KINDS" :key="k" :value="k">{{ t(`incidents.kind_${k}`) }}</option>
          </select>
        </label>
        <label class="filter grow">
          <span class="hint">{{ t('incidents.filterSearch') }}</span>
          <input v-model="search" type="search" :placeholder="t('incidents.searchPlaceholder')" />
        </label>
        <!-- The storm narrowing has no select of its own (it is set from the
             banner or a notification deep link), so it needs a visible, clearable
             chip — otherwise a filtered-looking table has no explanation. -->
        <button v-if="stormId" type="button" class="filter-chip" @click="stormId = ''">
          {{ activeStorm
            ? t('incidents.storm.chip', { agent: activeStorm.agent_name })
            : t('incidents.storm.chipUnknown') }}
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ t('incidents.thTitle') }}</th>
              <th>{{ t('incidents.thSeverity') }}</th>
              <th>{{ t('incidents.thGroup') }}</th>
              <th>{{ t('incidents.thSuspectedLayer') }}</th>
              <th>{{ t('incidents.thMembers') }}</th>
              <th>{{ t('incidents.thStartTime') }}</th>
              <th>{{ t('incidents.thDuration') }}</th>
              <th>{{ t('incidents.thNotify') }}</th>
              <th class="action-col">{{ t('incidents.thAction') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!incidents.length">
              <td colspan="9" class="hint">
                {{ loading ? t('common.loading') : t(tab === 'open' ? 'incidents.noCurrent' : 'incidents.noHistory') }}
              </td>
            </tr>
            <tr
              v-for="i in incidents"
              :key="i.id"
              class="clickable"
              :class="{ selected: i.id === selected }"
              tabindex="0"
              role="button"
              :aria-label="t('incidents.openDetailAria', { group: i.title || i.group_name || '—' })"
              @click="openIncident(i.id)"
              @keydown.enter.prevent="openIncident(i.id)"
              @keydown.space.prevent="openIncident(i.id)"
            >
              <td>
                <span class="title">{{ i.title || i.summary || '—' }}</span>
                <span
                  v-if="i.storm_id"
                  class="badge tiny"
                  :class="{ neutral: true }"
                  :title="t('incidents.storm.badgeHint')"
                >{{ t('incidents.storm.badge') }}</span>
                <span
                  v-if="i.state === 'resolved' && i.resolve_reason && i.resolve_reason !== 'recovered'"
                  class="badge warn tiny"
                  :title="t('incidents.badgeTerminatedHint')"
                >{{ t(`incidents.resolveReason.${i.resolve_reason}`) }}</span>
                <span v-if="i.evidence_expired" class="badge neutral tiny">{{ t('incidents.badgeExpired') }}</span>
              </td>
              <td><span class="badge" :class="severityTone(i.severity)">{{ sevLabel(i.severity) }}</span></td>
              <td>{{ i.group_name || '—' }}</td>
              <td>{{ i.attribution ? attributionLabel(i.attribution) : layerLabel(i.suspected_layer) }}</td>
              <td class="mono">{{ i.active_member_count }} / {{ i.member_count }}</td>
              <td class="hint">{{ fmtDateTime(i.opened_at) }}</td>
              <td class="hint mono">{{ duration(i) }}</td>
              <td>
                <span class="badge tiny" :class="notifyState(i).tone">{{ t(notifyState(i).key) }}</span>
              </td>
              <td class="row-action-cell">
                <span class="row-detail-cue" aria-hidden="true">
                  {{ t('incidents.viewDetail') }}
                  <span class="row-chevron">&rsaquo;</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="incidents.length" class="pager">
        <div class="pager-size">
          <span class="hint">{{ t('incidents.perPage') }}</span>
          <select v-model.number="pageSize" @change="page = 1; load()">
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
/* Hallmark · genre: custom application · macrostructure: Index-First · design-system: design.md · designed-as-app
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
.panel {
  margin-bottom: var(--space-md);
  overflow: hidden;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-panel);
  background: var(--color-paper-2);
  box-shadow: var(--shadow-card);
}

.table-wrap {
  overflow-x: auto;
  background: var(--color-paper-2);
}

.data-table {
  min-width: 1120px;
  font-variant-numeric: tabular-nums;
}

.summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
  min-width: 0;
  padding: var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-paper-2);
  box-shadow: var(--shadow-card);
}

.stat-value {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-outlier);
  font-size: var(--text-2xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.stat-value.small {
  padding-top: var(--space-2xs);
  font-family: var(--font-display);
  font-size: var(--text-md);
  letter-spacing: -0.018em;
}

.stat-value.hot {
  color: var(--color-danger-text);
}

.stat-label {
  color: var(--color-ink-2);
  font-size: var(--text-xs);
}

.storms {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.storm-card {
  flex: 1 1 320px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  min-width: 0;
  padding: var(--space-sm);
  text-align: left;
  border: var(--rule-hair) solid var(--color-danger);
  border-radius: var(--radius-card);
  background: var(--color-paper-2);
  color: var(--color-ink);
  cursor: pointer;
  transition: transform var(--dur-micro) var(--ease-out), background-color var(--dur-micro) var(--ease-out);
}

.storm-card:hover,
.storm-card.active {
  background: var(--color-paper-3);
}

.storm-card:active {
  transform: translateY(1px);
}

.storm-card:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}

.storm-head {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.storm-title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: 700;
}

.storm-sub {
  margin: 0;
  font-size: var(--text-sm);
}

.storm-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin: 0;
  font-size: var(--text-xs);
}

.storm-cta {
  align-self: flex-start;
  color: var(--color-accent-text);
  font-size: var(--text-xs);
  font-weight: 650;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 44px;
  padding: var(--space-2xs) var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-pill);
  background: var(--color-paper-3);
  color: var(--color-ink);
  font-size: var(--text-xs);
  cursor: pointer;
}

.filter-chip:hover {
  border-color: var(--color-accent);
}

.filter-chip:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}

.tabs {
  display: flex;
  align-items: center;
  gap: var(--space-3xs);
  padding: var(--space-2xs) var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-strong);
}

.tab {
  min-height: 44px;
  padding: var(--space-2xs) var(--space-sm);
  border: var(--rule-hair) solid transparent;
  border-radius: var(--radius-input);
  background: transparent;
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.tab:hover {
  color: var(--color-ink);
  background: var(--color-glass-hover);
}

.tab.active {
  color: var(--color-primary-action-text);
  border-color: var(--color-accent);
  background: var(--color-primary-action-bg);
}

.tab:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}

.count {
  margin-left: auto;
  min-width: 28px;
  padding: var(--space-3xs) var(--space-2xs);
  border-radius: var(--radius-pill);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-ink-2);
  background: var(--color-paper-3);
  border: var(--rule-hair) solid var(--color-rule);
  text-align: center;
}

.filters {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  padding: var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass);
}

.filter {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
  font-size: var(--text-sm);
}

.filter.grow {
  flex: 1 1 200px;
}

.filter select,
.filter input {
  min-height: 44px;
  padding: var(--space-2xs) var(--space-xs);
  border-radius: var(--radius-input);
  border: var(--rule-hair) solid var(--color-rule-2);
  background: var(--color-paper-2);
  color: var(--color-ink);
}

.filter.grow input {
  flex: 1;
  min-width: 140px;
}

.title {
  font-weight: 600;
}

.badge.tiny {
  padding: var(--space-3xs) var(--space-2xs);
  margin-left: var(--space-2xs);
  font-size: var(--text-xs);
}

tr.clickable {
  cursor: pointer;
}

.action-col,
.row-action-cell {
  text-align: right;
  white-space: nowrap;
}

.row-detail-cue {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 44px;
  padding: var(--space-2xs) var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-input);
  color: var(--color-accent-text);
  background: var(--color-paper-3);
  font-size: var(--text-xs);
  font-weight: 650;
  transition: transform var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out);
}

.row-chevron {
  font-size: var(--text-md);
  line-height: 0.7;
}

tr.clickable:hover .row-detail-cue,
tr.clickable:focus-visible .row-detail-cue {
  border-color: var(--color-accent);
  transform: translateX(2px);
}

tr.clickable:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(var(--rule-fine) * -1);
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-top: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-subtle);
}

.pager-size {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-xs);
}

.pager-size select {
  min-height: 44px;
  padding: var(--space-2xs) var(--space-xs);
  border-radius: var(--radius-input);
  border: var(--rule-hair) solid var(--color-rule);
  background: var(--color-paper-2);
  color: var(--color-ink);
}

.pager-nav {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-left: auto;
}

.pager-btn {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-input);
  border: var(--rule-hair) solid var(--color-rule);
  background: var(--color-paper-2);
  color: var(--color-ink);
  font-size: var(--text-md);
  line-height: 1;
  cursor: pointer;
}

.pager-btn:hover:not(:disabled) {
  border-color: var(--color-rule-2);
}

.pager-btn:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}

.pager-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.pager-info {
  color: var(--color-ink-2);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 768px) {
  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filters {
    align-items: stretch;
  }

  .filter {
    flex: 1 1 220px;
    justify-content: space-between;
  }

  .filter select,
  .filter input {
    flex: 1;
    min-width: 0;
  }
}

@media (max-width: 414px) {
  .summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .storm-card {
    flex-basis: 100%;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  }

  .tab {
    min-width: 0;
    padding-inline: var(--space-2xs);
  }

  .filter {
    align-items: stretch;
    flex-basis: 100%;
    flex-direction: column;
  }

  .pager {
    align-items: stretch;
    flex-direction: column;
  }

  .pager-nav {
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .storm-card,
  .row-detail-cue {
    transition-duration: var(--dur-micro);
  }
}
</style>
