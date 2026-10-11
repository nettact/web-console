import { describe, expect, it } from 'vitest'
import type { AgentGroup, MonitorGroup, RouteAgentSummary, RouteTargetSummary, TargetAgentStatusRow, TargetStatusRow } from '../api'
import {
  ROUTE_RECENT_CHANGE_MS,
  buildRouteSection,
  buildRouteTargetView,
  isRecentChange,
  isRouteAbnormal,
  rollUpRouteStates,
  routeAgentState,
  routeMatchesStatus,
  routeStateTone,
  routeTargetState,
  summarizeRouteTargets,
} from './routeStatus'
import { buildAvailabilityGroups, countStatuses, availabilityRows } from './targetStatusPage'
import {
  buildAgentTargetViews,
  countAgentTargets,
  effectiveTargetTab,
  parseTargetWorkspaceTab,
} from './targetStatusAgentView'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

const asA = { asn: 64500, as_name: 'Access', as_country: 'US' }
const asB = { asn: 64501, as_name: 'Backbone', as_country: 'US' }
const asC = { asn: 64502, as_name: 'Other', as_country: 'DE' }

function ra(over: Partial<RouteAgentSummary> = {}): RouteAgentSummary {
  return {
    agent_id: 'a1',
    agent_name: 'Home',
    status: 'active',
    last_run_at: iso(5 * MIN),
    current_since: iso(3 * 24 * HOUR),
    as_path: [asA, asB],
    dest_ip: '192.0.2.1',
    reached_ratio: 1,
    rtt_p50_ms: 20,
    last_change_at: null,
    changes_24h: 0,
    changes_7d: 0,
    interval_seconds: 600,
    ...over,
  }
}

function tagent(id: string, over: Partial<TargetAgentStatusRow> = {}): TargetAgentStatusRow {
  return {
    agent_id: id,
    agent_name: id,
    agent_online: true,
    execution_state: 'collecting',
    probe_state: 'no_data',
    fault_state: 'normal',
    reason_code: 'probe_no_data',
    missing_permissions: [],
    matched_selector: 'all',
    block_reason: '',
    availability_rounds: 0,
    availability_ok_rounds: 0,
    ...over,
  }
}

function row(id: string, kind: string, over: Partial<TargetStatusRow> = {}): TargetStatusRow {
  return {
    target_id: id,
    group_id: 'g1',
    name: id,
    kind,
    target: `${id}.example.test`,
    enabled: true,
    display_state: kind === 'trace' ? 'no_data' : 'faulted',
    applicable_agents: 1,
    affected_agents: kind === 'trace' ? 0 : 1,
    availability_rounds: 0,
    availability_ok_rounds: 0,
    signal_ids: [],
    incident_ids: [],
    agents: [tagent('a1')],
    ...over,
  }
}

describe('routeAgentState', () => {
  it('blocks on every status that rules the monitor out, even with data', () => {
    for (const status of ['permission_blocked', 'unsupported', 'agent_upgrade_required'] as const) {
      expect(routeAgentState(ra({ status }), NOW)).toBe('blocked')
      expect(routeAgentState(ra({ status, current_since: null }), NOW)).toBe('blocked')
    }
  })

  it('turns stale only strictly past three intervals', () => {
    const interval = 600
    expect(routeAgentState(ra({ last_run_at: iso(3 * interval * 1000) }), NOW)).toBe('stable')
    expect(routeAgentState(ra({ last_run_at: iso(3 * interval * 1000 + 1) }), NOW)).toBe('stale')
    // The interval comes from the summary, not a constant.
    expect(routeAgentState(ra({ interval_seconds: 1800, last_run_at: iso(80 * MIN) }), NOW)).toBe('stable')
    expect(routeAgentState(ra({ interval_seconds: 1800, last_run_at: iso(91 * MIN) }), NOW)).toBe('stale')
  })

  it('stale outranks a recent change', () => {
    expect(routeAgentState(ra({ last_run_at: iso(2 * HOUR), last_change_at: iso(3 * HOUR) }), NOW)).toBe('stale')
  })

  it('is pending without a current epoch, including status pending', () => {
    expect(routeAgentState(ra({ current_since: null, last_run_at: null }), NOW)).toBe('pending')
    expect(routeAgentState(ra({ status: 'pending', current_since: null, last_run_at: null }), NOW)).toBe('pending')
    // No data is never stale, however old the last run.
    expect(routeAgentState(ra({ current_since: null, last_run_at: iso(48 * HOUR) }), NOW)).toBe('pending')
  })

  it('reads changed for 24 hours after a change, inclusive', () => {
    expect(routeAgentState(ra({ last_change_at: iso(ROUTE_RECENT_CHANGE_MS) }), NOW)).toBe('changed')
    expect(routeAgentState(ra({ last_change_at: iso(ROUTE_RECENT_CHANGE_MS + 1) }), NOW)).toBe('stable')
    expect(isRecentChange(iso(-MIN), NOW)).toBe(true) // slight clock skew
    expect(isRecentChange(null, NOW)).toBe(false)
  })
})

