import { describe, expect, it } from 'vitest'
import type { AgentResources, AgentStatusRow } from '../api'
import {
  AGENT_STATUS_ORDER,
  countStatuses,
  filterAndSortAgents,
  isAgentFilter,
  matchesAgentFilter,
  matchesAgentSearch,
  matchesGroup,
  sampleAge,
  sortAgents,
  statusRank,
} from './agentStatusPage'

const noResources: AgentResources = { cpu: null, memory: null, disk: null, net: null, load: null, uptime: null }

function row(over: Partial<AgentStatusRow>): AgentStatusRow {
  return {
    id: over.id ?? 'agent_x',
    display_name: over.display_name ?? '',
    hostname: over.hostname ?? 'host',
    platform: 'linux',
    agent_version: over.agent_version ?? 'v1',
    status: over.status ?? 'ok',
    presence: over.presence ?? 'online',
    status_since: null,
    last_seen_at: null,
    first_connected_at: over.first_connected_at ?? '2026-07-24T00:00:00Z',
    last_disconnect_kind: '',
    connectivity_alerts_muted: over.connectivity_alerts_muted ?? false,
    groups: over.groups ?? [],
    firing_alerts: over.firing_alerts ?? 0,
    active_issues: over.active_issues ?? 0,
    connectivity_alert: null,
    resources: noResources,
    created_at: '2026-07-24T00:00:00Z',
    ...over,
  }
}

describe('status ranking + sort', () => {
  it('orders offline < abnormal < never_connected < ok', () => {
    expect(AGENT_STATUS_ORDER).toEqual(['offline', 'abnormal', 'never_connected', 'ok'])
    expect(statusRank('offline')).toBeLessThan(statusRank('ok'))
  })

  it('is stable: rank, then name, then id', () => {
    const rows = [
      row({ id: 'a3', status: 'ok', hostname: 'zeta' }),
      row({ id: 'a1', status: 'offline', hostname: 'beta' }),
      row({ id: 'a2', status: 'offline', hostname: 'alpha' }),
      row({ id: 'a4', status: 'abnormal', hostname: 'gamma' }),
    ]
    expect(sortAgents(rows).map((r) => r.id)).toEqual(['a2', 'a1', 'a4', 'a3'])
  })

  it('prefers display_name over hostname when sorting', () => {
    const rows = [
      row({ id: 'b', status: 'ok', display_name: 'Zzz', hostname: 'aaa' }),
      row({ id: 'a', status: 'ok', display_name: 'Aaa', hostname: 'zzz' }),
    ]
    expect(sortAgents(rows).map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('counts', () => {
  it('tallies per-status and muted', () => {
    const rows = [
      row({ status: 'offline' }),
      row({ status: 'offline', connectivity_alerts_muted: true }),
      row({ status: 'ok' }),
      row({ status: 'never_connected' }),
    ]
    const c = countStatuses(rows)
    expect(c.total).toBe(4)
    expect(c.byStatus.offline).toBe(2)
    expect(c.byStatus.ok).toBe(1)
    expect(c.byStatus.never_connected).toBe(1)
    expect(c.muted).toBe(1)
  })
})

describe('filters', () => {
  it('validates filter values', () => {
    expect(isAgentFilter('all')).toBe(true)
    expect(isAgentFilter('muted')).toBe(true)
    expect(isAgentFilter('offline')).toBe(true)
    expect(isAgentFilter('bogus')).toBe(false)
  })

  it('matches status and the muted facet', () => {
    expect(matchesAgentFilter(row({ status: 'offline' }), 'offline')).toBe(true)
    expect(matchesAgentFilter(row({ status: 'ok' }), 'offline')).toBe(false)
    expect(matchesAgentFilter(row({ connectivity_alerts_muted: true }), 'muted')).toBe(true)
    expect(matchesAgentFilter(row({ connectivity_alerts_muted: false }), 'muted')).toBe(false)
    expect(matchesAgentFilter(row({}), 'all')).toBe(true)
  })

  it('matches groups including ungrouped', () => {
    const grouped = row({ groups: [{ id: 'g1', name: 'G1' }] })
    const ungrouped = row({ groups: [] })
    expect(matchesGroup(grouped, 'g1')).toBe(true)
    expect(matchesGroup(grouped, 'g2')).toBe(false)
    expect(matchesGroup(grouped, 'ungrouped')).toBe(false)
    expect(matchesGroup(ungrouped, 'ungrouped')).toBe(true)
    expect(matchesGroup(ungrouped, 'all')).toBe(true)
    expect(matchesGroup(grouped, '')).toBe(true)
  })

  it('searches name, hostname, id, version case-insensitively', () => {
    const r = row({ display_name: 'Living Room', hostname: 'lr-01', id: 'agent_abc', agent_version: 'v2.1' })
    expect(matchesAgentSearch(r, 'living')).toBe(true)
    expect(matchesAgentSearch(r, 'LR-01')).toBe(true)
    expect(matchesAgentSearch(r, 'abc')).toBe(true)
    expect(matchesAgentSearch(r, 'v2.1')).toBe(true)
    expect(matchesAgentSearch(r, 'nope')).toBe(false)
    expect(matchesAgentSearch(r, '  ')).toBe(true)
  })

  it('combines status × group × search in filterAndSortAgents', () => {
    const rows = [
      row({ id: 'a', status: 'offline', groups: [{ id: 'g1', name: 'G1' }], hostname: 'alpha' }),
      row({ id: 'b', status: 'ok', groups: [{ id: 'g1', name: 'G1' }], hostname: 'beta' }),
      row({ id: 'c', status: 'offline', groups: [], hostname: 'gamma' }),
    ]
    const out = filterAndSortAgents(rows, { search: '', groupId: 'g1', status: 'offline' })
    expect(out.map((r) => r.id)).toEqual(['a'])
  })
})

describe('sampleAge', () => {
  it('returns whole seconds, clamped at 0, null on missing/invalid', () => {
    const now = Date.parse('2026-07-24T12:00:00Z')
    expect(sampleAge('2026-07-24T11:59:30Z', now)).toBe(30)
    expect(sampleAge('2026-07-24T12:00:05Z', now)).toBe(0) // future clamps to 0
    expect(sampleAge(null, now)).toBeNull()
    expect(sampleAge('not-a-date', now)).toBeNull()
  })
})
