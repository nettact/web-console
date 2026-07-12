import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

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

const fullAgent: Agent = {
  id: 'agent-1',
  site_id: 'site-1',
  display_name: 'Agent 1',
  hostname: 'host-1',
  platform: 'linux',
  agent_version: 'test',
  status: 'online',
  capabilities: ['host.process.read', 'host.connection.read'],
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

const initialSnapshot: HostSnapshot = {
  ts: '2026-01-01T00:00:00Z',
  request_id: 'r1',
  process_total: 2,
  processes: [
    {
      pid: 10,
      name: 'alpha',
      cpu_pct: 1,
      rss_bytes: 100,
      virt_bytes: 200,
      disk_read_bytes: 0,
      disk_write_bytes: 0,
      run_time_seconds: 60,
    },
    {
      pid: 20,
      name: 'beta',
      cpu_pct: 0,
      rss_bytes: 50,
      virt_bytes: 100,
      disk_read_bytes: 0,
      disk_write_bytes: 0,
      run_time_seconds: 30,
    },
  ],
  connections: [
    {
      proto: 'tcp',
      local_addr: '127.0.0.1:1000',
      remote_addr: '1.1.1.1:443',
      state: 'ESTABLISHED',
      pid: 10,
      process_name: 'alpha',
    },
    {
      proto: 'udp',
      local_addr: '127.0.0.1:2000',
      remote_addr: '3.3.3.3:53',
      pid: 30,
      process_name: 'gamma',
    },
  ],
}

let wrapper: VueWrapper | undefined

async function render(snapshot: HostSnapshot = initialSnapshot, agent: Agent = fullAgent) {
  apiMock.agents.mockResolvedValue([agent])
  apiMock.agent.mockResolvedValue(agent)
  apiMock.requestSnapshot.mockResolvedValue({ request_id: snapshot.request_id })
  apiMock.getSnapshot.mockResolvedValue({ snapshot })

  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  wrapper = mount(Processes, { global: { plugins: [i18n] } })
  await flushPromises()
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  return wrapper
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
  it('jumps from a process to its connections without requesting another snapshot', async () => {
    const page = await render()
    const viewAlpha = page.findAll('button').find((button) => button.attributes('aria-label')?.includes('alpha'))

    expect(viewAlpha).toBeDefined()
    await viewAlpha!.trigger('click')

    const panels = page.findAll('section.panel')
    const connectionsPanel = panels[1]
    expect(connectionsPanel.attributes('style') || '').not.toContain('display: none')
    expect(connectionsPanel.text()).toContain('1.1.1.1:443')
    expect(connectionsPanel.text()).not.toContain('3.3.3.3:53')
    expect(apiMock.requestSnapshot).toHaveBeenCalledTimes(1)

    const filter = connectionsPanel.get('select#conn-filter')
    expect((filter.element as HTMLSelectElement).value).toBe('10')
    expect(filter.findAll('option').map((option) => option.text())).toEqual([
      'All processes',
      'alpha (10)',
      'beta (20)',
      'gamma (30)',
    ])

    await filter.setValue('20')
    expect(connectionsPanel.text()).toContain('beta (PID 20) has no network connections.')
    expect(connectionsPanel.text()).toContain('Clear filter')
  })

  it('clears a selected process after refresh when the PID maps to a different name', async () => {
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
    const viewAlpha = page.findAll('button').find((button) => button.attributes('aria-label')?.includes('alpha'))
    await viewAlpha!.trigger('click')

    const refresh = page.findAll('button').find((button) => button.text() === 'Refresh snapshot')
    await refresh!.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    const filter = page.get('select#conn-filter')
    expect((filter.element as HTMLSelectElement).value).toBe('')
  })

  it('does not expose the jump action without connection capability', async () => {
    const processOnlyAgent: Agent = {
      ...fullAgent,
      capabilities: ['host.process.read'],
    }
    const processOnlySnapshot: HostSnapshot = {
      ...initialSnapshot,
      connections: undefined,
    }
    const page = await render(processOnlySnapshot, processOnlyAgent)

    expect(page.findAll('button').some((button) => button.text() === 'View connections')).toBe(false)
    expect(page.find('select#conn-filter').exists()).toBe(false)
    expect(apiMock.requestSnapshot).toHaveBeenCalledWith('agent-1', true, false)
  })
})
