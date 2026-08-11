<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  NotFoundError,
  api,
  type PublicAgentRow,
  type PublicDailyAvailability,
  type PublicIncident,
  type PublicIncidentSubject,
  type PublicPage,
  type PublicTargetRow,
} from './api'
import { slugFromHash } from './route'
import { theme, toggleTheme } from './theme'
import { setLocale, toDateLocale } from './i18n'
import UptimeBar from './UptimeBar.vue'
import {
  STATUS_TONE,
  agentRowLabel,
  formatAvailability,
  formatBps,
  formatBytes,
  formatLoadValue,
  formatPct,
  formatUptime,
  hasResources,
  kindLabel,
  relativeUpdated,
  targetRowLabel,
  usageTone,
  windowLabel,
} from './labels'

// The public page polls rather than subscribing. SSE is console-only (it is
// session-authenticated and pushes far more than a status page may see), and an
// anonymous page with an unknown number of viewers is exactly where a cheap
// fixed-interval poll beats a connection per reader.
const POLL_MS = 30_000
// Drives the relative "updated Ns ago" line, which would otherwise sit still
// between polls and make a live page look frozen.
const TICK_MS = 5_000

const { t, locale } = useI18n()

const slug = ref(slugFromHash(location.hash))
const page = ref<PublicPage | null>(null)
const agents = ref<PublicAgentRow[] | null>(null)
const targets = ref<PublicTargetRow[] | null>(null)
const incidents = ref<PublicIncident[] | null>(null)
const incidentsTruncated = ref(false)
const incidentWindowDays = ref(0)
const generatedAt = ref('')
// The UTC date of the first uptime-bar cell, sent once per payload because every
// row shares the same strip.
const daysFrom = ref('')
const loading = ref(true)
const notFound = ref(false)
/** A failed refresh keeps the last good board on screen and says so, rather than
 *  blanking a page that was fine two seconds ago. */
const stale = ref(false)
const now = ref(Date.now())
type PublicView = 'targets' | 'agents' | 'incidents'
const activeView = ref<PublicView>('targets')

let pollTimer: number | undefined
let tickTimer: number | undefined
// Navigation generation. Bumped ONLY when the addressed page changes, never by a
// poll: a counter that every tick advanced would invalidate any load still in
// flight when the next tick arrived, so on a slow link nothing would ever paint.
let navGeneration = 0
// The refresh currently running FOR THE CURRENT PAGE, or null. It is both the
// poll gate and the cancellation handle, and it is deliberately scoped to one
// navigation: a request left over from a page the reader has moved on from must
// not be able to hold the page they are actually looking at hostage.
let inFlight: AbortController | null = null

const onlineAgents = computed(() => (agents.value ?? []).filter((a) => a.online).length)
const upTargets = computed(() => (targets.value ?? []).filter((tg) => tg.status === 'up').length)
const updatedLabel = computed(() => (generatedAt.value ? relativeUpdated(generatedAt.value, now.value, t) : ''))
type CurrentStatus = { key: 'healthy' | 'fault' | 'unknown'; tone: 'good' | 'bad' | 'muted' }
const currentStatus = computed<CurrentStatus>(() => {
  const publishedTargets = targets.value ?? []
  const publishedAgents = agents.value ?? []
  const publishedIncidents = incidents.value ?? []
  // This is deliberately binary: a published node going offline or an active
  // degraded incident is still a current fault, even when no target is fully
  // down. The incident list carries the finer degraded/outage distinction.
  const hasFault =
    publishedTargets.some((target) => target.status === 'down' || target.status === 'degraded') ||
    publishedAgents.some((agent) => !agent.online) ||
    publishedIncidents.some((incident) => incident.state === 'open')
  if (hasFault) return { key: 'fault', tone: 'bad' }

  const hasUnknown = publishedTargets.some((target) => target.status === 'unknown')
  const hasEvidence =
    publishedTargets.some((target) => target.status !== 'unknown') ||
    publishedAgents.length > 0 ||
    (page.value?.show_incidents === true && incidents.value != null)
  if (hasUnknown || !hasEvidence) return { key: 'unknown', tone: 'muted' }
  return { key: 'healthy', tone: 'good' }
})
const visibleViews = computed<PublicView[]>(() => {
  const views: PublicView[] = []
  if (page.value?.show_target_view) views.push('targets')
  if (page.value?.show_agent_view) views.push('agents')
  if (page.value?.show_incidents) views.push('incidents')
  return views
})
const showTabs = computed(() => visibleViews.value.length > 1)
const visibleView = computed<PublicView>(() => {
  if (visibleViews.value.includes(activeView.value)) return activeView.value
  return visibleViews.value[0] ?? 'targets'
})

