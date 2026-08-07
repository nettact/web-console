import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import { api, type Channel } from '../api'
import en from '../locales/en'
import ChannelEditor from './ChannelEditor.vue'

vi.mock('../api', () => ({
  api: {
    createChannel: vi.fn().mockResolvedValue({ id: 'channel-1' }),
    updateChannel: vi.fn().mockResolvedValue({}),
    testChannel: vi.fn().mockResolvedValue({ ok: true, status_code: 200, body: '' }),
  },
}))

const createChannel = vi.mocked(api.createChannel)
const updateChannel = vi.mocked(api.updateChannel)
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function render(props: Record<string, unknown> = {}) {
  return mount(ChannelEditor, {
    props,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
}

beforeEach(() => {
  createChannel.mockClear()
  updateChannel.mockClear()
})

describe('ChannelEditor', () => {
  it('starts with a grouped type catalog and only offers system notifications when supported', () => {
    const page = render()
    expect(page.text()).toContain('Team collaboration')
    expect(page.text()).toContain('General integrations')
    expect(page.text()).not.toContain('This computer')

    const nativePage = render({ nativeNotify: true })
    expect(nativePage.text()).toContain('This computer')
    expect(nativePage.text()).toContain('System notification')
  })

  it('opens the selected provider form and can return to the catalog', async () => {
    const page = render()
    const webhook = page.findAll('.catalog-option').find((item) => item.text().includes('Webhook'))!
    await webhook.trigger('click')
    expect(page.find('.wh-form').exists()).toBe(true)
    await page.get('.back-button').trigger('click')
    expect(page.find('.channel-catalog').exists()).toBe(true)
  })

  it('creates an email channel with the selected storm behavior', async () => {
    const page = render({ initialType: 'email' })
    const deliveryToggles = page.findAll('.delivery-option input')
    expect(deliveryToggles).toHaveLength(1)
    await deliveryToggles[0].setValue(false)
    const inputs = page.findAll('.simple-grid input')
    await inputs[0].setValue('Operations email')
    await inputs[1].setValue('smtp.example.com')
    await inputs[3].setValue('nettact@example.com')
    await inputs[4].setValue('oncall@example.com')
    await page.get('.simple-actions .btn-primary').trigger('click')
    await flush()

    expect(createChannel).toHaveBeenCalledWith('Operations email', 'email', expect.objectContaining({
      host: 'smtp.example.com',
      from: 'nettact@example.com',
      to: 'oncall@example.com',
      lang: 'zh',
    }), false)
    expect(page.emitted('added')).toHaveLength(1)
  })

  it('edits system channels and carries delivery flags in the full update', async () => {
    const channel: Channel = {
      id: 'system-1',
      name: 'Desktop alerts',
      type: 'system',
      enabled: false,
      storm_merge: false,
      config: { lang: 'en' },
    }
    const page = render({ mode: 'edit', channel, nativeNotify: true })
    const toggles = page.findAll('.delivery-option input')
    await toggles[0].setValue(true)
    await toggles[1].setValue(true)
    await page.get('.simple-actions .btn-primary').trigger('click')
    await flush()

    expect(updateChannel).toHaveBeenCalledWith('system-1', {
      name: 'Desktop alerts',
      enabled: true,
      storm_merge: true,
      config: { lang: 'en' },
    })
    expect(page.emitted('saved')).toHaveLength(1)
  })
})
