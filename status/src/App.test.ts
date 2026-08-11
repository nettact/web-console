import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import App from './App.vue'
import {
  NotFoundError,
  api,
  type PublicAvailability,
  type PublicDailyAvailability,
  type PublicTargetRow,
} from './api'
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
  show_incidents: false,
  show_target_address: false,
  generated_at: new Date().toISOString(),
}

// Target rows carry a fixed set of availability windows and a full-length day
// strip on every payload, so the fixtures fill them here and each test states only
// the part it is about. A ratio of null is the server's "no verdict in this
// window", which is what a board with no history looks like.
function avail(ratio?: number): PublicAvailability[] {
  return ['24h', '7d', '30d', '90d', '1y'].map((window) => ({
    window,
    ratio: ratio ?? null,
    rounds: ratio == null ? 0 : 100,
  }))
}

function day(ratio: number | null = null, rounds = ratio == null ? 0 : 100): PublicDailyAvailability {
  return {
    ratio,
    rounds,
    ok_rounds: ratio == null ? 0 : Math.round(ratio * rounds),
  }
}

function tgt(
  row: Partial<PublicTargetRow> & Pick<PublicTargetRow, 'name' | 'ordinal' | 'kind' | 'status'>,
): PublicTargetRow {
  return { availability: avail(), days: Array.from({ length: 90 }, () => day()), ...row }
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
  it('renders published views as separate tabs', async () => {
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
      days_from: '2026-05-14',
      targets: [
        tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up', availability: avail(0.9993) }),
        tgt({ name: '', ordinal: 1, kind: 'icmp', status: 'down' }),
      ],
    })

    const w = mountApp()
    await flushPromises()
    const text = w.text()

    expect(text).toContain('Home lab status')
    expect(text).toContain('Public board')
    expect(w.get('#status-tab-targets').attributes('aria-selected')).toBe('true')
    expect(w.get('#status-tab-agents').attributes('aria-selected')).toBe('false')
    expect(text).not.toContain('Alpha')
    expect(text).toContain('Ping target 1')
    expect(text).toContain('Website')
    expect(text).toContain('99.93%')
    expect(text).toContain('1 of 2 online')
    expect(text).toContain('1 of 2 up')
    expect(w.get('.current-status').text()).toContain('Fault detected')
    expect(w.get('.current-status').text()).toContain('currently has a fault')

    await w.get('#status-tab-agents').trigger('click')
    const agentText = w.text()
    expect(w.get('#status-tab-agents').attributes('aria-selected')).toBe('true')
    expect(agentText).toContain('Alpha')
    // The unnamed rows fall back to their ordinals rather than to anything
    // identifying — this is the redaction contract, rendered.
    expect(agentText).toContain('Node 2')
    expect(agentText).not.toContain('Website')
  })

  it('summarizes a healthy current state above the published views', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })

    const w = mountApp()
    await flushPromises()

    expect(w.get('.current-status').attributes('aria-live')).toBe('polite')
    expect(w.get('.current-status').text()).toContain('Operational')
    expect(w.get('.current-status').text()).toContain('No current faults')
  })

  it('does not claim a fault-free state when a published target has no verdict', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'unknown' })],
    })

    const w = mountApp()
    await flushPromises()

    expect(w.get('.current-status').text()).toContain('Status incomplete')
    expect(w.get('.current-status').text()).toContain('not fully known')
  })

  it('switches tabs with arrow keys', async () => {
    vi.spyOn(api, 'page').mockResolvedValue(page)
    vi.spyOn(api, 'agentStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      agents: [{ name: 'Alpha', ordinal: 1, online: true }],
    })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })

    const w = mountApp()
    await flushPromises()
    await w.get('#status-tab-targets').trigger('keydown', { key: 'ArrowRight' })

    expect(w.get('#status-tab-agents').attributes('aria-selected')).toBe('true')
    expect(w.text()).toContain('Alpha')
    expect(w.text()).not.toContain('Website')
  })

  it('renders opt-in incident history as a third view', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_incidents: true })
    vi.spyOn(api, 'agentStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      agents: [{ name: 'Alpha', ordinal: 1, online: true }],
    })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })
    vi.spyOn(api, 'incidents').mockResolvedValue({
      generated_at: page.generated_at,
      window_start: new Date(Date.parse(page.generated_at) - 90 * 86_400_000).toISOString(),
      truncated: true,
      incidents: [
        {
          state: 'open',
          impact: 'outage',
          started_at: '2026-08-11T10:00:00Z',
          subjects: [{ type: 'target', name: 'Website', ordinal: 1, kind: 'http' }],
        },
        {
          state: 'resolved',
          impact: 'degraded',
          started_at: '2026-08-10T10:00:00Z',
          resolved_at: '2026-08-10T10:12:00Z',
          subjects: [{ type: 'agent', name: '', ordinal: 2 }],
        },
      ],
    })

    const w = mountApp()
    await flushPromises()

    expect(w.get('#status-tab-incidents').attributes('aria-selected')).toBe('false')
    expect(w.get('.tabs').classes()).toContain('tabs-3')
    await w.get('#status-tab-incidents').trigger('click')
    const text = w.text()
    expect(text).toContain('Website')
    expect(text).toContain('Interruption')
    expect(text).toContain('In progress')
    expect(text).toContain('Node 2')
    expect(text).toContain('Degraded')
    expect(text).toContain('Resolved')
    expect(text).toContain('Showing the most recent 2 incidents.')
    expect(text).toContain('Shows the last 90 days')
    expect(text).not.toContain('Alpha')
  })

  it('treats an active degraded incident as a current fault', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({
      ...page,
      show_agent_view: false,
      show_incidents: true,
    })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })
    vi.spyOn(api, 'incidents').mockResolvedValue({
      generated_at: page.generated_at,
      window_start: new Date(Date.parse(page.generated_at) - 90 * 86_400_000).toISOString(),
      incidents: [
        {
          state: 'open',
          impact: 'degraded',
          started_at: '2026-08-11T10:00:00Z',
          subjects: [{ type: 'target', name: 'Website', ordinal: 1, kind: 'http' }],
        },
      ],
    })

    const w = mountApp()
    await flushPromises()

    expect(w.get('.current-status').text()).toContain('Fault detected')
  })

  it('omits a view the page does not publish, and does not request it', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    const agents = vi.spyOn(api, 'agentStatuses')
    const incidents = vi.spyOn(api, 'incidents')
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })

    const w = mountApp()
    await flushPromises()

    expect(agents).not.toHaveBeenCalled()
    expect(incidents).not.toHaveBeenCalled()
    expect(w.text()).not.toContain('Nodes')
    expect(w.text()).toContain('Monitors')
  })

  it('shows an address only when the page opted in', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false, show_target_address: true })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [
        tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up', address: 'https://internal.example' }),
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
        days_from: '2026-05-14',
        targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
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
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
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
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
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
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })

    const w = mountApp()
    await flushPromises()
    await w.get('#status-tab-agents').trigger('click')
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
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Other target', ordinal: 1, kind: 'http', status: 'up' })],
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

  // A load slower than the poll interval must still be allowed to finish. With a
  // generation that every tick advanced, each in-flight load was invalidated by
  // the next tick, so on a slow link the page never painted at all.
  it('lets a load slower than the poll interval finish', async () => {
    let release: (v: typeof page) => void = () => {}
    const pageSpy = vi.spyOn(api, 'page').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })

    const w = mountApp()
    await flushPromises()

    // Two poll intervals pass while the first request is still outstanding.
    await vi.advanceTimersByTimeAsync(90_000)
    await flushPromises()
    // The polls yielded rather than piling on.
    expect(pageSpy).toHaveBeenCalledTimes(1)

    release({ ...page, show_agent_view: false })
    await flushPromises()
    expect(w.text()).toContain('Website')
  })

  // Metadata and rows are one refresh. Applied separately, a poll whose metadata
  // lands but whose rows fail would pair the new toggles with absent data — and a
  // freshly enabled view would assert "publishes no nodes".
  it('does not apply new toggles when the rows fail to load', async () => {
    vi.spyOn(api, 'page')
      .mockResolvedValueOnce({ ...page, show_agent_view: false })
      .mockResolvedValue(page) // agent view now enabled
    vi.spyOn(api, 'agentStatuses').mockRejectedValue(new Error('network down'))
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })

    const w = mountApp()
    await flushPromises()
    expect(w.text()).toContain('Website')

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    // The board keeps its last consistent state and says it may be stale, rather
    // than showing an empty "Nodes" section that claims nothing is published.
    expect(w.text()).not.toContain('publishes no nodes')
    expect(w.text()).toContain('out of date')
    expect(w.text()).toContain('Website')
  })

  // Navigating to another page shows the loading state, not the error notice.
  it('shows loading while navigating to another page', async () => {
    let release: (v: typeof page) => void = () => {}
    vi.spyOn(api, 'page').mockImplementation((slug: string) => {
      if (slug === 'home-lab') return Promise.resolve({ ...page, show_agent_view: false })
      return new Promise((resolve) => {
        release = resolve
      })
    })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })

    const w = mountApp()
    await flushPromises()
    expect(w.text()).toContain('Website')

    location.hash = '#/other'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(w.text()).toContain('Loading')
    expect(w.text()).not.toContain('Temporarily unavailable')

    release({ ...page, slug: 'other', title: 'Other board', show_agent_view: false })
    await flushPromises()
    expect(w.text()).toContain('Other board')
  })

  // A request left over from a page the reader moved on from must not gate the
  // page they are actually looking at: fetch has no timeout, so one stalled
  // connection would otherwise freeze the live board forever.
  it('keeps polling the current page while a superseded request hangs', async () => {
    const aborted: string[] = []
    vi.spyOn(api, 'page').mockImplementation((slug: string, signal?: AbortSignal) => {
      if (slug === 'home-lab') {
        // Never resolves on its own — only aborting ends it.
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            aborted.push(slug)
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }
      return Promise.resolve({ ...page, slug: 'other', title: 'Other board', show_agent_view: false })
    })
    const targets = vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up' })],
    })

    const w = mountApp()
    await flushPromises()

    location.hash = '#/other'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(w.text()).toContain('Other board')
    // Navigating cancelled the stalled request rather than leaving it running.
    expect(aborted).toEqual(['home-lab'])

    const before = targets.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    expect(targets.mock.calls.length).toBeGreaterThan(before)
  })

  // A load the reader has navigated away from must not go on to request rows for
  // the page they left.
  it('does not fetch rows for a page abandoned mid-load', async () => {
    let releaseFirst: (v: typeof page) => void = () => {}
    vi.spyOn(api, 'page').mockImplementation((slug: string) => {
      if (slug === 'home-lab') {
        return new Promise((resolve) => {
          releaseFirst = resolve
        })
      }
      return Promise.resolve({ ...page, slug: 'other', title: 'Other board', show_target_view: false })
    })
    const targets = vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [],
    })
    vi.spyOn(api, 'agentStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      agents: [{ name: 'Alpha', ordinal: 1, online: true }],
    })

    const w = mountApp()
    await flushPromises()

    location.hash = '#/other'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(w.text()).toContain('Other board')

    // The abandoned page's metadata finally arrives; its rows must never be asked for.
    releaseFirst(page)
    await flushPromises()
    expect(targets).not.toHaveBeenCalled()
    expect(w.text()).toContain('Other board')
  })

  it('polls on an interval and stops when unmounted', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    const targets = vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
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

  it('renders every availability window, and a window with no verdict as a dash', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [
        tgt({
          name: 'Website',
          ordinal: 1,
          kind: 'http',
          status: 'up',
          availability: [
            { window: '24h', ratio: 1, rounds: 1440 },
            { window: '7d', ratio: 0.9993, rounds: 10080 },
            { window: '30d', ratio: 0.9981, rounds: 43200 },
            { window: '90d', ratio: 0.9952, rounds: 129600 },
            // Nothing that far back yet: unknown, which must not read as 0%.
            { window: '1y', ratio: null, rounds: 0 },
          ],
        }),
      ],
    })

    const w = mountApp()
    await flushPromises()
    const text = w.text()

    for (const label of ['24h', '7 days', '30 days', '90 days', '1 year']) {
      expect(text).toContain(label)
    }
    expect(text).toContain('100.00%')
    expect(text).toContain('99.93%')
    expect(text).toContain('99.52%')
    expect(text).not.toContain('0.0%')
    expect(w.findAll('.avail-cell')).toHaveLength(5)
  })

  it('draws one uptime-bar cell per day and colours a missing day as absent', async () => {
    const days = Array.from({ length: 90 }, () => day(1, 1440))
    days[0] = day() // before this deployment existed
    days[89] = day(0.5, 120) // today, half of 120 conclusive probes succeeded
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_agent_view: false })
    vi.spyOn(api, 'targetStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      days_from: '2026-05-14',
      targets: [tgt({ name: 'Website', ordinal: 1, kind: 'http', status: 'up', days })],
    })

    const w = mountApp()
    await flushPromises()

    const cells = w.findAll('.bar rect')
    expect(cells).toHaveLength(90)
    // A day with no verdict must not be drawn as an outage.
    expect(cells[0].classes()).toContain('cell-none')
    expect(cells[0].classes()).not.toContain('cell-down')
    expect(cells[1].classes()).toContain('cell-up')
    expect(cells[89].classes()).toContain('cell-down')

    // Focus opens today's rich overview immediately; keyboard navigation can
    // reach every UTC day without placing ninety cells in the tab order.
    const bar = w.get('.bar')
    await bar.trigger('focus')
    expect(bar.attributes('role')).toBe('slider')
    expect(bar.attributes('aria-valuetext')).toContain('Major outage')
    expect(w.get('.day-tooltip').text()).toContain('50.0%')
    expect(w.get('.day-tooltip').text()).toContain('60 of 120 succeeded')

    await bar.trigger('keydown', { key: 'Home' })
    expect(w.get('.day-tooltip').text()).toContain('May 14, 2026')
    expect(w.get('.day-tooltip').text()).toContain('No verdict')
    expect(w.get('.day-tooltip').text()).toContain('No conclusive probes')

    await bar.trigger('pointerleave')
    await bar.trigger('blur')
    expect(w.find('.day-tooltip').exists()).toBe(false)
    vi.spyOn(bar.element, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 900,
      bottom: 44,
      width: 900,
      height: 44,
      toJSON: () => ({}),
    })
    bar.element.dispatchEvent(new MouseEvent('pointerenter', { clientX: 899, bubbles: true }))
    await flushPromises()
    expect(w.find('.day-tooltip').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(849)
    expect(w.find('.day-tooltip').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(w.get('.day-tooltip').text()).toContain('60 of 120 succeeded')
  })

  it('renders published node resources and leaves denied families out entirely', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_target_view: false })
    vi.spyOn(api, 'agentStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      agents: [
        {
          name: 'Alpha',
          ordinal: 1,
          online: true,
          resources: {
            cpu_pct: 12.5,
            load: [0.42, 0.31, 0.28],
            mem_pct: 48,
            disk_pct: 61,
            disk_mounts: 3,
            rx_bps: 1_200_000,
            tx_bps: 340_000,
            uptime_s: 1_051_200,
          },
        },
      ],
    })

    const w = mountApp()
    await flushPromises()
    const text = w.text()

    expect(text).toContain('13%') // 12.5 rounded — whole percent is the resolution here
    expect(text).toContain('0.42 / 0.31 / 0.28')
    expect(text).toContain('48%')
    expect(text).toContain('61%')
    expect(text).toContain('1.1 MB/s')
    expect(text).toContain('12d 4h')
    // agent_metrics=basic: no byte totals and no mount path anywhere on the page.
    expect(text).not.toContain('GB')
    expect(text).not.toContain('/mnt')
  })

  it('omits the resource block when the page publishes none', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_target_view: false })
    vi.spyOn(api, 'agentStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      agents: [{ name: 'Alpha', ordinal: 1, online: true }],
    })

    const w = mountApp()
    await flushPromises()

    expect(w.find('.res-grid').exists()).toBe(false)
    expect(w.text()).toContain('Alpha')
  })

  it('dims a node whose readings stopped rather than presenting them as current', async () => {
    vi.spyOn(api, 'page').mockResolvedValue({ ...page, show_target_view: false })
    vi.spyOn(api, 'agentStatuses').mockResolvedValue({
      generated_at: page.generated_at,
      agents: [
        { name: 'Alpha', ordinal: 1, online: true, resources: { cpu_pct: 12, stale: true } },
      ],
    })

    const w = mountApp()
    await flushPromises()

    expect(w.find('.row-detail').classes()).toContain('res-stale')
    expect(w.find('dl > p').exists()).toBe(false)
    expect(w.text()).toContain('This node has stopped reporting.')
  })
})