function reconcileActiveView(meta: PublicPage): void {
  if (activeView.value === 'targets' && meta.show_target_view) return
  if (activeView.value === 'agents' && meta.show_agent_view) return
  if (activeView.value === 'incidents' && meta.show_incidents) return
  activeView.value = meta.show_target_view ? 'targets' : meta.show_agent_view ? 'agents' : 'incidents'
}

function selectView(view: PublicView): void {
  activeView.value = view
}

function onTabKeydown(event: KeyboardEvent): void {
  const order = visibleViews.value
  let next: PublicView | undefined
  if (event.key === 'ArrowRight') next = order[(order.indexOf(activeView.value) + 1) % order.length]
  if (event.key === 'ArrowLeft') next = order[(order.indexOf(activeView.value) + order.length - 1) % order.length]
  if (event.key === 'Home') next = order[0]
  if (event.key === 'End') next = order[order.length - 1]
  if (!next) return
  event.preventDefault()
  selectView(next)
  window.requestAnimationFrame(() => {
    document.getElementById(`status-tab-${next}`)?.focus({ preventScroll: true })
  })
}

function incidentSubjectLabel(subject: PublicIncidentSubject): string {
  if (subject.type === 'target') {
    return subject.name || t('targets.unnamed', { kind: kindLabel(subject.kind, t), n: subject.ordinal })
  }
  return subject.name || t('agents.unnamed', { n: subject.ordinal })
}

function incidentTitle(incident: PublicIncident): string {
  const first = incident.subjects[0]
  if (!first) return t('incidents.unknownSubject')
  const name = incidentSubjectLabel(first)
  if (incident.subjects.length === 1) return name
  return t('incidents.multipleSubjects', { name, n: incident.subjects.length - 1 })
}

function incidentTime(incident: PublicIncident): string {
  const start = new Date(incident.started_at)
  if (Number.isNaN(start.getTime())) return ''
  const end = incident.resolved_at ? new Date(incident.resolved_at) : new Date(now.value)
  const safeEnd = Number.isNaN(end.getTime()) ? start : end
  const seconds = Math.max(0, Math.round((safeEnd.getTime() - start.getTime()) / 1000))
  let duration: string
  if (seconds < 60) duration = t('incidents.duration.seconds', { n: seconds })
  else if (seconds < 3600) duration = t('incidents.duration.minutes', { n: Math.round(seconds / 60) })
  else if (seconds < 86400) duration = t('incidents.duration.hours', { n: Math.round(seconds / 360) / 10 })
  else duration = t('incidents.duration.days', { n: Math.round(seconds / 8640) / 10 })
  const time = start.toLocaleString(toDateLocale(locale.value))
  return incident.state === 'open'
    ? t('incidents.started', { time, duration })
    : t('incidents.resolved', { time, duration })
}

function wholeUTCDaysBetween(startISO: string, endISO: string): number {
  const start = Date.parse(startISO)
  const end = Date.parse(endISO)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.round((end - start) / 86_400_000)
}

function sinceLabel(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return t('agents.since', { time: d.toLocaleString(toDateLocale(locale.value)) })
}

/**
 * One uptime-bar cell's public overview. Passed into UptimeBar rather than
 * translated there, so that component owns interaction but not product copy.
 *
 * The dates are UTC because the server bins by UTC days; rendering them in the
 * reader's local calendar would label a cell with a day whose hours it does not
 * actually contain. Probe counts are the exact aggregate behind the ratio, so
 * the tooltip never invents downtime duration from sampling.
 */
