import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import App from './App.vue'
import { api } from './api'
import zh from './locales/zh'
import en from './locales/en'

// A board published on its own domain has the console, the admin API and /login
// blocked at the reverse proxy on purpose, so it must not offer a sign-in link
// even when the page it renders IS the server's home page. That deployment says
// so through `console: false` in config.js.
//
// Its own file for the same reason defaultPage.test.ts has one: config.ts reads
// window at import time, so the value cannot be set from inside a test that has
// already imported App — and mocking the module inside App.test.ts would quietly
// retune every case there, including the one asserting the link IS offered.
vi.mock('./config', () => ({ apiBase: '', defaultSlug: '', consoleReachable: false }))

const page = {
  slug: 'home-lab',
  title: 'Home lab status',
  description: '',
  show_agent_view: false,
  show_target_view: true,
  show_incidents: false,
  show_target_address: false,
  is_home: true,
  generated_at: new Date().toISOString(),
}

const mounted: Array<{ unmount: () => void }> = []

beforeEach(() => {
  vi.useFakeTimers()
  location.hash = '#/home-lab'
})

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  vi.useRealTimers()
  location.hash = ''
})

describe('sign-in link where the console is unreachable', () => {
  it('is withheld even on the home page', async () => {
    vi.spyOn(api, 'page').mockResolvedValue(page)
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [],
    })

    const w = mount(App, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'zh', messages: { zh, en } })],
      },
    })
    mounted.push(w)
    await flushPromises()

    // The board itself must still render — this is a supported topology, not a
    // degraded one.
    expect(w.text()).toContain('Home lab status')
    expect(w.find('a.control-login').exists()).toBe(false)
  })
})
