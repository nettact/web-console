import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StatusBand from './StatusBand.vue'

const statusSample = (ms: number, value = 1) => ({
  ts: new Date(ms).toISOString(),
  kind: 'probe.round.ok',
  target: 'https://example.com',
  layer: 'service',
  value,
  unit: 'bool',
})

describe('StatusBand selected window', () => {
  it('positions a lone observation without extending it through the unknown tail', () => {
    const wrapper = mount(StatusBand, {
      props: {
        samples: [statusSample(800)],
        timeWindow: { startMs: 0, endMs: 1_000 },
        label: 'Availability evidence',
      },
    })

    const observed = wrapper.findAll('rect')[1]
    expect(observed.attributes('x')).toBe('80')
    expect(observed.attributes('width')).toBe('0.5')
    expect(wrapper.get('svg').attributes('aria-label')).toBe('Availability evidence')
  })

  it('stops status coloring at the newest observation', () => {
    const wrapper = mount(StatusBand, {
      props: {
        samples: [statusSample(200), statusSample(700, 0)],
        timeWindow: { startMs: 0, endMs: 1_000 },
      },
    })

    const observed = wrapper.findAll('rect').slice(1)
    expect(observed).toHaveLength(2)
    expect(observed[0].attributes()).toMatchObject({ x: '20', width: '50', fill: 'var(--color-success)' })
    expect(observed[1].attributes()).toMatchObject({ x: '70', width: '0.5', fill: 'var(--color-danger)' })
    expect(Math.max(...observed.map((rect) => Number(rect.attributes('x')) + Number(rect.attributes('width'))))).toBe(70.5)
  })

  it('keeps an unknown background behind observed segments', () => {
    const wrapper = mount(StatusBand, {
      props: { samples: [], timeWindow: { startMs: 0, endMs: 1_000 } },
    })
    expect(wrapper.findAll('rect')).toHaveLength(1)
    expect(wrapper.get('rect').classes()).toContain('empty-rect')
  })
})
