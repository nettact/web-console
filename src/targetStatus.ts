import { computed, reactive } from 'vue'
import { api, type TargetStatusRow } from './api'
import { openEventStream, type EventStream } from './lib/sse'

// Authoritative current target-status store (STATUS-001), a reactive singleton
// mirroring notifications.ts. It is the ONE source of current target health in
// the console: every consumer reads `targetStatus.targets` (never re-inferred
// from metric samples). Convergence is refresh-based — SSE bursts are coalesced
// into a single batch fetch, and a full refresh runs on init, focus/visibility
// regain, and every SSE reconnect — so missed or duplicate events can never
// cause permanent drift.
//
// Failure behaviour: a failed refresh keeps the last successful snapshot and its
// `generatedAt`, flagging `stale`. An initial-load failure (no prior snapshot)
// surfaces `error` instead — never an empty/healthy state.

const SITE = 'site_default'

export const targetStatus = reactive<{
  generatedAt: string
  targets: TargetStatusRow[]
  loaded: boolean // a successful snapshot has been seen at least once
  stale: boolean // showing a prior snapshot after a failed refresh
  error: string // initial-load failure (no snapshot to fall back to)
  live: boolean // SSE stream connected
}>({
  generatedAt: '',
  targets: [],
  loaded: false,
  stale: false,
  error: '',
  live: false,
})

// target_id → row, for O(1) lookups by the current-status consumers.
export const targetIndex = computed(() => {
  const m = new Map<string, TargetStatusRow>()
  for (const row of targetStatus.targets) m.set(row.target_id, row)
  return m
})

let stream: EventStream | null = null
let started = false
let coalesceTimer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
// A trigger (SSE / focus / reconnect) that arrived while a request was already
// in flight. The in-flight request may have started before that trigger's state
// change landed server-side, so it cannot be trusted to reflect it — we run one
// more refresh after it settles. Coalesced into a single follow-up: any number of
// triggers during a request collapse to exactly one extra fetch, and that fetch
// re-checks the flag, so a trigger arriving during the follow-up converges too.
let pendingDemand = false
// Monotonic lifecycle counter. Every stopTargetStatus() bumps it, invalidating
// any refresh run still in flight: a run captures this value at entry and, after
// each await, bails before mutating the store or its single-flight state once the
// lifecycle has moved on. This keeps a request that outlived its session (logout,
// or a later login) from writing success/error/stale/target data into the cleared
// singleton, and stops an old run's cleanup from clobbering a new run's flags.
let lifecycle = 0

// One authoritative batch fetch. Single in-flight guard so overlapping triggers
// (SSE + focus) collapse to one request; the last success always wins. Triggers
// seen mid-flight are not dropped — they set pendingDemand and drive one trailing
// refresh once the current request finishes, so every trigger eventually converges
// without spawning parallel requests or an unbounded loop.
export async function refreshTargetStatus(): Promise<void> {
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
        const r = await api.targetStatuses(SITE)
        // The lifecycle was stopped (or replaced by a later login) while this
        // request was in flight — its result belongs to a session that no longer
        // exists, so drop it rather than write it into the cleared singleton.
        if (lifecycle !== runLifecycle) return
        targetStatus.targets = r.targets
        targetStatus.generatedAt = r.generated_at
        targetStatus.loaded = true
        targetStatus.stale = false
        targetStatus.error = ''
      } catch (e) {
        if (lifecycle !== runLifecycle) return
        if (targetStatus.loaded) {
          // Keep the last good snapshot; mark it possibly outdated.
          targetStatus.stale = true
        } else {
          targetStatus.error = String((e as Error).message || e)
        }
      }
      // Loop only when a fresh trigger landed during the request just settled —
      // bounded by real demand (each iteration awaits a network round-trip), never
      // a busy spin.
    } while (pendingDemand)
  } finally {
    // Release the single-flight guard only if it is still ours: a stop (and
    // possibly a fresh lifecycle's fetch) may have taken it over mid-request, and
    // clearing it here would clobber the new run's in-flight state.
    if (lifecycle === runLifecycle) inFlight = false
  }
}

// Debounce-coalesce a burst of SSE events into a single batch refresh (~300 ms).
function coalescedRefresh(): void {
  if (coalesceTimer) return
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null
    refreshTargetStatus()
  }, 300)
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') refreshTargetStatus()
}
function onFocus(): void {
  refreshTargetStatus()
}

// Open the stream and seed the initial state. Idempotent; call once from App.vue
// after auth is established (next to initNotifications()).
export function initTargetStatus(): void {
  if (started) return
  started = true
  refreshTargetStatus()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  stream = openEventStream({
    onTargetStatus: () => coalescedRefresh(),
    // Every (re)connect: a full refresh converges after any missed frames.
    onOpen: () => refreshTargetStatus(),
  })
  targetStatus.live = true
}

export function stopTargetStatus(): void {
  stream?.close()
  stream = null
  started = false
  if (coalesceTimer) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  // Invalidate any outstanding refresh and reset the single-flight state so the
  // next lifecycle (a later login) can start its own fetch immediately, even
  // while an old network request is still settling — that request now bails on
  // its post-await lifecycle check instead of writing here or stealing the flags.
  lifecycle++
  inFlight = false
  pendingDemand = false
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('focus', onFocus)
  targetStatus.live = false
  targetStatus.loaded = false
  targetStatus.stale = false
  targetStatus.error = ''
  targetStatus.targets = []
  targetStatus.generatedAt = ''
}
