import { computed, defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import en from '../locales/en'
import zh from '../locales/zh'
import { useMetricCards } from './useMetricCards'

const Harness = defineComponent({
  props: {
    kind: { type: String, default: 'probe.http.connection_reused' },
    value: { type: Number, required: true },
  },
  setup(props) {
    const { buildSummaryCard } = useMetricCards()
    const card = computed(() => buildSummaryCard({
      label: props.kind === 'probe.http.status' ? 'Status' : 'Connection reused',
      color: '#94a3b8',
      kind: props.kind,
    }, {
      latest: { ts: '2026-08-13T18:00:00Z', value: props.value },
      latest_nonzero: null,
      p95: props.value,
      avg: props.value,
      count: 1,
    }))
    return { card }
  },
  template: '<div><strong>{{ card.value }}</strong><small>{{ card.foot }}</small></div>',
})

describe('HTTP connection reuse card', () => {
  it('labels reused and newly-created connections without availability wording', async () => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'zh', messages: { zh, en } })
    const wrapper = mount(Harness, { props: { value: 1 }, global: { plugins: [i18n] } })

    expect(wrapper.get('strong').text()).toBe('Reused')
    expect(wrapper.get('small').text()).toContain('Last observed')
    expect(wrapper.get('small').text()).not.toContain('uptime')

    await wrapper.setProps({ value: 0 })
    expect(wrapper.get('strong').text()).toBe('New connection')
  })

  it('renders the latest HTTP status as a discrete code', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'zh', messages: { zh, en } })
    const wrapper = mount(Harness, {
      props: { kind: 'probe.http.status', value: 503 },
      global: { plugins: [i18n] },
    })

    expect(wrapper.get('strong').text()).toBe('HTTP 503')
    expect(wrapper.get('small').text()).toContain('Last observed')
  })
})
