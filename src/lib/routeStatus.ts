// Route-monitor state on the status page. A route monitor (kind "trace") is
// about the path, not about availability: the server never gives it an
// availability verdict, so its health here is derived from the batch route
// summary instead — per Agent first, then rolled up to the target.
//
// The one deliberate asymmetry: a confirmed route change is NOT abnormal. Paths
// move for ordinary reasons (carrier rebalancing, maintenance), so a recent
// change is surfaced as an informational hint with its own tone, and only a
// monitor that cannot run (blocked) or has stopped reporting (stale) counts
// toward any abnormal total. Pure functions only; no Vue, no i18n.

import type { ASHop, RouteAgentStatus, RouteAgentSummary, RouteTargetSummary, TargetStatusRow } from '../api'
import { matchesTargetSearch, type StatusFilter, type TargetStatusFilters } from './targetStatusPage'

export type RouteState = 'blocked' | 'stale' | 'pending' | 'changed' | 'stable'
// Target level adds two states no single Agent can have: nobody runs it, or it
// is switched off (disabled monitors are absent from the summary batch).
export type RouteTargetState = RouteState | 'unassigned' | 'disabled'
export type RouteTone = 'danger' | 'warning' | 'neutral' | 'info' | 'ok'

// The Agent cannot run the monitor at all — waiting will not fix it.
const BLOCKED_STATUSES = new Set<RouteAgentStatus>(['permission_blocked', 'unsupported', 'agent_upgrade_required'])

// A report older than this many check intervals is out of date. Three gives one
// missed check plus slack for a slow traceroute before the row turns stale.
export const ROUTE_STALE_INTERVALS = 3
// How long a confirmed change keeps the "recent change" hint.
export const ROUTE_RECENT_CHANGE_MS = 24 * 3600 * 1000
// Used only when a summary carries no usable interval (older server, bad data).
const FALLBACK_INTERVAL_S = 600

function ts(value: string | null | undefined): number | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

// True when the timestamp falls inside the recent-change window ending at now.
// A timestamp slightly in the future (clock skew between browser and server)
// still counts as recent rather than silently dropping the hint.
export function isRecentChange(lastChangeAt: string | null | undefined, now: number): boolean {
  const t = ts(lastChangeAt)
  return t != null && now - t <= ROUTE_RECENT_CHANGE_MS
}

// The per-Agent state. Checked in table order: blocked, stale, pending,
// changed, stable — so a stale Agent that also changed recently reads stale.
export function routeAgentState(agent: RouteAgentSummary, now: number): RouteState {
  if (BLOCKED_STATUSES.has(agent.status)) return 'blocked'
  const hasData = agent.current_since != null && agent.current_since !== ''
  if (hasData) {
    const lastRun = ts(agent.last_run_at)
    const interval = agent.interval_seconds > 0 ? agent.interval_seconds : FALLBACK_INTERVAL_S
    // Strictly greater: exactly three intervals old is still on time.
    if (lastRun != null && now - lastRun > ROUTE_STALE_INTERVALS * interval * 1000) return 'stale'
  } else {
    return 'pending'
  }
  if (isRecentChange(agent.last_change_at, now)) return 'changed'
  return 'stable'
}

// Roll-up priority: the most significant Agent state wins. Pending ranks last —
// one Agent still waiting for its first check must not mask what the others see.
const ROLLUP_RANK: Record<RouteState, number> = {
  blocked: 0,
  stale: 1,
  changed: 2,
  stable: 3,
  pending: 4,
}

export function rollUpRouteStates(states: RouteState[]): RouteTargetState {
  if (!states.length) return 'unassigned'
  let best = states[0]
  for (const s of states) if (ROLLUP_RANK[s] < ROLLUP_RANK[best]) best = s
  return best
}

export function routeTargetState(agents: RouteAgentSummary[], now: number): RouteTargetState {
  return rollUpRouteStates(agents.map((agent) => routeAgentState(agent, now)))
}

// Only these count toward abnormal totals (site, group, Agent). A recent change
// does not.
export function isRouteAbnormal(state: RouteTargetState): boolean {
  return state === 'blocked' || state === 'stale'
}

export function routeStateTone(state: RouteTargetState): RouteTone {
  switch (state) {
    case 'blocked': return 'danger'
    case 'stale': return 'warning'
    case 'changed': return 'info'
    case 'stable': return 'ok'
    default: return 'neutral'
  }
}

// Ordering for lists: what needs a look first, then recent changes.
const LIST_RANK: Record<RouteTargetState, number> = {
  blocked: 0,
  stale: 1,
  changed: 2,
  pending: 3,
  unassigned: 4,
  stable: 5,
  disabled: 6,
}
export function routeStateRank(state: RouteTargetState): number {
  return LIST_RANK[state]
}

// ---- target-list view ----

function pathKey(path: ASHop[]): string {
  return path.map((hop) => hop.asn).join('>')
}

