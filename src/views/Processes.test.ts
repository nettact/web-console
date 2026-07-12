import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { defineComponent } from 'vue'

import en from '../locales/en'
import Processes from './Processes.vue'
import type { Agent, HostSnapshot } from '../api'

const apiMock = vi.hoisted(() => ({
  agents: vi.fn(),
  agent: vi.fn(),
  requestSnapshot: vi.fn(),
  getSnapshot: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

const RouterLinkStub = defineComponent({
  name: 'RouterLink',
  props: ['to'],
  template: '<a><slot /></a>',
})

const fullAgent: Agent = {
  id: 'agent-1',
  site_id: 'site-1',
  display_name: 'Agent 1',
  hostname: 'host-1',
  platform: 'windows',
  agent_version: 'test',
  status: 'online',
  capabilities: ['host.process.read', 'host.connection.read'],
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

const initialSnapshot: HostSnapshot = {
  ts: '2026-01-01T00:00:00Z',
  request_id: 'r1',
  process_total: 4,
  processes: [
    {
      pid: 10, name: 'alpha', cpu_pct: 1, rss_bytes: 100, virt_bytes: 200,
      disk_read_bytes: 0, disk_write_bytes: 0, run_time_seconds: 60,
    },
    {
      pid: 11, name: 'alpha', cpu_pct: 0.5, rss_bytes: 80, virt_bytes: 160,
      disk_read_bytes: 0, disk_write_bytes: 0, run_time_seconds: 55,
    },
    {
      pid: 20, name: 'beta', cpu_pct: 0, rss_bytes: 50, virt_bytes: 100,
      disk_read_bytes: 0, disk_write_bytes: 0, run_time_seconds: 30,
    },
    {
      pid: 40, name: '', cpu_pct: 0, rss_bytes: 10, virt_bytes: 20,
      disk_read_bytes: 0, disk_write_bytes: 0, run_time_seconds: 10,
    },
  ],
  connections: [
    {
      proto: 'tcp', local_addr: '127.0.0.1:1000', remote_addr: '1.1.1.1:443',
      state: 'ESTABLISHED', pid: 10, process_name: 'alpha',
    },
    {
      proto: 'tcp', local_addr: '127.0.0.1:1001', remote_addr: '2.2.2.2:8443',
      state: 'ESTABLISHED', pid: 11, process_name: 'alpha',
    },
    {
      proto: 'udp', local_addr: '127.0.0.1:2000', remote_addr: '3.3.3.3:53',
      pid: 30, process_name: 'gamma',
    },
    {
      proto: 'tcp6', local_addr: '[::1]:3000', remote_addr: '[2001:db8::1]:443',
      state: 'ESTABLISHED', pid: 20, process_name: 'beta',
    },
    { proto: 'udp', local_addr: '0.0.0.0:4000', pid: 40 },
  ],
}

let wrapper: VueWrapper | undefined

async function render(snapshot: HostSnapshot = initialSnapshot, agent: Agent = fullAgent) {
  apiMock.agents.mockResolvedValue([agent])
  apiMock.agent.mockResolvedValue(agent)
  apiMock.requestSnapshot.mockResolvedValue({ request_id: snapshot.request_id })
  apiMock.getSnapshot.mockResolvedValue({ snapshot })

  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  wrapper = mount(Processes, {
    global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  return wrapper
}

function button(page: VueWrapper, text: string) {
  const found = page.findAll('button').find((item) => item.text().includes(text))
  expect(found, `button containing ${text}`).toBeDefined()
  return found!
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

describe('Processes network-connection filtering', () => {
  it('aggregates same-name PIDs by default and isolates an exact PID on demand', async () => {
    const page = await render()
    await button(page, 'View connections').trigger('click')

    const connectionsPanel = page.findAll('section.panel')[1]
    expect(connectionsPanel.text()).toContain('1.1.1.1:443')
    expect(connectionsPanel.text()).toContain('2.2.2.2:8443')
    expect(connectionsPanel.text()).not.toContain('3.3.3.3:53')
    expect(apiMock.requestSnapshot).toHaveBeenCalledTimes(1)

    let filter = connectionsPanel.get('select#conn-filter')
    expect((filter.element as HTMLSelectElement).value).toBe('alpha')
    expect(filter.findAll('option').map((option) => option.text())).toEqual([
      'All processes', 'alpha', 'beta', 'gamma',
    ])

    await button(page, 'PID').trigger('click')
    filter = connectionsPanel.get('select#conn-filter')
    expect((filter.element as HTMLSelectElement).value).toBe('')
    await filter.setValue('10')
    expect(connectionsPanel.text()).toContain('1.1.1.1:443')
    expect(connectionsPanel.text()).not.toContain('2.2.2.2:8443')
  })

  it('clears a selected PID after refresh when the PID maps to a different name', async () => {
    const changedSnapshot: HostSnapshot = {
      ...initialSnapshot,
      request_id: 'r2',
      processes: initialSnapshot.processes!.map((process) =>
        process.pid === 10 ? { ...process, name: 'delta' } : process,
      ),
      connections: initialSnapshot.connections!.map((connection) =>
        connection.pid === 10 ? { ...connection, process_name: 'delta' } : connection,
      ),
    }
    apiMock.requestSnapshot
      .mockResolvedValueOnce({ request_id: 'r1' })
      .mockResolvedValueOnce({ request_id: 'r2' })
    apiMock.getSnapshot
      .mockResolvedValueOnce({ snapshot: initialSnapshot })
      .mockResolvedValueOnce({ snapshot: changedSnapshot })

    const page = await render()
    await button(page, 'PID').trigger('click')
    await button(page, 'View connections').trigger('click')
    await button(page, 'Refresh snapshot').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect((page.get('select#conn-filter').element as HTMLSelectElement).value).toBe('')
  })

  it('keeps a connection-only PID selected when process_name stays omitted', async () => {
    const connectionOnlyAgent: Agent = {
      ...fullAgent,
      capabilities: ['host.connection.read'],
    }
    const first: HostSnapshot = {
      ts: initialSnapshot.ts,
      request_id: 'r1',
      process_total: 0,
      connections: [{ proto: 'udp', local_addr: '0.0.0.0:4000', pid: 40 }],
    }
    const second: HostSnapshot = { ...first, request_id: 'r2' }
    apiMock.requestSnapshot
      .mockResolvedValueOnce({ request_id: 'r1' })
      .mockResolvedValueOnce({ request_id: 'r2' })
    apiMock.getSnapshot
      .mockResolvedValueOnce({ snapshot: first })
      .mockResolvedValueOnce({ snapshot: second })

    const page = await render(first, connectionOnlyAgent)
    await button(page, 'PID').trigger('click')
    const filter = page.get('select#conn-filter')
    await filter.setValue('40')
    await button(page, 'Refresh snapshot').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect((page.get('select#conn-filter').element as HTMLSelectElement).value).toBe('40')
  })

  it('builds TCP and ICMP quick-add routes and hides rows without a remote IP', async () => {
    const page = await render()
    await button(page, 'Connections').trigger('click')

    const links = page.findAllComponents(RouterLinkStub)
    expect(links.map((link) => link.props('to'))).toEqual([
      { path: '/monitoring/new', query: { kind: 'tcp', target: '1.1.1.1', port: '443' } },
      { path: '/monitoring/new', query: { kind: 'tcp', target: '2.2.2.2', port: '8443' } },
      { path: '/monitoring/new', query: { kind: 'icmp', target: '3.3.3.3' } },
      { path: '/monitoring/new', query: { kind: 'tcp', target: '2001:db8::1', port: '443' } },
    ])
    expect(links.every((link) => link.text() === 'Add monitor')).toBe(true)
  })

  it('does not expose the jump action without connection capability', async () => {
    const processOnlyAgent: Agent = { ...fullAgent, capabilities: ['host.process.read'] }
    const processOnlySnapshot: HostSnapshot = { ...initialSnapshot, connections: undefined }
    const page = await render(processOnlySnapshot, processOnlyAgent)

    expect(page.findAll('button').some((item) => item.text() === 'View connections')).toBe(false)
    expect(page.find('select#conn-filter').exists()).toBe(false)
    expect(apiMock.requestSnapshot).toHaveBeenCalledWith('agent-1', true, false)
  })
})
