import { describe, expect, it } from 'vitest'

import type { ProbeState, TargetStatusRow } from '../api'
import { buildDashboardPath } from './dashboardPath'

function target(
  kind: string,
  probeState: ProbeState,
  identity: Partial<Pick<TargetStatusRow, 'target_id' | 'name' | 'target'>> = {},
): TargetStatusRow {
  return {
    target_id: identity.target_id ?? `target-${kind}`,
    group_id: 'group',
    name: identity.name ?? kind,
    kind,
    target: identity.target ?? kind,
    enabled: true,
    display_state: probeState === 'healthy' ? 'healthy' : 'probe_failed',
    applicable_agents: 1,
    affected_agents: probeState === 'healthy' ? 0 : 1,
    availability_rounds: 0,
    availability_ok_rounds: 0,
    signal_ids: [],
    incident_ids: [],
    agents: [{
      agent_id: 'agent',
      agent_name: 'Agent',
      agent_online: true,
      execution_state: 'collecting',
      probe_state: probeState,
      fault_state: probeState === 'healthy' ? 'normal' : 'confirming',
      reason_code: probeState === 'healthy' ? 'ok' : 'probe_failed',
      missing_permissions: [],
      matched_selector: '',
      block_reason: '',
      availability_rounds: 0,
      availability_ok_rounds: 0,
    }],
  }
}

const base = {
  agentId: 'agent',
  agentOnline: true,
  freshnessTone: 'good' as const,
  networkInterface: { tone: 'good' as const, state: 'healthy' as const },
}

describe('dashboard end-to-end path', () => {
  it('locates an internet failure after a healthy gateway and marks failed downstream stages affected', () => {
    const result = buildDashboardPath({
      ...base,
      targets: [target('gateway', 'healthy'), target('nat', 'healthy'), target('icmp', 'failed'), target('dns', 'failed'), target('http', 'failed')],
    })

    expect(result.root?.id).toBe('internet')
    expect(result.stages.find((stage) => stage.id === 'gateway')?.tone).toBe('good')
    expect(result.stages.find((stage) => stage.id === 'dns')?.affected).toBe(true)
    expect(result.stages.find((stage) => stage.id === 'http')?.affected).toBe(true)
  })

  it('keeps a healthy HTTP stage independent when DNS is the first failure', () => {
    const result = buildDashboardPath({
      ...base,
      targets: [target('gateway', 'healthy'), target('nat', 'healthy'), target('icmp', 'healthy'), target('dns', 'failed'), target('http', 'healthy')],
    })

    expect(result.root?.id).toBe('dns')
    expect(result.stages.find((stage) => stage.id === 'http')?.affected).toBe(false)
  })

  it('makes an offline Agent the root before every network stage', () => {
    const result = buildDashboardPath({ ...base, agentOnline: false, targets: [] })
    expect(result.root?.id).toBe('host')
    expect(result.stages[0]).toMatchObject({ tone: 'bad', state: 'offline' })
  })

  it('leaves unmonitored downstream stages out of the blast radius', () => {
    // "Not configured" tells us nothing about the hop, so an upstream failure
    // must not relabel it as affected — the node would read "affected" over a
    // "no target" detail line.
    const result = buildDashboardPath({ ...base, agentOnline: false, targets: [target('gateway', 'healthy')] })

    expect(result.root?.id).toBe('host')
    for (const id of ['gateway', 'nat', 'internet', 'dns', 'http']) {
      expect(result.stages.find((stage) => stage.id === id)?.affected).toBe(false)
    }
  })

  it('marks a degraded default interface as affected once the host fails', () => {
    const result = buildDashboardPath({
      ...base,
      agentOnline: false,
      networkInterface: { tone: 'warn', state: 'degraded' },
      targets: [],
    })

    expect(result.root?.id).toBe('host')
    expect(result.stages[1]).toMatchObject({ id: 'interface', affected: true })
  })

  it('places NAT between the gateway and internet stages', () => {
    const result = buildDashboardPath({ ...base, targets: [target('nat', 'healthy')] })

    expect(result.stages.map((stage) => stage.id)).toEqual([
      'host',
      'interface',
      'gateway',
      'nat',
      'internet',
      'dns',
      'http',
    ])
  })

  it('exposes one actually failing monitor target for the faulted stage', () => {
    const result = buildDashboardPath({
      ...base,
      targets: [
        target('dns', 'healthy', { target_id: 'dns-healthy', name: 'Backup DNS', target: '8.8.8.8' }),
        target('dns', 'failed', { target_id: 'dns-failed', name: 'Primary DNS', target: '1.1.1.1' }),
      ],
      latencyMsByTarget: {
        'dns-healthy': 180,
        'dns-failed': 12,
      },
    })

    expect(result.root).toMatchObject({
      id: 'dns',
      faultTarget: {
        id: 'dns-failed',
        name: 'Primary DNS',
        target: '1.1.1.1',
      },
      featuredTarget: {
        id: 'dns-failed',
        latencyMs: 12,
      },
    })
  })

  it('features the highest-latency target while a stage is healthy', () => {
    const result = buildDashboardPath({
      ...base,
      targets: [
        target('icmp', 'healthy', { target_id: 'icmp-fast', name: 'Nearby', target: '1.1.1.1' }),
        target('icmp', 'healthy', { target_id: 'icmp-slow', name: 'Remote', target: '8.8.8.8' }),
      ],
      latencyMsByTarget: {
        'icmp-fast': 8.4,
        'icmp-slow': 46.2,
      },
    })

    expect(result.stages.find((stage) => stage.id === 'internet')?.featuredTarget).toEqual({
      id: 'icmp-slow',
      name: 'Remote',
      target: '8.8.8.8',
      latencyMs: 46.2,
    })
  })
})