describe('target roll-up', () => {
  it('ranks blocked > stale > changed > stable > pending', () => {
    expect(rollUpRouteStates(['pending', 'stable', 'changed', 'stale', 'blocked'])).toBe('blocked')
    expect(rollUpRouteStates(['pending', 'stable', 'changed', 'stale'])).toBe('stale')
    expect(rollUpRouteStates(['pending', 'stable', 'changed'])).toBe('changed')
    expect(rollUpRouteStates(['pending', 'stable'])).toBe('stable')
    expect(rollUpRouteStates(['pending'])).toBe('pending')
  })

  it('is unassigned with no Agent', () => {
    expect(routeTargetState([], NOW)).toBe('unassigned')
  })

  it('counts only blocked and stale as abnormal; a change is info, not a warning', () => {
    expect(isRouteAbnormal('blocked')).toBe(true)
    expect(isRouteAbnormal('stale')).toBe(true)
    for (const s of ['changed', 'stable', 'pending', 'unassigned', 'disabled'] as const) expect(isRouteAbnormal(s)).toBe(false)
    expect(routeStateTone('changed')).toBe('info')
    expect(routeStateTone('blocked')).toBe('danger')
    expect(routeStateTone('stale')).toBe('warning')
    expect(routeStateTone('stable')).toBe('ok')
    expect(routeStateTone('pending')).toBe('neutral')
  })
})

describe('route target view', () => {
  it('shows the first Agent with data and counts other distinct paths', () => {
    const summary: RouteTargetSummary = {
      target_id: 't1',
      agents: [
        ra({ agent_id: 'a0', current_since: null, as_path: [], last_run_at: null }),
        ra({ agent_id: 'a1', as_path: [asA, asB], changes_7d: 2, changes_24h: 1, last_run_at: iso(9 * MIN) }),
        ra({ agent_id: 'a2', as_path: [asA, asB], changes_7d: 1, last_run_at: iso(1 * MIN) }),
        ra({ agent_id: 'a3', as_path: [asA, asC] }),
        ra({ agent_id: 'a4', as_path: [asC] }),
      ],
    }
    const view = buildRouteTargetView(row('t1', 'trace'), summary, NOW)
    expect(view.primary?.agent_id).toBe('a1')
    expect(view.otherPaths).toBe(2)
    expect(view.changes7d).toBe(3)
    expect(view.changes24h).toBe(1)
    expect(view.lastRunAt).toBe(iso(1 * MIN))
  })

  it('reads pending before the batch lands and disabled when switched off', () => {
    expect(buildRouteTargetView(row('t1', 'trace'), undefined, NOW).state).toBe('pending')
    expect(buildRouteTargetView(row('t1', 'trace', { enabled: false }), undefined, NOW).state).toBe('disabled')
    expect(buildRouteTargetView(row('t1', 'trace'), { target_id: 't1', agents: [] }, NOW).state).toBe('unassigned')
  })

  it('maps the page status filter onto route states', () => {
    expect(routeMatchesStatus('stale', 'abnormal')).toBe(true)
    expect(routeMatchesStatus('changed', 'abnormal')).toBe(false)
    expect(routeMatchesStatus('changed', 'healthy')).toBe(true)
    expect(routeMatchesStatus('pending', 'attention')).toBe(true)
    expect(routeMatchesStatus('blocked', 'blocked')).toBe(true)
    expect(routeMatchesStatus('stable', 'faulted')).toBe(false)
  })
})

