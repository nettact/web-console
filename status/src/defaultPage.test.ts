import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import App from './App.vue'
import { api } from './api'
import zh from './locales/zh'
import en from './locales/en'

// The "status page as a domain's home page" deployment: config.js names a page,
// so a URL with no '#/<slug>' must render that board instead of the empty state.
//
// It lives in its own file because the configured default is a module-level
// constant read from window at import time — a test that assigned the global
// would run after config.ts had already read it, and mocking the module inside
// App.test.ts would silently retune every case there, including the one that
// asserts the empty state.
vi.mock('./config', () => ({ apiBase: '', defaultSlug: 'home-lab', consoleReachable: true }))

const page = {
  slug: 'home-lab',
  title: 'Home lab status',
  description: '',
  show_agent_view: false,
  show_target_view: true,
  show_incidents: false,
  show_target_address: false,
  is_home: false,
  generated_at: new Date().toISOString(),
}

const mounted: Array<{ unmount: () => void }> = []

function mountApp() {
  const w = mount(App, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'zh', messages: { zh, en } })],
    },
  })
  mounted.push(w)
  return w
}

beforeEach(() => {
  vi.useFakeTimers()
  location.hash = ''
})

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
  location.hash = ''
})

describe('configured default page', () => {
  it('renders the configured page at a bare URL', async () => {
    const pageSpy = vi.spyOn(api, 'page').mockResolvedValue(page)
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-01-01',
      targets: [],
    })

    const w = mountApp()
    await flushPromises()

    expect(pageSpy).toHaveBeenCalledWith('home-lab', expect.anything())
    expect(w.text()).toContain('Home lab status')
    expect(w.text()).not.toContain('No status page selected')
  })

  // The default must not become a lock: a reader following a link to another
  // published page still gets that page.
  it('yields to a page named in the hash', async () => {
    const pageSpy = vi.spyOn(api, 'page').mockResolvedValue({ ...page, slug: 'office', title: 'Office status' })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-01-01',
      targets: [],
    })

    location.hash = '#/office'
    mountApp()
    await flushPromises()

    expect(pageSpy).toHaveBeenCalledWith('office', expect.anything())
  })
})
