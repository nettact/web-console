import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import type { TargetStatusRow } from '../api'
import { targetStatus } from '../targetStatus'
import Monitoring from './Monitoring.vue'

const apiMock = vi.hoisted(() => ({
  listTargets: vi.fn(), monitorGroups: vi.fn(), agentGroups: vi.fn(), setTargets: vi.fn(),
  purgeMonitor: vi.fn(), purgeTarget: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.agentGroups.mockResolvedValue([])
  apiMock.monitorGroups.mockResolvedValue([{
    id: 'group-default', site_id: 'site_default', name: 'Default', is_default: true,
    merge_enabled: true, all_agents: true, agent_group_ids: [],
  }])
  targetStatus.targets = []
  targetStatus.generatedAt = ''
  targetStatus.loaded = false
  targetStatus.stale = false
  targetStatus.error = ''
})

it('renders host/* as Wi-Fi inside the existing host monitoring type', async () => {
  apiMock.listTargets.mockResolvedValue([{
    id: 'wifi-anchor', group_id: 'group-default', kind: 'host', name: 'Office Wi-Fi', target: '*', params: {},
    enabled: true,
  }])
  apiMock.agentGroups.mockResolvedValue([])
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const page = mount(Monitoring, {
    global: { plugins: [i18n], stubs: { RouterLink: true } },
  })
  await flushPromises()

  expect(page.text()).toContain('Office Wi-Fi')
  expect(page.text()).toContain('Host metrics')
  expect(page.text()).toContain('Wi-Fi (all wireless adapters)')
})

describe('authoritative monitor status composition', () => {
  it('shows policy, probe failure, healthy collection, and offline states from the batch', async () => {
    apiMock.listTargets.mockResolvedValue([{
      id: 'mon-http', group_id: 'group-default', kind: 'http', name: 'Public site', target: 'https://example.com', params: {},
      enabled: true,
    }])
    targetStatus.loaded = true
    targetStatus.generatedAt = '2026-07-17T12:00:00Z'
    targetStatus.targets = [{
      target_id: 'mon-http', group_id: 'group-default', name: 'Public site', kind: 'http',
      target: 'https://example.com', enabled: true, display_state: 'partial_failure',
      applicable_agents: 4, affected_agents: 3, active_condition_count: 0,
      rule_ids: [], alert_ids: [], incident_ids: [],
      agents: [
        { agent_id: 'blocked', agent_name: 'Blocked Agent', agent_online: true, execution_state: 'permission_blocked', probe_state: 'no_data', rule_state: 'normal', reason_code: 'permission_blocked', missing_permissions: ['probe.http'], matched_selector: '', block_reason: '', active_conditions: [] },
        { agent_id: 'failed', agent_name: 'Failed Agent', agent_online: true, execution_state: 'collecting', probe_state: 'failed', rule_state: 'normal', reason_code: 'probe_failed', missing_permissions: [], matched_selector: '', block_reason: '', active_conditions: [] },
        { agent_id: 'healthy', agent_name: 'Healthy Agent', agent_online: true, execution_state: 'collecting', probe_state: 'healthy', rule_state: 'normal', reason_code: 'ok', missing_permissions: [], matched_selector: '', block_reason: '', active_conditions: [] },
        { agent_id: 'offline', agent_name: 'Offline Agent', agent_online: false, execution_state: 'agent_offline', probe_state: 'stale', rule_state: 'normal', reason_code: 'agent_offline', missing_permissions: [], matched_selector: '', block_reason: '', active_conditions: [] },
      ],
    } satisfies TargetStatusRow]

    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    const page = mount(Monitoring, {
      global: { plugins: [i18n], stubs: { RouterLink: true } },
    })
    await flushPromises()

    expect(page.get('td.status').text()).toContain('Partial failure')
    await page.get('button.status-toggle').trigger('click')
    const detail = page.get('.detail-row')
    expect(detail.text()).toContain('Permission blocked')
    expect(detail.text()).toContain('Probe failed')
    expect(detail.text()).toContain('Collecting')
    expect(detail.text()).toContain('Agent offline')
    expect(detail.text()).toContain('Blocked Agent')
    expect(detail.text()).toContain('Failed Agent')
    expect(detail.text()).toContain('Healthy Agent')
    expect(detail.text()).toContain('Offline Agent')
  })
})
