import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BrandMark from './BrandMark.vue'
import { setTheme } from '../theme'

afterEach(() => setTheme('dark'))

describe('BrandMark', () => {
  it('selects the approved light and reverse full marks from the app theme', async () => {
    setTheme('dark')
    const wrapper = mount(BrandMark)
    expect(wrapper.get('img').attributes('src')).toBe('/nettact-mark-reverse.svg')

    setTheme('light')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('img').attributes('src')).toBe('/nettact-mark.svg')
  })

  it('uses compact geometry at 40px and for the responsive small-size source', () => {
    setTheme('dark')
    const compact = mount(BrandMark, { props: { variant: 'compact' } })
    expect(compact.get('img').attributes()).toMatchObject({
      src: '/nettact-mark-compact-reverse.svg',
      width: '40',
      height: '40',
    })

    const responsive = mount(BrandMark, { props: { responsive: true } })
    expect(responsive.get('source').attributes()).toMatchObject({
      media: '(max-width: 60rem)',
      srcset: '/nettact-mark-compact-reverse.svg',
    })
    expect(responsive.get('img').attributes()).toMatchObject({
      src: '/nettact-mark-reverse.svg',
      width: '48',
      height: '48',
    })
  })
})
