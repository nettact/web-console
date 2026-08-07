import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

// serverInfo.ensureServerInfo() calls api.serverInfo(); markRead() calls
// api.markIssuesRead()/api.listIssues(). Stub them so opening the dialog never
// touches the network.
const apiMock = vi.hoisted(() => ({
  serverInfo: vi.fn(),
  markIssuesRead: vi.fn(),
  listIssues: vi.fn(),
}))
vi.mock('../api', () => ({ api: apiMock }))

import type { AgentStatusRow, Issue } from '../api'
import NotificationBell from './NotificationBell.vue'
import { notifications } from '../notifications'
import { agentStatus } from '../agentStatus'
import { i18n } from '../i18n'

const ENV = 'NETTACT_AGENT_PERMISSIONS=host.process.basic.read,host.process.owner.read'

const issue = (extra: Partial<Issue> = {}): Issue => ({
  id: 'issue-1',
  site_id: 'site_default',
  agent_id: 'agent-1',
  agent_name: 'Agent 1',
  category: 'monitor',
  ref_id: 'target-1',
  monitor_name: 'Public DNS',
  reason: 'permission_blocked',
  missing_permissions: ['host.process.owner.read'],
  matched_selector: '',
  policy_hash: '',
  state: 'active',
  read: false,
  count: 1,
  first_seen_at: '2026-07-24T00:00:00Z',
  last_seen_at: '2026-07-24T00:00:00Z',
  resolved_at: null,
  remediation: { reason: 'permission_blocked', permissions_env: ENV },
  ...extra,
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/target-status', component: { template: '<div />' } },
      { path: '/agents', component: { template: '<div />' } },
    ],
  })
}

beforeEach(() => {
  apiMock.serverInfo.mockReset().mockResolvedValue({ listen: { desktop: false }, os: 'linux' })
  apiMock.markIssuesRead.mockReset().mockResolvedValue(undefined)
  const one = issue()
  apiMock.listIssues.mockReset().mockResolvedValue({ items: [one], unread_count: 0 })
  notifications.issues = [one]
  notifications.unread = 1
  // No agent-status batch by default: the state every test starts in for real,
  // since /issues and /agent-statuses are independent fetches.
  agentStatus.agents = []
})

afterEach(() => {
  notifications.issues = []
  notifications.unread = 0
  agentStatus.agents = []
})

describe('NotificationBell permission remediation', () => {
  it('opens the remediation dialog inline from a missing-permission chip without navigating', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(NotificationBell, {
      global: { plugins: [router, i18n], stubs: { teleport: true } },
    })

    await wrapper.get('.bell-btn').trigger('click')
    // No dialog until a permission is chosen.
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    const chip = wrapper.get('.chip.is-interactive')
    await chip.trigger('click')
    await flushPromises()

    // The dialog is populated from the issue's own data: the full env line plus the
    // per run-mode snippet tabs (proof the permission_blocked env flow rendered).
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain(ENV)
    expect(wrapper.find('[role="tab"]').exists()).toBe(true)
    // Opening the dialog must not deep-link to the Agent page (the old broken jump).
    expect(router.currentRoute.value.path).toBe('/')
  })

  // The bell renders from /issues; whether an agent is the desktop app's embedded
  // one comes from the independently fetched agent-status batch. So an issue can
  // be on screen, and clicked, before its agent is known — and the honest answer
  // at that moment ("assume ordinary, show the env line") becomes a lie the
  // instant the batch lands. Resolving the mode once at click time left the
  // embedded agent reading instructions to set a variable its build ignores, and
  // left them there. This locks the correction.
  it('switches to the desktop note when the agent-status batch lands after the dialog opened', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(NotificationBell, {
      global: { plugins: [router, i18n], stubs: { teleport: true } },
    })

    await wrapper.get('.bell-btn').trigger('click')
    await wrapper.get('.chip.is-interactive').trigger('click')
    await flushPromises()

    // Agent unknown so far: the ordinary env flow, tabs and all.
    expect(wrapper.get('[role="dialog"]').text()).toContain(ENV)
    expect(wrapper.find('[role="tab"]').exists()).toBe(true)

    agentStatus.agents = [{ id: 'agent-1', policy_source: 'desktop_full_access' } as AgentStatusRow]
    await flushPromises()

    // Same open dialog, now telling the truth about this agent: no env line to
    // set, and none of the per run-mode snippet tabs that go with it.
    expect(wrapper.get('[role="dialog"]').text()).not.toContain(ENV)
    expect(wrapper.find('[role="tab"]').exists()).toBe(false)
  })

  // The mirror case, and the one the whole change is for: an ordinary agent
  // enrolled against a desktop install must keep its env instructions. Before
  // this, the console asked the SERVER whether it was desktop, so every agent in
  // a desktop install's list was told its permissions were fixed at full access.
  it('keeps the env instructions for an ordinary agent even when other agents are embedded', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    agentStatus.agents = [
      { id: 'agent-embedded', policy_source: 'desktop_full_access' } as AgentStatusRow,
      { id: 'agent-1', policy_source: 'environment' } as AgentStatusRow,
    ]
    const wrapper = mount(NotificationBell, {
      global: { plugins: [router, i18n], stubs: { teleport: true } },
    })

    await wrapper.get('.bell-btn').trigger('click')
    await wrapper.get('.chip.is-interactive').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="dialog"]').text()).toContain(ENV)
    expect(wrapper.find('[role="tab"]').exists()).toBe(true)
  })
})
