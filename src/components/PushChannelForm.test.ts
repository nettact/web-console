import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import PushChannelForm from './PushChannelForm.vue'
import { pushProvider, type PushProviderDescriptor } from '../lib/pushProviders'
import { api } from '../api'

vi.mock('../api', () => ({
  api: {
    createChannel: vi.fn().mockResolvedValue({ id: 'chan_1' }),
    updateChannel: vi.fn().mockResolvedValue({}),
    testChannel: vi.fn().mockResolvedValue({ ok: true, status_code: 200, body: '{"errcode":0}' }),
  },
}))

const createChannel = vi.mocked(api.createChannel)
const updateChannel = vi.mocked(api.updateChannel)
const testChannel = vi.mocked(api.testChannel)

const MASK = '••••••'

type Props = {
  provider: PushProviderDescriptor
  mode: 'add' | 'edit'
  channelId?: string
  enabled?: boolean
  stormMerge?: boolean
  initialName?: string
  initialConfig?: Record<string, string>
}

function render(props: Props) {
  return mount(PushChannelForm, {
    props,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
}

const telegram = pushProvider('telegram')!
const wxpusher = pushProvider('wxpusher')!
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  createChannel.mockClear()
  updateChannel.mockClear()
  testChannel.mockClear()
})

describe('PushChannelForm', () => {
  it('creates a telegram channel with empty optional keys omitted, then resets', async () => {
    const page = render({ provider: telegram, mode: 'add' })
    await page.get('.wh-f-bot_token input').setValue('123456:ABC')
    await page.get('.wh-f-chat_id input').setValue('-1001234')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()

    expect(createChannel).toHaveBeenCalledTimes(1)
    const [name, type, config] = createChannel.mock.calls[0]
    expect(name).toBe('Telegram') // empty name falls back to the provider label
    expect(type).toBe('telegram')
    // api_base was left empty, so it is not in the config at all.
    expect(config).toEqual({ bot_token: '123456:ABC', chat_id: '-1001234', lang: 'zh' })
    expect(page.emitted('saved')).toHaveLength(1)
    // Add form is cleared so the next click can't create a duplicate.
    expect((page.get('.wh-f-chat_id input').element as HTMLInputElement).value).toBe('')
  })

  it('renders secrets as password inputs and keeps plain fields as text', () => {
    const page = render({ provider: telegram, mode: 'add' })
    expect(page.get('.wh-f-bot_token input').attributes('type')).toBe('password')
    expect(page.get('.wh-f-chat_id input').attributes('type')).toBe('text')
  })

  it('blocks the create call on a missing required field', async () => {
    const page = render({ provider: telegram, mode: 'add' })
    await page.get('.wh-f-bot_token input').setValue('123456:ABC')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()

    expect(createChannel).not.toHaveBeenCalled()
    expect(page.get('.err.inline').text()).toContain('Chat ID')
    expect(page.emitted('saved')).toBeUndefined()
  })

  it('passes a masked secret through untouched on update', async () => {
    const page = render({
      provider: telegram,
      mode: 'edit',
      channelId: 'chan_9',
      enabled: true,
      stormMerge: false,
      initialName: 'TG',
      initialConfig: { bot_token: MASK, chat_id: '-1001234', lang: 'en' },
    })
    await page.get('.wh-f-chat_id input').setValue('@nettact')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()

    expect(updateChannel).toHaveBeenCalledTimes(1)
    const [id, body] = updateChannel.mock.calls[0]
    expect(id).toBe('chan_9')
    // A full PUT carries the channel's flags through untouched.
    expect(body.enabled).toBe(true)
    expect(body.storm_merge).toBe(false)
    expect(body.config).toEqual({ bot_token: MASK, chat_id: '@nettact', lang: 'en' })
  })

  it('tests an existing channel with its id so the server can merge stored secrets', async () => {
    const page = render({
      provider: telegram,
      mode: 'edit',
      channelId: 'chan_9',
      initialConfig: { bot_token: MASK, chat_id: '-1001234', lang: 'zh' },
    })
    await page.get('.wh-actions .wh-test').trigger('click')
    await flush()

    expect(testChannel).toHaveBeenCalledTimes(1)
    const [type, config, channelId] = testChannel.mock.calls[0]
    expect(type).toBe('telegram')
    expect(config).toEqual({ bot_token: MASK, chat_id: '-1001234', lang: 'zh' })
    expect(channelId).toBe('chan_9')
    expect(page.get('.wh-result').text()).toContain('HTTP 200')
  })

  it('omits the channel id when testing an unsaved config', async () => {
    const page = render({ provider: telegram, mode: 'add' })
    await page.get('.wh-f-bot_token input').setValue('123456:ABC')
    await page.get('.wh-f-chat_id input').setValue('-1001234')
    await page.get('.wh-actions .wh-test').trigger('click')
    await flush()
    expect(testChannel.mock.calls[0][2]).toBeUndefined()
  })

  it('blocks a wxpusher save when neither uids nor topic_ids is filled in', async () => {
    const page = render({ provider: wxpusher, mode: 'add' })
    await page.get('.wh-f-app_token input').setValue('AT_x')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()

    expect(createChannel).not.toHaveBeenCalled()
    expect(page.get('.err.inline').text()).toBe(en.settings.push.atLeastOneTarget)

    await page.get('.wh-f-uids textarea').setValue('UID_a, UID_b')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()
    expect(createChannel.mock.calls[0][2]).toEqual({ app_token: 'AT_x', uids: 'UID_a, UID_b', lang: 'zh' })
  })

  it('surfaces a rejected save in the form', async () => {
    createChannel.mockRejectedValueOnce(new Error('server unreachable'))
    const page = render({ provider: telegram, mode: 'add' })
    await page.get('.wh-f-bot_token input').setValue('123456:ABC')
    await page.get('.wh-f-chat_id input').setValue('-1')
    await page.get('.wh-actions .btn-primary').trigger('click')
    await flush()
    expect(page.get('.err.inline').text()).toContain('server unreachable')
    expect(page.emitted('saved')).toBeUndefined()
  })
})
