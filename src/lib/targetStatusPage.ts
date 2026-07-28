import type { AgentGroup, DisplayState, MonitorGroup, TargetStatusRow } from '../api'

export type StatusBucket = 'abnormal' | 'attention' | 'healthy' | 'inactive'
export type StatusFilter = 'all' | StatusBucket | DisplayState

export const DISPLAY_STATE_ORDER: DisplayState[] = [
  'faulted',
  'confirming',
  'partial_failure',
  'probe_failed',
  'blocked',
  'agent_offline',
  'pending',
  'stale',
  'no_data',
  'healthy',
  'unassigned',
  'disabled',
]

const DISPLAY_RANK = new Map(DISPLAY_STATE_ORDER.map((state, index) => [state, index]))

const ATTENTION_STATES = new Set<DisplayState>(['agent_offline', 'pending', 'stale', 'no_data', 'unassigned'])

export function statusBucket(state: DisplayState): StatusBucket {
  if (state === 'healthy') return 'healthy'
  if (state === 'disabled') return 'inactive'
  if (ATTENTION_STATES.has(state)) return 'attention'
  return 'abnormal'
}

export interface StatusCounts {
  total: number
  abnormal: number
  attention: number
  healthy: number
  inactive: number
  byState: Record<DisplayState, number>
}

export function countStatuses(rows: TargetStatusRow[]): StatusCounts {
  const byState = Object.fromEntries(DISPLAY_STATE_ORDER.map((state) => [state, 0])) as Record<DisplayState, number>
  const out: StatusCounts = { total: rows.length, abnormal: 0, attention: 0, healthy: 0, inactive: 0, byState }
  for (const row of rows) {
    out.byState[row.display_state] = (out.byState[row.display_state] ?? 0) + 1
    out[statusBucket(row.display_state)]++
  }
  return out
}

export interface TargetStatusFilters {
  search: string
  groupId: string
  status: StatusFilter
  agentId: string
}

export interface TargetStatusGroupView {
  id: string
  name: string
  group: MonitorGroup | null
  agentGroupNames: string[]
  orphaned: boolean
  targets: TargetStatusRow[]
  allTargets: TargetStatusRow[]
  counts: StatusCounts
  rank: number
}

export function isStatusFilter(value: string): value is StatusFilter {
  return value === 'all' || value === 'abnormal' || value === 'attention' || value === 'healthy' || value === 'inactive'
    || DISPLAY_STATE_ORDER.includes(value as DisplayState)
}

export function matchesStatus(row: TargetStatusRow, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'abnormal' || filter === 'attention' || filter === 'healthy' || filter === 'inactive') {
    return statusBucket(row.display_state) === filter
  }
  return row.display_state === filter
}

export function matchesTargetSearch(row: TargetStatusRow, rawSearch: string): boolean {
  const search = rawSearch.trim().toLocaleLowerCase()
  if (!search) return true
  const values = [
    row.name,
    row.target,
    row.kind,
    row.target_id,
    ...row.agents.flatMap((agent) => [agent.agent_name, agent.agent_id]),
  ]
  return values.some((value) => value.toLocaleLowerCase().includes(search))
}

function rowRank(row: TargetStatusRow): number {
  return DISPLAY_RANK.get(row.display_state) ?? DISPLAY_STATE_ORDER.length
}

function sortRows(rows: TargetStatusRow[]): TargetStatusRow[] {
  return [...rows].sort((a, b) =>
    rowRank(a) - rowRank(b)
    || (a.name || a.target).localeCompare(b.name || b.target)
    || a.target_id.localeCompare(b.target_id),
  )
}

export function buildStatusGroups(
  groups: MonitorGroup[],
  rows: TargetStatusRow[],
  agentGroups: AgentGroup[],
  filters: TargetStatusFilters,
): TargetStatusGroupView[] {
  const groupByID = new Map(groups.map((group) => [group.id, group]))
  const rowsByGroup = new Map<string, TargetStatusRow[]>()
  for (const row of rows) {
    const list = rowsByGroup.get(row.group_id) ?? []
    list.push(row)
    rowsByGroup.set(row.group_id, list)
  }

  const ids = [...groups.map((group) => group.id)]
  for (const id of rowsByGroup.keys()) if (!groupByID.has(id)) ids.push(id)
  const activeFilter = !!filters.search.trim() || filters.status !== 'all' || !!filters.agentId

  const views: TargetStatusGroupView[] = []
  for (const id of ids) {
    if (filters.groupId && filters.groupId !== id) continue
    const group = groupByID.get(id) ?? null
    const allTargets = sortRows(rowsByGroup.get(id) ?? [])
    const targets = allTargets.filter((row) =>
      matchesTargetSearch(row, filters.search)
      && matchesStatus(row, filters.status)
      && (!filters.agentId || row.agents.some((agent) => agent.agent_id === filters.agentId)),
    )
    // Empty configured groups belong in the default view and when explicitly
    // selected. During a target/status/Agent filter, unrelated empty groups add
    // noise and are omitted.
    if (!targets.length && activeFilter && filters.groupId !== id) continue

    const counts = countStatuses(allTargets)
    const rank = allTargets.length ? Math.min(...allTargets.map(rowRank)) : DISPLAY_STATE_ORDER.length + 1
    views.push({
      id,
      name: group?.name || id,
      group,
      agentGroupNames: group
        ? group.agent_group_ids.map((agentGroupID) => agentGroups.find((item) => item.id === agentGroupID)?.name || agentGroupID)
        : [],
      orphaned: !group,
      targets,
      allTargets,
      counts,
      rank,
    })
  }

  return views.sort((a, b) =>
    a.rank - b.rank
    || Number(b.group?.is_default || false) - Number(a.group?.is_default || false)
    || a.name.localeCompare(b.name),
  )
}