function daySummary(date: string, day: PublicDailyAvailability) {
  const parsed = new Date(`${date}T00:00:00Z`)
  const dateLabel = Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(toDateLocale(locale.value), {
        dateStyle: 'medium',
        timeZone: 'UTC',
      })
  let statusKey: 'none' | 'up' | 'minor' | 'major' | 'down' = 'none'
  let tone: 'good' | 'warn' | 'bad' | 'muted' = 'muted'
  if (day.ratio != null && day.rounds > 0) {
    if (day.ratio >= 0.9999) [statusKey, tone] = ['up', 'good']
    else if (day.ratio >= 0.99) [statusKey, tone] = ['minor', 'warn']
    else if (day.ratio >= 0.9) [statusKey, tone] = ['major', 'warn']
    else [statusKey, tone] = ['down', 'bad']
  }
  const status = t(`targets.dayStatus.${statusKey}`)
  const availability = formatAvailability(day.ratio) ?? t('targets.availabilityUnknown')
  const probes = day.rounds > 0
    ? t('targets.dayProbeCount', { ok: day.ok_rounds, total: day.rounds })
    : t('targets.dayNoProbes')
  return {
    date: dateLabel,
    status,
    availabilityLabel: t('targets.dayAvailability'),
    availability,
    probesLabel: t('targets.dayProbes'),
    probes,
    tone,
    aria: t('targets.barDay', { date: dateLabel, status, availability, probes }),
  }
}

/**
 * Loads everything the page shows, metadata included — every time, not only on
 * first paint.
 *
 * Re-reading the metadata on every poll is what keeps a long-open tab honest.
 * The toggles decide which endpoints to call, so a cached copy of them goes
 * wrong in both directions: a view the operator has since enabled would never
 * appear, and a view they DISABLED would keep being requested, 404, and take the
 * whole board down as "page not found" while it is still perfectly published.
 *
 * A 'navigate' load is the reader arriving at a page: it shows the loading
 * state, owns the board, and cancels whatever the previous page had outstanding.
 * A 'poll' load is a background refresh: it never blanks what is on screen, and
 * it yields to a refresh already running for this same page.
 *
 * Superseded work is aborted rather than merely ignored. Discarding the result
 * of a request that keeps running is not enough — fetch has no timeout, so a
 * stalled connection would otherwise sit in flight forever.
 */
async function load(kind: 'navigate' | 'poll'): Promise<void> {
  if (!slug.value) {
    loading.value = false
    return
  }
  if (kind === 'poll' && inFlight) return
  if (kind === 'navigate') {
    navGeneration++
    loading.value = true
    inFlight?.abort()
  }
  const nav = navGeneration
  const wanted = slug.value
  // Every await below is a chance for the address to change under us. A load the
  // reader has already navigated away from must write nothing — and must not
  // start further requests either.
  const current = () => nav === navGeneration && wanted === slug.value
  const ctrl = new AbortController()
  inFlight = ctrl
  try {
    const meta = await api.page(wanted, ctrl.signal)
    if (!current()) return
    // Only fetch the views this page publishes. The server enforces the same
    // toggles, so asking for a hidden one would 404 and mark the board stale.
    const [agentData, targetData, incidentData] = await Promise.all([
      meta.show_agent_view ? api.agentStatuses(wanted, ctrl.signal) : Promise.resolve(null),
      meta.show_target_view ? api.targetStatuses(wanted, ctrl.signal) : Promise.resolve(null),
      meta.show_incidents ? api.incidents(wanted, ctrl.signal) : Promise.resolve(null),
    ])
    if (!current()) return
    // Commit metadata and rows together. Applied separately, a refresh whose
    // metadata lands but whose rows fail would pair the new toggles with the old
    // (or absent) data — a freshly enabled view would render "publishes no
    // nodes", which is an assertion, not a loading state.
    reconcileActiveView(meta)
    page.value = meta
    notFound.value = false
    document.title = `${meta.title} · NetTact`
    agents.value = agentData?.agents ?? null
    targets.value = targetData?.targets ?? null
    incidents.value = incidentData?.incidents ?? null
    incidentsTruncated.value = incidentData?.truncated ?? false
    incidentWindowDays.value = incidentData
      ? wholeUTCDaysBetween(incidentData.window_start, incidentData.generated_at)
      : 0
    daysFrom.value = targetData?.days_from ?? ''
    generatedAt.value = targetData?.generated_at ?? agentData?.generated_at ?? incidentData?.generated_at ?? meta.generated_at
    now.value = Date.now()
    stale.value = false
  } catch (err) {
    // A superseded load lands here on its own abort; it is not a failure of the
    // page now on screen, so it reports nothing.
    if (!current()) return
    if (err instanceof NotFoundError) {
      // A page unpublished while someone was watching becomes the not-found view,
      // exactly like a link that was never valid.
      notFound.value = true
      page.value = null
      agents.value = null
      targets.value = null
      incidents.value = null
      incidentsTruncated.value = false
      incidentWindowDays.value = 0
      return
    }
    // A failed refresh keeps the last good board on screen and says so; only a
    // failed arrival has nothing to keep.
    if (kind === 'navigate') page.value = null
    stale.value = true
  } finally {
    // Only release the gate if it is still ours: a load superseded by navigation
    // must not clear the handle belonging to the page that replaced it.
    if (inFlight === ctrl) inFlight = null
    // `loading` means "nothing decided yet for this page", not "a request is in
    // flight" — re-raising it per poll would blink the not-found and error views
    // through the loading state every thirty seconds.
    if (current()) loading.value = false
  }
}

