import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '../../i18n'
import MonitorStateBadge from './MonitorStateBadge.vue'

describe('MonitorStateBadge', () => {
  it('keeps an unknown machine value visible with the unknown tone', () => {
    const wrapper = mount(MonitorStateBadge, {
      props: { dim: 'display', state: 'future_server_state' },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toBe('future_server_state')
    expect(wrapper.classes()).toContain('is-unknown')
    expect(wrapper.attributes('aria-label')).toBe('future_server_state')
  })
})

