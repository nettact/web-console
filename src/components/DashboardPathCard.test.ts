import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'

import en from '../locales/en'
import type { DashboardPathStage } from '../lib/dashboardPath'
import DashboardPathCard from './DashboardPathCard.vue'

function mountCard(stages: DashboardPathStage[], root: DashboardPathStage | null) {
  return mount(DashboardPathCard, {
    props: {
      stages,
      root,
      agentName: 'Agent',
      interfaceKind: 'wired',
      interfaceDetail: 'Ethernet',
      natDetail: {
        type: 'Full Cone',
        mapping: 'Endpoint-Independent',
        filtering: 'Endpoint-Independent',
      },
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

describe('DashboardPathCard', () => {
  it('shows one faulting monitor target in the node and diagnosis', () => {
    const dns: DashboardPathStage = {
      id: 'dns',
      tone: 'bad',
      state: 'failed',
      healthy: 1,
      total: 2,
      affected: false,
      faultTarget: {
        id: 'dns-primary',
        name: 'Primary DNS',
        target: '1.1.1.1',
      },
    }
    const wrapper = mountCard([dns], dns)

    expect(wrapper.get('.path-node-copy small').text()).toBe('Primary DNS')
    expect(wrapper.get('.path-node-fact small').text()).toBe('Fault target · 1.1.1.1')
    expect(wrapper.get('.path-diagnosis-target').text()).toContain('Primary DNS')
    expect(wrapper.get('.path-diagnosis-target').text()).toContain('1.1.1.1')
  })

  it('uses compact NAT behavior codes while preserving the full values in the title', () => {
    const nat: DashboardPathStage = {
      id: 'nat',
      tone: 'good',
      state: 'healthy',
      healthy: 1,
      total: 1,
      affected: false,
    }
    const wrapper = mountCard([nat], null)
    const fact = wrapper.get('.path-node-fact')

    expect(fact.text()).toContain('Mapping EIM · Filtering EIF')
    expect(fact.attributes('title')).toBe('Mapping Endpoint-Independent · Filtering Endpoint-Independent')
    expect(fact.find('span').exists()).toBe(false)
  })

  it('shows the highest-latency monitor target for a healthy stage', () => {
    const internet: DashboardPathStage = {
      id: 'internet',
      tone: 'good',
      state: 'healthy',
      healthy: 2,
      total: 2,
      affected: false,
      featuredTarget: {
        id: 'icmp-remote',
        name: 'Remote anchor',
        target: '8.8.8.8',
        latencyMs: 46.2,
      },
    }
    const wrapper = mountCard([internet], null)
    const fact = wrapper.get('.path-node-fact')

    expect(fact.text()).toContain('46.2 ms · 8.8.8.8')
    expect(fact.attributes('title')).toBe('Highest latency · Remote anchor · 8.8.8.8 · 46.2 ms')
    expect(fact.find('span, b, strong').exists()).toBe(false)
  })
})