export interface RouteAgentRow {
  agent: RouteAgentSummary
  state: RouteState
}

export interface RouteTargetView {
  target: TargetStatusRow
  summary: RouteTargetSummary | null
  state: RouteTargetState
  agents: RouteAgentRow[]
  // The Agent whose path the row shows: the first one that has data.
  primary: RouteAgentSummary | null
  // How many other, distinct AS paths the remaining Agents currently see.
  otherPaths: number
  changes24h: number
  changes7d: number
  lastRunAt: string | null
}

export function buildRouteTargetView(
  target: TargetStatusRow,
  summary: RouteTargetSummary | undefined,
  now: number,
): RouteTargetView {
  const agentSummaries = summary?.agents ?? []
  const agents = agentSummaries.map((agent) => ({ agent, state: routeAgentState(agent, now) }))
  const withData = agentSummaries.filter((agent) => agent.current_since)
  const primary = withData[0] ?? null
  const primaryKey = primary ? pathKey(primary.as_path) : ''
  const others = new Set<string>()
  for (const agent of withData.slice(1)) {
    const key = pathKey(agent.as_path)
    if (key !== primaryKey) others.add(key)
  }
  let lastRunAt: string | null = null
  let lastRunTs = -Infinity
  for (const agent of agentSummaries) {
    const t = ts(agent.last_run_at)
    if (t != null && t > lastRunTs) {
      lastRunTs = t
      lastRunAt = agent.last_run_at
    }
  }
  let state: RouteTargetState
  if (!target.enabled) state = 'disabled'
  // Not in the batch yet (summary still loading) reads as waiting, not as
  // "nobody runs it" — that verdict needs the server's word.
  else if (!summary) state = 'pending'
  else state = rollUpRouteStates(agents.map((row) => row.state))
  return {
    target,
    summary: summary ?? null,
    state,
    agents,
    primary,
    otherPaths: others.size,
    changes24h: agentSummaries.reduce((sum, agent) => sum + (agent.changes_24h || 0), 0),
    changes7d: agentSummaries.reduce((sum, agent) => sum + (agent.changes_7d || 0), 0),
    lastRunAt,
  }
}

// The availability status filter, applied to route rows where it has an
// equivalent: buckets map onto route states, and the few detailed display
// states that share a name with a route state match it. Other detailed states
// (faulted, probe_failed, ...) describe availability and match no route row.
export function routeMatchesStatus(state: RouteTargetState, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all': return true
    case 'abnormal': return isRouteAbnormal(state)
    case 'attention': return state === 'pending' || state === 'unassigned'
    case 'healthy': return state === 'stable' || state === 'changed'
    case 'inactive': return state === 'disabled'
    default: return state === filter
  }
}

export interface RouteSiteSummary {
  total: number
  changes24h: number
  abnormal: number
}

export function summarizeRouteTargets(rows: RouteTargetView[]): RouteSiteSummary {
  const out: RouteSiteSummary = { total: rows.length, changes24h: 0, abnormal: 0 }
  for (const row of rows) {
    out.changes24h += row.changes24h
    if (isRouteAbnormal(row.state)) out.abnormal++
  }
  return out
}

export function sortRouteTargetViews(rows: RouteTargetView[]): RouteTargetView[] {
  return [...rows].sort((a, b) =>
    routeStateRank(a.state) - routeStateRank(b.state)
    || (a.target.name || a.target.target).localeCompare(b.target.name || b.target.target)
    || a.target.target_id.localeCompare(b.target.target_id),
  )
}

// Seconds since an ISO timestamp, or null when it is absent/unparseable.
export function secondsSince(value: string | null | undefined, now: number): number | null {
  const t = ts(value)
  return t == null ? null : Math.max(0, (now - t) / 1000)
}

export const isRouteTarget = (row: { kind: string }): boolean => row.kind === 'trace'

export interface RouteSection {
  // Every route monitor in the site, for the summary card.
  all: RouteTargetView[]
  // Those passing the page's search / group / status filters, for the list.
  visible: RouteTargetView[]
}

// The route-monitor section of the target view: every trace target, in list
// order, plus the subset the page filters let through. Search matches the same
// fields as the availability list; the group filter applies as is.
export function buildRouteSection(
  rows: TargetStatusRow[],
  summaries: Map<string, RouteTargetSummary>,
  now: number,
  filters: TargetStatusFilters,
): RouteSection {
  const all = sortRouteTargetViews(
    rows.filter(isRouteTarget).map((row) => buildRouteTargetView(row, summaries.get(row.target_id), now)),
  )
  const visible = all.filter((view) =>
    (!filters.groupId || view.target.group_id === filters.groupId)
    && matchesTargetSearch(view.target, filters.search)
    && routeMatchesStatus(view.state, filters.status)
    && (!filters.agentId || view.target.agents.some((agent) => agent.agent_id === filters.agentId)),
  )
  return { all, visible }
}
