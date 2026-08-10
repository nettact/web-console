import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import App from './App.vue'
import { NotFoundError, api } from './api'
import zh from './locales/zh'
import en from './locales/en'

// Mounting the whole page is the only check that catches what curl cannot: a
// template that throws, a missing translation key, or a payload field the view
// reads under a different name. The API is stubbed, so this exercises rendering
// and the toggle logic rather than the network.

function i18n() {
  return createI18n({ legacy: false, locale: 'en', fallbackLocale: 'zh', messages: { zh, en } })
}

// Every mount is tracked and torn down in afterEach rather than at the end of the
// test body: a failing assertion would otherwise skip the unmount and leak the
// page's poll interval into the next test, which then sees phantom API calls.
const mounted: Array<{ unmount: () => void }> = []

function mountApp() {
  const w = mount(App, { global: { plugins: [i18n()] } })
  mounted.push(w)
  return w
}

const page = {
  slug: 'home-lab',
  title: 'Home lab status',
  description: 'Public board',
  show_agent_view: true,
  show_target_view: true,
  show_target_address: false,
  generated_at: new Date().toISOString(),
}

beforeEach(() => {
  vi.useFakeTimers()
  location.hash = '#/home-lab'
})

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  vi.useRealTimers()
  location.hash = ''
})

