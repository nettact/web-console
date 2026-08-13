import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { Sample, TargetStatusRow } from '../api'
import en from '../locales/en'
import zh from '../locales/zh'
import DashboardTargetCard from './DashboardTargetCard.vue'

const target: TargetStatusRow = {
  target_id: 'target-1',
  group_id: 'group-1',
  name: 'Example',
  kind: 'http',
  target: 'https://example.com',
  enabled: true,
  display_state: 'healthy',
  applicable_agents: 1,
  affected_agents: 0,
  availability_rounds: 0,
  availability_ok_rounds: 0,
  signal_ids: [],
  incident_ids: [],
  agents: [{
    agent_id: 'agent-1',
    agent_name: 'Agent 1',
    agent_online: true,
    execution_state: 'collecting',
    probe_state: 'healthy',
    fault_state: 'normal',
    reason_code: 'ok',
    missing_permissions: [],
    matched_selector: '',
    block_reason: '',
    availability_rounds: 0,
    availability_ok_rounds: 0,
  }],
}

function sample(kind: string, value: number): Sample {
  return {
    ts: '2026-08-13T18:00:00Z',
    kind,
    target: target.target,
    layer: 'service',
    value,
    unit: 'ms',
    monitor_id: target.target_id,
  }
}

function mountCard(samples: Sample[]) {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'zh', messages: { zh, en } })
  return mount(DashboardTargetCard, {
    props: { target, agentId: 'agent-1', samples },
    global: { plugins: [i18n], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

describe('DashboardTargetCard HTTP timings', () => {
  it('shows the three highest-priority new timings in the compact detail row', () => {
    const wrapper = mountCard([
      sample('probe.http.latency_ms', 95),
      sample('probe.http.total_ms', 130),
      sample('probe.http.ttfb_ms', 80),
      sample('probe.http.connect_ms', 24),
      sample('probe.http.dns_ms', 9),
      sample('probe.http.tls_ms', 31),
    ])

    const details = wrapper.findAll('.target-details > span')
    expect(details).toHaveLength(3)
    expect(details.map((item) => item.text())).toEqual([
      'Total time130 ms',
      'Time to first byte80 ms',
      'Connect time24 ms',
    ])
    expect(wrapper.text()).not.toContain('DNS resolve')
    expect(wrapper.text()).not.toContain('TLS handshake')
  })

  it('fills missing primary phases with DNS and TLS timings', () => {
    const wrapper = mountCard([
      sample('probe.http.ttfb_ms', 80),
      sample('probe.http.dns_ms', 9),
      sample('probe.http.tls_ms', 31),
    ])

    expect(wrapper.findAll('.target-details > span').map((item) => item.text())).toEqual([
      'Time to first byte80 ms',
      'DNS resolve9 ms',
      'TLS handshake31 ms',
    ])
  })

  it('keeps the legacy latency detail when no new timing series exists', () => {
    const wrapper = mountCard([sample('probe.http.latency_ms', 95)])

    expect(wrapper.findAll('.target-details > span').map((item) => item.text())).toEqual(['Latency95 ms'])
  })
})
