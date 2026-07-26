import type { AgentOverallStatus, AgentStatusRow } from '../api'
import { agentLabel } from './agentLabel'

// Pure filter/search/sort/count helpers for the Agent status list (AGENT-001),
// mirroring targetStatusPage.ts. No i18n or Vue here — the view resolves labels
// and owns URL-query sync.

// Sort/severity priority: offline worst, ok best (also the summary-card order).
export const AGENT_STATUS_ORDER: AgentOverallStatus[] = ['offline', 'abnormal', 'never_connected', 'ok']

const STATUS_RANK = new Map(AGENT_STATUS_ORDER.map((status, index) => [status, index]))

export function statusRank(status: AgentOverallStatus): number {
  return STATUS_RANK.get(status) ?? AGENT_STATUS_ORDER.length
}

// The status filter is either a real status, "all", or the orthogonal "muted"
// facet (muted agents keep a real status; muted is shown as an extra filter).
export type AgentFilter = 'all' | AgentOverallStatus | 'muted'

export interface AgentCounts {
  total: number
  muted: number
  byStatus: Record<AgentOverallStatus, number>
}

export function countStatuses(rows: AgentStatusRow[]): AgentCounts {
  const byStatus = Object.fromEntries(AGENT_STATUS_ORDER.map((s) => [s, 0])) as Record<AgentOverallStatus, number>
  const out: AgentCounts = { total: rows.length, muted: 0, byStatus }
  for (const row of rows) {
    out.byStatus[row.status] = (out.byStatus[row.status] ?? 0) + 1
    if (row.connectivity_alerts_muted) out.muted++
  }
  return out
}

export function isAgentFilter(value: string): value is AgentFilter {
  return value === 'all' || value === 'muted' || AGENT_STATUS_ORDER.includes(value as AgentOverallStatus)
}

export function matchesAgentFilter(row: AgentStatusRow, filter: AgentFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'muted') return row.connectivity_alerts_muted
  return row.status === filter
}

// Group filter: a group id, "ungrouped" (agents in no group), or "all".
export function matchesGroup(row: AgentStatusRow, groupId: string): boolean {
  if (!groupId || groupId === 'all') return true
  if (groupId === 'ungrouped') return row.groups.length === 0
  return row.groups.some((g) => g.id === groupId)
}

export function matchesAgentSearch(row: AgentStatusRow, rawSearch: string): boolean {
  const search = rawSearch.trim().toLocaleLowerCase()
  if (!search) return true
  const values = [row.display_name, row.hostname, row.id, row.agent_version]
  return values.some((v) => v.toLocaleLowerCase().includes(search))
}

// Stable sort: status rank → name (display→hostname) → id tiebreak.
export function sortAgents(rows: AgentStatusRow[]): AgentStatusRow[] {
  return [...rows].sort((a, b) =>
    statusRank(a.status) - statusRank(b.status)
    || agentLabel(a).localeCompare(agentLabel(b))
    || a.id.localeCompare(b.id),
  )
}

export interface AgentFilters {
  search: string
  groupId: string
  status: AgentFilter
}

export function filterAndSortAgents(rows: AgentStatusRow[], filters: AgentFilters): AgentStatusRow[] {
  return sortAgents(
    rows.filter((row) =>
      matchesAgentSearch(row, filters.search)
      && matchesGroup(row, filters.groupId)
      && matchesAgentFilter(row, filters.status),
    ),
  )
}

// sampleAge returns whole seconds between a sample timestamp and `now` (ms), or
// null when the timestamp is missing/invalid. The caller formats it.
export function sampleAge(ts: string | null | undefined, nowMs: number): number | null {
  if (!ts) return null
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((nowMs - t) / 1000))
}