describe('status page', () => {
  it('renders both views from the public payloads', async () => {
    vi.spyOn(api, 'page').mockResolvedValue(page)
    vi.spyOn(api, 'agentStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      agents: [
        { name: 'Alpha', ordinal: 1, online: true },
        { name: '', ordinal: 2, online: false },
      ],
    })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      targets: [
        { name: 'Website', ordinal: 1, kind: 'http', status: 'up', availability_24h: 0.9993 },
        { name: '', ordinal: 1, kind: 'icmp', status: 'down' },
      ],
    })

    const w = mountApp()
    await flushPromises()
    const text = w.text()

    expect(text).toContain('Home lab status')
    expect(text).toContain('Public board')
    expect(text).toContain('Alpha')
    // The unnamed rows fall back to their ordinals rather than to anything
    // identifying — this is the redaction contract, rendered.
    expect(text).toContain('Node 2')
    expect(text).toContain('Ping target 1')
    expect(text).toContain('Website')
    expect(text).toContain('99.93%')
    expect(text).toContain('1 of 2 online')
    expect(text).toContain('1 of 2 up')
  })

  it('omits a view the page does not publish, and does not request it', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    const agents = vi.spyOn(api, 'agentStatuses')
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      targets: [{ name: 'Website', ordinal: 1, kind: 'http', status: 'up' }],
    })

    const w = mountApp()
    await flushPromises()

    expect(agents).not.toHaveBeenCalled()
    expect(w.text()).not.toContain('Nodes')
    expect(w.text()).toContain('Monitors')
  })

  it('shows an address only when the page opted in', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false, show_target_address: true })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      targets: [
        { name: 'Website', ordinal: 1, kind: 'http', status: 'up', address: 'https://internal.example' },
      ],
    })

    const w = mountApp()
    await flushPromises()
    expect(w.text()).toContain('https://internal.example')
  })

  it('renders the not-found state for an unknown or unpublished page', async () => {
    vi.spyOn(api, 'page').mockRejectedValue(new NotFoundError())
    const w = mountApp()
    await flushPromises()
    expect(w.text()).toContain('Page not found')
  })

  it('asks for nothing when no page is addressed', async () => {
    location.hash = ''
    const pageSpy = vi.spyOn(api, 'page')
    const w = mountApp()
    await flushPromises()
    expect(pageSpy).not.toHaveBeenCalled()
    expect(w.text()).toContain('No status page selected')
  })

  // A failed refresh must keep the last good board on screen: blanking a page
  // that was fine a moment ago is worse than showing slightly old numbers, as
  // long as it says so.
  it('keeps the last data and warns when a refresh fails', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    const targets = vi
      .spyOn(api, 'targetStatuses')
      .mockResolvedValueOnce({
        generated_at: page.generated_at,
        targets: [{ name: 'Website', ordinal: 1, kind: 'http', status: 'up' }],
      })
      .mockRejectedValue(new Error('network down'))

    const w = mountApp()
    await flushPromises()
    expect(w.text()).toContain('Website')

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    expect(targets).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('Website')
    expect(w.text()).toContain('out of date')
  })

  // Opening the page while the server is briefly unreachable must not be a dead
  // end: the poll has to re-attempt the metadata, or every later poll returns
  // early for want of it and the error state is permanent.
  it('recovers on a later poll when the first load failed', async () => {
    const pageSpy = vi
      .spyOn(api, 'page')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ ...page, show_agent_view: false })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      targets: [{ name: 'Website', ordinal: 1, kind: 'http', status: 'up' }],
    })

    const w = mountApp()
    await flushPromises()
    expect(w.text()).toContain('Temporarily unavailable')

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    expect(pageSpy).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('Website')
  })

  // A page that answers not-found keeps polling — an operator who re-publishes it
  // should reach the tabs already open on it — but the not-found view must stay
  // put between polls rather than blinking through the loading state.
  it('recovers a re-published page without flickering through loading', async () => {
    const pageSpy = vi
      .spyOn(api, 'page')
      .mockRejectedValueOnce(new NotFoundError())
      .mockResolvedValue({ ...page, show_agent_view: false })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      targets: [{ name: 'Website', ordinal: 1, kind: 'http', status: 'up' }],
    })

    const w = mountApp()
    await flushPromises()
    expect(w.text()).toContain('Page not found')
    expect(w.text()).not.toContain('Loading')

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    expect(pageSpy).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('Website')
    expect(w.text()).not.toContain('Page not found')
  })

  // The metadata decides which endpoints get polled, so a stale copy of it is
  // not a cosmetic problem: a view the operator turns OFF would keep being
  // requested, 404, and take a still-published board down as "page not found".
  it('re-reads the metadata on every poll and follows a toggle change', async () => {
    const pageSpy = vi
      .spyOn(api, 'page')
      .mockResolvedValueOnce(page)
      .mockResolvedValue({ ...page, show_agent_view: false })
    const agents = vi.spyOn(api, 'agentStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      agents: [{ name: 'Alpha', ordinal: 1, online: true }],
    })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      targets: [{ name: 'Website', ordinal: 1, kind: 'http', status: 'up' }],
    })

    const w = mountApp()
    await flushPromises()
    expect(w.text()).toContain('Alpha')

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    expect(pageSpy).toHaveBeenCalledTimes(2)
    // The agent view is gone, the page itself is not.
    expect(agents).toHaveBeenCalledTimes(1)
    expect(w.text()).not.toContain('Alpha')
    expect(w.text()).toContain('Website')
    expect(w.text()).not.toContain('Page not found')
  })

  // Navigating between pages while a load is in flight must not let the slower
  // response paint: one page's title over another's rows is worse than a delay.
  it('discards a load that a hash change has superseded', async () => {
    let releaseFirst: (v: typeof page) => void = () => {}
    vi.spyOn(api, 'page').mockImplementation((slug: string) => {
      if (slug === 'home-lab') {
        return new Promise((resolve) => {
          releaseFirst = resolve
        })
      }
      return Promise.resolve({ ...page, slug: 'other', title: 'Other board', show_agent_view: false })
    })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      targets: [{ name: 'Other target', ordinal: 1, kind: 'http', status: 'up' }],
    })

    const w = mountApp()
    await flushPromises()

    // Navigate away while the first page's metadata is still in flight.
    location.hash = '#/other'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(w.text()).toContain('Other board')

    // The first request finally answers — and must be ignored.
    releaseFirst(page)
    await flushPromises()
    expect(w.text()).toContain('Other board')
    expect(w.text()).not.toContain('Home lab status')
  })

  it('polls on an interval and stops when unmounted', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    const targets = vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      targets: [],
    })

    const w = mountApp()
    await flushPromises()
    expect(targets).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(targets).toHaveBeenCalledTimes(2)

    w.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(targets).toHaveBeenCalledTimes(2)
  })
})
