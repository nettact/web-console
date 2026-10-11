import { computed, effectScope, reactive, watch, type EffectScope } from 'vue'
import { api, type RouteTargetSummary } from './api'
import { targetStatus } from './targetStatus'

// Current route of every route monitor (kind "trace") in the site, a reactive
// singleton beside targetStatus.ts. Route monitors carry no availability
// verdict, so the status page reads their state from this batch instead.
//
// It follows the target-status store rather than holding its own stream: every
// time a target-status snapshot lands (init, SSE burst, focus, reconnect) this
// refreshes too — but only while the site actually has route monitors, so a site
// without any never issues the request. Route checks run every few minutes and
// staleness is judged against wall-clock time, so a slow poll also re-fetches
// and advances `now`; the store only runs while the tab is visible.
//
// Failure behaviour mirrors targetStatus: a failed refresh keeps the last good
// batch and flags `stale`; a failure with no prior batch sets `error`.

const SITE = 'site_default'
const POLL_INTERVAL_MS = 60000

export const routeSummaries = reactive<{
  asnDbVersion: string
  targets: RouteTargetSummary[]
  loaded: boolean
  stale: boolean
  error: string
  // Wall clock the route states are judged against. Advanced on every poll
  // tick and every landed batch, so "stale" and "recent change" age in place.
  now: number
}>({
  asnDbVersion: '',
  targets: [],
  loaded: false,
  stale: false,
  error: '',
  now: Date.now(),
})

export const routeSummaryIndex = computed(() => {
  const m = new Map<string, RouteTargetSummary>()
  for (const row of routeSummaries.targets) m.set(row.target_id, row)
  return m
})

const hasRouteTargets = (): boolean => targetStatus.targets.some((row) => row.kind === 'trace')

let started = false
let scope: EffectScope | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let inFlight = false
let pendingDemand = false
let lifecycle = 0

// Single-flight batch fetch with one trailing refresh for triggers that land
// mid-request — the same convergence contract as refreshTargetStatus().
export async function refreshRouteSummaries(): Promise<void> {
  if (inFlight) {
    pendingDemand = true
    return
  }
  const runLifecycle = lifecycle
  inFlight = true
  try {
    do {
      pendingDemand = false
      try {
        const r = await api.routeSummaries(SITE)
        if (lifecycle !== runLifecycle) return
        routeSummaries.targets = r.targets ?? []
        routeSummaries.asnDbVersion = r.asn_db_version ?? ''
        routeSummaries.loaded = true
        routeSummaries.stale = false
        routeSummaries.error = ''
        routeSummaries.now = Date.now()
      } catch (e) {
        if (lifecycle !== runLifecycle) return
        if (routeSummaries.loaded) routeSummaries.stale = true
        else routeSummaries.error = String((e as Error).message || e)
      }
    } while (pendingDemand)
  } finally {
    if (lifecycle === runLifecycle) inFlight = false
  }
}

function refreshIfNeeded(): void {
  routeSummaries.now = Date.now()
  if (hasRouteTargets()) void refreshRouteSummaries()
}

// Idempotent; called from App.vue next to initTargetStatus().
export function initRouteSummaries(): void {
  if (started) return
  started = true
  scope = effectScope(true)
  scope.run(() => {
    // A new target-status snapshot (including the first one) is the cue.
    watch(() => targetStatus.generatedAt, refreshIfNeeded, { immediate: true })
  })
  pollTimer = setInterval(refreshIfNeeded, POLL_INTERVAL_MS)
}

// Suspend WITHOUT dropping the batch, like stopTargetStatus().
export function stopRouteSummaries(): void {
  started = false
  scope?.stop()
  scope = null
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  lifecycle++
  inFlight = false
  pendingDemand = false
}

// Full teardown for session end.
export function resetRouteSummaries(): void {
  stopRouteSummaries()
  routeSummaries.asnDbVersion = ''
  routeSummaries.targets = []
  routeSummaries.loaded = false
  routeSummaries.stale = false
  routeSummaries.error = ''
}
