import { computed, reactive } from 'vue'
import { api, type AgentStatusRow } from './api'
import { openEventStream, type EventStream } from './lib/sse'

// Authoritative Agent status store (AGENT-001), a reactive singleton mirroring
// targetStatus.ts. It is the ONE source of per-agent health in the console:
// consumers read `agentStatus.agents` (status computed server-side, never
// re-inferred client-side). Convergence is refresh-based — SSE bursts are
// coalesced into a single batch fetch, and a full refresh runs on init,
// focus/visibility regain, and every SSE reconnect — so missed or duplicate
// events can never cause permanent drift.

const SITE = 'site_default'

export const agentStatus = reactive<{
  generatedAt: string
  agents: AgentStatusRow[]
  loaded: boolean
  stale: boolean
  error: string
  live: boolean
}>({
  generatedAt: '',
  agents: [],
  loaded: false,
  stale: false,
  error: '',
  live: false,
})

// agent id → row, for O(1) lookups (used by Incident detail's presence dots).
export const agentIndex = computed(() => {
  const m = new Map<string, AgentStatusRow>()
  for (const row of agentStatus.agents) m.set(row.id, row)
  return m
})

let stream: EventStream | null = null
let started = false
let coalesceTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let inFlight = false
let pendingDemand = false
let lifecycle = 0

// Unlike target status (purely event-driven), agent resource values change with
// every telemetry cycle and the server-computed `stale` flags are time-based, so
// SSE events alone leave an idle console frozen. A slow poll keeps values and
// stale flags fresh; the store only runs while the tab is visible (App.vue stops
// it when hidden), so this never ticks in the background.
const POLL_INTERVAL_MS = 20000

// One authoritative batch fetch with a single in-flight guard: overlapping
// triggers (SSE + focus) collapse to one request, and any trigger seen mid-flight
// drives exactly one trailing refresh so every trigger eventually converges.
export async function refreshAgentStatus(): Promise<void> {
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
        const r = await api.agentStatuses(SITE)
        if (lifecycle !== runLifecycle) return
        agentStatus.agents = r.agents
        agentStatus.generatedAt = r.generated_at
        agentStatus.loaded = true
        agentStatus.stale = false
        agentStatus.error = ''
      } catch (e) {
        if (lifecycle !== runLifecycle) return
        if (agentStatus.loaded) {
          agentStatus.stale = true
        } else {
          agentStatus.error = String((e as Error).message || e)
        }
      }
    } while (pendingDemand)
  } finally {
    if (lifecycle === runLifecycle) inFlight = false
  }
}

// Debounce-coalesce a burst of SSE events into a single batch refresh (~300 ms).
function coalescedRefresh(): void {
  if (coalesceTimer) return
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null
    refreshAgentStatus()
  }, 300)
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') refreshAgentStatus()
}
function onFocus(): void {
  refreshAgentStatus()
}

// Open the stream and seed the initial state. Idempotent; call once from App.vue
// after auth is established (next to initTargetStatus()).
export function initAgentStatus(): void {
  if (started) return
  started = true
  refreshAgentStatus()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  pollTimer = setInterval(refreshAgentStatus, POLL_INTERVAL_MS)
  stream = openEventStream({
    onAgentStatus: () => coalescedRefresh(),
    onOpen: () => refreshAgentStatus(),
  })
  agentStatus.live = true
}

export function stopAgentStatus(): void {
  stream?.close()
  stream = null
  started = false
  if (coalesceTimer) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  lifecycle++
  inFlight = false
  pendingDemand = false
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('focus', onFocus)
  agentStatus.live = false
  agentStatus.loaded = false
  agentStatus.stale = false
  agentStatus.error = ''
  agentStatus.agents = []
  agentStatus.generatedAt = ''
}
