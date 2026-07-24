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

import type { Issue } from '../api'
import NotificationBell from './NotificationBell.vue'
import { notifications } from '../notifications'
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
})

afterEach(() => {
  notifications.issues = []
  notifications.unread = 0
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
})
