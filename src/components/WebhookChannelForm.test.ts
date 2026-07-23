import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import WebhookChannelForm from './WebhookChannelForm.vue'
import { api } from '../api'

vi.mock('../api', () => ({
  api: {
    createChannel: vi.fn().mockResolvedValue({ id: 'chan_1' }),
    updateChannel: vi.fn().mockResolvedValue({}),
    testChannel: vi.fn(),
  },
}))

const createChannel = vi.mocked(api.createChannel)
const updateChannel = vi.mocked(api.updateChannel)

type Props = {
  mode: 'add' | 'edit'
  channelId?: string
  enabled?: boolean
  initialName?: string
  initialConfig?: Record<string, string>
}

function render(props: Props) {
  return mount(WebhookChannelForm, {
    props,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  createChannel.mockClear()
  updateChannel.mockClear()
})

describe('WebhookChannelForm', () => {
  it('creates a channel with default values omitted, then resets the form', async () => {
    const page = render({ mode: 'add' })
    await page.get('.wh-url input').setValue('https://hooks.example.com/x')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()

    expect(createChannel).toHaveBeenCalledTimes(1)
    const [name, type, config] = createChannel.mock.calls[0]
    expect(name).toBe('Webhook') // empty name falls back
    expect(type).toBe('webhook')
    expect(config).toEqual({ url: 'https://hooks.example.com/x', lang: 'zh' })
    expect(page.emitted('saved')).toHaveLength(1)
    // Add form is cleared so the next click can't create a duplicate.
    expect((page.get('.wh-url input').element as HTMLInputElement).value).toBe('')
  })

  it('normalizes an uppercase scheme so it matches server validation', async () => {
    const page = render({ mode: 'add' })
    await page.get('.wh-url input').setValue('HTTPS://hooks.example.com/x')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()
    expect(createChannel.mock.calls[0][2]).toMatchObject({ url: 'https://hooks.example.com/x' })
  })

  it('rejects a missing or non-http url without calling the API', async () => {
    const page = render({ mode: 'add' })
    await page.get('.wh-actions .btn-primary').trigger('click')
    expect(createChannel).not.toHaveBeenCalled()
    expect(page.get('.err.inline').text()).toContain('required')

    await page.get('.wh-url input').setValue('ftp://nope')
    await page.get('.wh-actions .btn-primary').trigger('click')
    expect(createChannel).not.toHaveBeenCalled()
  })

  it('surfaces a rejected save in the form', async () => {
    createChannel.mockRejectedValueOnce(new Error('server unreachable'))
    const page = render({ mode: 'add' })
    await page.get('.wh-url input').setValue('https://x')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()
    expect(page.get('.err.inline').text()).toContain('server unreachable')
    expect(page.emitted('saved')).toBeUndefined()
  })

  it('populates header rows from config and updates with a JSON headers string', async () => {
    const page = render({
      mode: 'edit',
      channelId: 'chan_9',
      enabled: true,
      initialName: 'WH',
      initialConfig: { url: 'https://x/y', method: 'PUT', headers: '{"Authorization":"Bearer z"}', lang: 'en' },
    })
    const keys = page.findAll('.wh-hkey')
    expect(keys).toHaveLength(1)
    expect((keys[0].element as HTMLInputElement).value).toBe('Authorization')

    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()
    expect(updateChannel).toHaveBeenCalledTimes(1)
    const [id, body] = updateChannel.mock.calls[0]
    expect(id).toBe('chan_9')
    expect(body.config).toMatchObject({ url: 'https://x/y', method: 'PUT', lang: 'en' })
    expect(JSON.parse(body.config!.headers)).toEqual({ Authorization: 'Bearer z' })
  })

  it('rejects duplicate header names case-insensitively', async () => {
    const page = render({ mode: 'edit', channelId: 'c', initialConfig: { url: 'https://x', headers: '{"X-A":"1"}' } })
    await page.get('.wh-headers .link-btn:not(.danger)').trigger('click') // "Add header"
    const keys = page.findAll('.wh-hkey')
    expect(keys).toHaveLength(2)
    await keys[1].setValue('x-a')

    await page.get('.wh-actions .btn-primary').trigger('click')
    expect(updateChannel).not.toHaveBeenCalled()
    expect(page.get('.err.inline').text().toLowerCase()).toContain('duplicate')
  })

  it('keeps a non-empty body template', async () => {
    const page = render({ mode: 'add' })
    await page.get('.wh-url input').setValue('https://x')
    await page.get('.wh-body textarea').setValue('{"content":"{{title}}"}')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()
    expect(createChannel.mock.calls[0][2]).toMatchObject({ body: '{"content":"{{title}}"}' })
  })
})