describe('target-list split', () => {
  const groups: MonitorGroup[] = [
    { id: 'g1', site_id: 's', name: 'Mixed', is_default: true, merge_enabled: true, all_agents: true, agent_group_ids: [] } as MonitorGroup,
    { id: 'g2', site_id: 's', name: 'Routes only', is_default: false, merge_enabled: true, all_agents: true, agent_group_ids: [] } as MonitorGroup,
    { id: 'g3', site_id: 's', name: 'Empty', is_default: false, merge_enabled: true, all_agents: true, agent_group_ids: [] } as MonitorGroup,
  ]
  const agentGroups: AgentGroup[] = []
  const rows = [
    row('dns', 'dns'),
    row('trace-a', 'trace', { name: 'Route to CDN' }),
    row('trace-b', 'trace', { group_id: 'g2', name: 'Route to office' }),
  ]
  const summaries = new Map<string, RouteTargetSummary>([
    ['trace-a', { target_id: 'trace-a', agents: [ra({ last_change_at: iso(HOUR), changes_24h: 2 })] }],
    ['trace-b', { target_id: 'trace-b', agents: [ra({ last_run_at: iso(5 * HOUR) })] }],
  ])
  const noFilter = { search: '', groupId: '', status: 'all' as const, agentId: '' }

  it('keeps route monitors out of the availability groups, counts and buckets', () => {
    const views = buildAvailabilityGroups(groups, rows, agentGroups, noFilter)
    expect(views.map((v) => v.id)).toEqual(['g1', 'g3']) // route-only group dropped, empty one kept
    expect(views[0].allTargets.map((r) => r.target_id)).toEqual(['dns'])
    const counts = countStatuses(availabilityRows(rows))
    expect(counts.total).toBe(1)
    expect(counts.byState.no_data).toBe(0)
  })

  it('lists every route monitor in its own section with its own summary', () => {
    const section = buildRouteSection(rows, summaries, NOW, noFilter)
    expect(section.all.map((v) => [v.target.target_id, v.state])).toEqual([['trace-b', 'stale'], ['trace-a', 'changed']])
    expect(summarizeRouteTargets(section.all)).toEqual({ total: 2, changes24h: 2, abnormal: 1 })
  })

  it('applies search, group and status filters to the route section', () => {
    expect(buildRouteSection(rows, summaries, NOW, { ...noFilter, search: 'office' }).visible.map((v) => v.target.target_id)).toEqual(['trace-b'])
    expect(buildRouteSection(rows, summaries, NOW, { ...noFilter, groupId: 'g1' }).visible.map((v) => v.target.target_id)).toEqual(['trace-a'])
    expect(buildRouteSection(rows, summaries, NOW, { ...noFilter, status: 'abnormal' }).visible.map((v) => v.target.target_id)).toEqual(['trace-b'])
    // A route change is not abnormal.
    expect(buildRouteSection(rows, summaries, NOW, { ...noFilter, status: 'healthy' }).visible.map((v) => v.target.target_id)).toEqual(['trace-a'])
  })
})

describe('Agent view route rows', () => {
  const groups = [{ id: 'g1', name: 'Mixed' } as MonitorGroup]

  it('counts a trace target as abnormal only when blocked or stale', () => {
    const rows = [
      row('changed', 'trace'),
      row('stale', 'trace'),
      row('blocked', 'trace', { agents: [tagent('a1', { execution_state: 'permission_blocked' })] }),
      row('pending', 'trace'),
      row('missing', 'trace'),
    ]
    const routes = new Map<string, RouteTargetSummary>([
      ['changed', { target_id: 'changed', agents: [ra({ last_change_at: iso(HOUR) })] }],
      ['stale', { target_id: 'stale', agents: [ra({ last_run_at: iso(2 * HOUR) })] }],
      ['blocked', { target_id: 'blocked', agents: [ra({ status: 'permission_blocked' })] }],
      ['pending', { target_id: 'pending', agents: [ra({ current_since: null, last_run_at: null })] }],
    ])
    const views = buildAgentTargetViews(rows, 'a1', groups, routes, NOW)
    expect(Object.fromEntries(views.map((v) => [v.target.target_id, [v.route?.state, v.tone]]))).toEqual({
      changed: ['changed', 'healthy'],
      stale: ['stale', 'abnormal'],
      blocked: ['blocked', 'abnormal'],
      pending: ['pending', 'attention'],
      missing: ['pending', 'attention'],
    })
    expect(countAgentTargets(views).abnormal).toBe(2)
  })

  it('ignores availability fields for trace rows without a summary', () => {
    // Even a row whose availability-side fields look failed is not abnormal
    // for a route monitor; only the route summary decides.
    const r = row('t', 'trace', { agents: [tagent('a1', { probe_state: 'failed', fault_state: 'faulted' })] })
    const [view] = buildAgentTargetViews([r], 'a1', groups)
    expect(view.tone).toBe('attention')
    expect(countAgentTargets([view]).abnormal).toBe(0)
  })
})

describe('target workspace tabs', () => {
  it('maps the old route tab to overview and keeps tabs within each workspace', () => {
    expect(parseTargetWorkspaceTab('route')).toBe('overview')
    expect(parseTargetWorkspaceTab('changes')).toBe('changes')
    expect(parseTargetWorkspaceTab('bogus')).toBe('overview')
    expect(effectiveTargetTab('history', true)).toBe('overview')
    expect(effectiveTargetTab('path', true)).toBe('path')
    expect(effectiveTargetTab('changes', false)).toBe('overview')
    expect(effectiveTargetTab('agents', false)).toBe('agents')
  })
})