function onHashChange(): void {
  const next = slugFromHash(location.hash)
  if (next === slug.value) return
  slug.value = next
}

watch(slug, () => {
  activeView.value = 'targets'
  page.value = null
  agents.value = null
  targets.value = null
  incidents.value = null
  incidentsTruncated.value = false
  incidentWindowDays.value = 0
  generatedAt.value = ''
  daysFrom.value = ''
  notFound.value = false
  void load('navigate')
})

onMounted(() => {
  void load('navigate')
  // Polls re-read the metadata too (see load), so a page that was unreachable on
  // first paint recovers by itself, and a toggle flipped in the console reaches
  // an already-open tab.
  pollTimer = window.setInterval(() => void load('poll'), POLL_MS)
  tickTimer = window.setInterval(() => (now.value = Date.now()), TICK_MS)
  window.addEventListener('hashchange', onHashChange)
})

onUnmounted(() => {
  window.clearInterval(pollTimer)
  window.clearInterval(tickTimer)
  window.removeEventListener('hashchange', onHashChange)
  inFlight?.abort()
})
</script>

<template>
  <a class="skip-link" href="#public-status-main">{{ t('skipToContent') }}</a>
  <div class="page">
    <header class="site-head">
      <div class="site-head-inner">
        <div class="brand-lockup" aria-label="NetTact">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12h3l2.5 7 5-15L18 12h3" />
            </svg>
          </span>
          <span class="brand-copy">
            <strong>{{ t('brand') }}</strong>
            <small>{{ t('pageLabel') }}</small>
          </span>
        </div>
        <div class="controls">
          <button
            type="button"
            class="control"
            :title="theme === 'dark' ? t('theme.toLight') : t('theme.toDark')"
            @click="toggleTheme"
          >
            {{ theme === 'dark' ? t('theme.toLight') : t('theme.toDark') }}
          </button>
          <button
            type="button"
            class="control"
            @click="setLocale(locale === 'zh' ? 'en' : 'zh')"
          >
            {{ t('lang.toggle') }}
          </button>
        </div>
      </div>
    </header>

    <main id="public-status-main" class="status-main" tabindex="-1">
      <template v-if="page">
        <section class="identity">
          <div class="identity-copy">
            <h1>{{ page.title }}</h1>
            <p v-if="page.description">{{ page.description }}</p>
          </div>

          <section
            class="current-status"
            :class="`current-status-${currentStatus.tone}`"
            :aria-label="t('current.title')"
            aria-live="polite"
          >
            <div class="status-readout">
              <span class="status-beacon" aria-hidden="true"></span>
              <div>
                <strong>{{ t(`current.${currentStatus.key}.label`) }}</strong>
                <p>{{ t(`current.${currentStatus.key}.summary`) }}</p>
              </div>
            </div>

            <dl class="status-metrics">
              <div v-if="page.show_target_view">
                <dt>{{ t('targets.title') }}</dt>
                <dd>{{ t('targets.summary', { up: upTargets, total: targets?.length ?? 0 }) }}</dd>
              </div>
              <div v-if="page.show_agent_view">
                <dt>{{ t('agents.title') }}</dt>
                <dd>{{ t('agents.summary', { online: onlineAgents, total: agents?.length ?? 0 }) }}</dd>
              </div>
              <div v-if="page.show_incidents">
                <dt>{{ t('incidents.title') }}</dt>
                <dd>{{ t('incidents.summary', { n: incidents?.length ?? 0 }) }}</dd>
              </div>
            </dl>

            <div class="status-meta">
              <span v-if="updatedLabel">{{ updatedLabel }}</span>
              <span v-if="stale" class="meta-warn">{{ t('stale') }}</span>
            </div>
          </section>
        </section>

        <section class="board" :aria-label="t('tabs.label')">
          <div v-if="showTabs" class="board-toolbar">
            <div class="tabs" :class="`tabs-${visibleViews.length}`" role="tablist" :aria-label="t('tabs.label')">
            <button
              v-if="page.show_target_view"
              id="status-tab-targets"
              type="button"
              role="tab"
              class="tab"
              :class="{ active: visibleView === 'targets' }"
              :aria-selected="visibleView === 'targets'"
              aria-controls="status-panel-targets"
              :tabindex="visibleView === 'targets' ? 0 : -1"
              @click="selectView('targets')"
              @keydown="onTabKeydown"
            >
              <span>{{ t('targets.title') }}</span>
              <small v-if="targets?.length">
                {{ t('targets.summary', { up: upTargets, total: targets.length }) }}
              </small>
            </button>
            <button
              v-if="page.show_agent_view"
              id="status-tab-agents"
              type="button"
              role="tab"
              class="tab"
              :class="{ active: visibleView === 'agents' }"
              :aria-selected="visibleView === 'agents'"
              aria-controls="status-panel-agents"
              :tabindex="visibleView === 'agents' ? 0 : -1"
              @click="selectView('agents')"
              @keydown="onTabKeydown"
            >
              <span>{{ t('agents.title') }}</span>
              <small v-if="agents?.length">
                {{ t('agents.summary', { online: onlineAgents, total: agents.length }) }}
              </small>
            </button>
            <button
              v-if="page.show_incidents"
              id="status-tab-incidents"
              type="button"
              role="tab"
              class="tab"
              :class="{ active: visibleView === 'incidents' }"
              :aria-selected="visibleView === 'incidents'"
              aria-controls="status-panel-incidents"
              :tabindex="visibleView === 'incidents' ? 0 : -1"
              @click="selectView('incidents')"
              @keydown="onTabKeydown"
            >
              <span>{{ t('incidents.title') }}</span>
              <small v-if="incidents?.length">
                {{ t('incidents.summary', { n: incidents.length }) }}
              </small>
            </button>
            </div>
          </div>

          <Transition name="tab-fade" mode="out-in">
          <section
            v-if="visibleView === 'incidents'"
            id="status-panel-incidents"
            key="incidents"
            class="section"
            :role="showTabs ? 'tabpanel' : 'region'"
            :aria-labelledby="showTabs ? 'status-tab-incidents' : 'status-incidents-title'"
          >
            <div v-if="!showTabs" class="section-head">
              <h2 id="status-incidents-title">{{ t('incidents.title') }}</h2>
              <span v-if="incidents?.length" class="section-count">
                {{ t('incidents.summary', { n: incidents.length }) }}
              </span>
            </div>
            <ol v-if="incidents?.length" class="rows incident-list">
              <li v-for="(incident, i) in incidents" :key="`incident-${i}`" class="row incident-row">
                <div class="row-main">
                  <div class="row-name">{{ incidentTitle(incident) }}</div>
                  <div class="row-sub">{{ incidentTime(incident) }}</div>
                </div>
                <div class="row-side incident-badges">
                  <span class="badge" :class="incident.impact === 'outage' ? 'badge-bad' : 'badge-warn'">
                    {{ t(`incidents.impact.${incident.impact}`) }}
                  </span>
                  <span class="badge" :class="incident.state === 'open' ? 'badge-bad' : 'badge-good'">
                    {{ t(`incidents.state.${incident.state}`) }}
                  </span>
                </div>
              </li>
            </ol>
            <p v-else class="empty">{{ t('incidents.empty') }}</p>
            <p v-if="incidentsTruncated" class="history-note">
              {{ t('incidents.truncated', { n: incidents?.length ?? 0 }) }}
            </p>
            <p class="history-note">{{ t('incidents.window', { n: incidentWindowDays }) }}</p>
          </section>

          <section
            v-else-if="visibleView === 'agents'"
            id="status-panel-agents"
            key="agents"
            class="section"
            :role="showTabs ? 'tabpanel' : 'region'"
            :aria-labelledby="showTabs ? 'status-tab-agents' : 'status-agents-title'"
          >
            <div v-if="!showTabs" class="section-head">
              <h2 id="status-agents-title">{{ t('agents.title') }}</h2>
              <span v-if="agents?.length" class="section-count">
                {{ t('agents.summary', { online: onlineAgents, total: agents.length }) }}
              </span>
            </div>
            <ul v-if="agents?.length" class="rows">
              <li v-for="(agent, i) in agents" :key="`agent-${i}`" class="row agent-row">
                <div class="row-main">
                  <div class="row-name">{{ agentRowLabel(agent, t) }}</div>
                  <div v-if="agent.status_since" class="row-sub">{{ sinceLabel(agent.status_since) }}</div>
                </div>
                <div class="row-side">
                  <span class="badge" :class="agent.online ? 'badge-good' : 'badge-bad'">
                    {{ agent.online ? t('agents.online') : t('agents.offline') }}
                  </span>
                </div>
                <!-- Present only when the page publishes resource detail AND the
                     node actually reported some. Every cell below is rendered only
                     if its family is present: a denied permission is a gap, and a
                     gap must not render as a zero. -->
                <div
                  v-if="hasResources(agent.resources)"
                  class="row-detail"
                  :class="{ 'res-stale': agent.resources?.stale }"
                >
                  <dl class="res-grid">
                    <div v-if="agent.resources?.cpu_pct != null" class="res-cell">
                      <dt>{{ t('res.cpu') }}</dt>
                      <dd :class="`tone-${usageTone(agent.resources.cpu_pct)}`">
                        {{ formatPct(agent.resources.cpu_pct) }}
                      </dd>
                    </div>
                    <div v-if="agent.resources?.load" class="res-cell res-wide">
                      <dt>{{ t('res.load') }}</dt>
                      <dd>
                        <span class="res-primary">
                          {{ t('res.loadPrimary', { value: formatLoadValue(agent.resources.load[0]) }) }}
                        </span>
                        <small class="res-secondary">
                          {{ t('res.loadSecondary', {
                            five: formatLoadValue(agent.resources.load[1]),
                            fifteen: formatLoadValue(agent.resources.load[2]),
                          }) }}
                        </small>
                      </dd>
                    </div>
                    <div v-if="agent.resources?.mem_pct != null" class="res-cell res-wide">
                      <dt>{{ t('res.memory') }}</dt>
                      <dd :class="`tone-${usageTone(agent.resources.mem_pct)}`">
                        <span class="res-primary">{{ formatPct(agent.resources.mem_pct) }}</span>
                        <small v-if="agent.resources.mem_total != null" class="res-total">
                          {{ t('res.ofTotal', {
                            used: formatBytes(agent.resources.mem_used),
                            total: formatBytes(agent.resources.mem_total),
                          }) }}
                        </small>
                      </dd>
                    </div>
                    <div v-if="agent.resources?.disk_pct != null" class="res-cell res-wide">
                      <dt>{{ t('res.disk') }}</dt>
                      <dd :class="`tone-${usageTone(agent.resources.disk_pct)}`">
                        <span class="res-primary">{{ formatPct(agent.resources.disk_pct) }}</span>
                        <small v-if="agent.resources.disk_total != null" class="res-total">
                          {{ t('res.ofTotal', {
                            used: formatBytes(agent.resources.disk_used),
                            total: formatBytes(agent.resources.disk_total),
                          }) }}
                        </small>
                      </dd>
                    </div>
                    <div v-if="agent.resources?.rx_bps != null || agent.resources?.tx_bps != null" class="res-cell res-wide">
                      <dt>{{ t('res.network') }}</dt>
                      <dd class="res-io">
                        <span v-if="agent.resources?.rx_bps != null">↓ {{ formatBps(agent.resources.rx_bps) }}</span>
                        <span v-if="agent.resources?.tx_bps != null">↑ {{ formatBps(agent.resources.tx_bps) }}</span>
                      </dd>
                    </div>
                    <div v-if="agent.resources?.uptime_s != null" class="res-cell res-runtime">
                      <dt>{{ t('res.uptime') }}</dt>
                      <dd>{{ formatUptime(agent.resources.uptime_s, t) }}</dd>
                    </div>
                  </dl>
                  <p v-if="agent.resources?.stale" class="res-note">{{ t('res.stale') }}</p>
                </div>
              </li>
            </ul>
            <p v-else class="empty">{{ t('agents.empty') }}</p>
          </section>

          <section
            v-else
            id="status-panel-targets"
            key="targets"
            class="section"
            :role="showTabs ? 'tabpanel' : 'region'"
            :aria-labelledby="showTabs ? 'status-tab-targets' : 'status-targets-title'"
          >
            <div v-if="!showTabs" class="section-head">
              <h2 id="status-targets-title">{{ t('targets.title') }}</h2>
              <span v-if="targets?.length" class="section-count">
                {{ t('targets.summary', { up: upTargets, total: targets.length }) }}
              </span>
            </div>
            <ul v-if="targets?.length" class="rows">
              <li v-for="(target, i) in targets" :key="`target-${i}`" class="row target-row">
                <div class="row-main">
                  <div class="row-name">
                    <!-- The chip is dropped for an unnamed target: its fallback label
                         already leads with the kind, and both would read "Ping Ping
                         target 1". -->
                    <span v-if="target.name" class="chip">{{ kindLabel(target.kind, t) }}</span>
                    {{ targetRowLabel(target, t) }}
                  </div>
                  <div v-if="target.address" class="row-sub"><code>{{ target.address }}</code></div>
                </div>
                <div class="row-side">
                  <span class="badge" :class="`badge-${STATUS_TONE[target.status]}`">
                    {{ t(`targets.status.${target.status}`) }}
                  </span>
                </div>
                <div class="row-detail">
                  <div class="uptime-block">
                    <UptimeBar
                      :days="target.days"
                      :from="daysFrom"
                      :bar-label="t('targets.barTitle')"
                      :summary="daySummary"
                    />
                    <div class="bar-scale">
                      <span>{{ t('targets.barStart', { n: target.days.length }) }}</span>
                      <span>{{ t('targets.barEnd') }}</span>
                    </div>
                  </div>
                  <dl class="avail-grid">
                    <div v-for="a in target.availability" :key="a.window" class="avail-cell">
                      <dt>{{ windowLabel(a.window, t) }}</dt>
                      <!-- Null ratio is "no verdict in this window", which must not
                           read as an outage; the em dash says so. -->
                      <dd :title="a.rounds ? t('targets.rounds', { n: a.rounds }) : t('targets.availabilityUnknown')">
                        {{ formatAvailability(a.ratio) ?? '—' }}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            </ul>
            <p v-else class="empty">{{ t('targets.empty') }}</p>
          </section>
          </Transition>
        </section>
      </template>

      <section v-else-if="loading" class="notice notice-loading" role="status" aria-live="polite">
        <span class="loading-track" aria-hidden="true"></span>
        <p>{{ t('loading') }}</p>
      </section>

      <section v-else-if="notFound" class="notice" role="alert">
        <h1>{{ t('notFound.title') }}</h1>
        <p>{{ t('notFound.body') }}</p>
        <button type="button" class="retry-button" @click="load('navigate')">{{ t('retry') }}</button>
      </section>

      <section v-else-if="!slug" class="notice">
        <h1>{{ t('noSlug.title') }}</h1>
        <p>{{ t('noSlug.body') }}</p>
      </section>

      <section v-else class="notice" role="alert">
        <h1>{{ t('error.title') }}</h1>
        <p>{{ t('error.body') }}</p>
        <button type="button" class="retry-button" @click="load('navigate')">{{ t('retry') }}</button>
      </section>
    </main>

    <footer class="site-foot">
      <i18n-t keypath="poweredBy" tag="span">
        <template #brand>
          <a href="https://nettact.org/" target="_blank" rel="noopener noreferrer">NetTact</a>
        </template>
      </i18n-t>
      <span aria-hidden="true">//</span>
      <span>{{ t('pageLabel') }}</span>
    </footer>
  </div>
</template>
