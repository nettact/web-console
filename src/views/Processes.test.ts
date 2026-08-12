import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import Processes from './Processes.vue'
import PermissionRemediationDialog from '../components/status/PermissionRemediationDialog.vue'
import type { Agent, HostSnapshot } from '../api'

const apiMock = vi.hoisted(() => ({
  agents: vi.fn(),
  agent: vi.fn(),
  agentPermissions: vi.fn(),
  requestSnapshot: vi.fn(),
  getSnapshot: vi.fn(),
}))

// The page imports RouterLink directly from vue-router, so the mock must export a
// stub component (a name-based global stub would not replace the direct import).
const routerMock = vi.hoisted(() => ({
  RouterLink: {
    name: 'RouterLink',
    props: ['to'],
    template: '<a><slot /></a>',
  },
}))

vi.mock('../api', () => ({ api: apiMock }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), RouterLink: routerMock.RouterLink }))

const RouterLinkStub = routerMock.RouterLink

// Snapshot scopes the fixtures report as collected. The reworked page is
// scope-driven: which columns/controls render depends on which permission scopes
// the agent actually collected, so fixtures carry both the agent's effective
// permissions and the per-scope snapshot result.
const PROC_SCOPES = [
  'host.process.basic.read',
  'host.process.owner.read',
  'host.process.resource.read',
  'host.process.io.read',
]
const CONN_SCOPES = [
  'host.connection.summary.read',
  'host.connection.local.read',
  'host.connection.remote.read',
  'host.connection.owner.read',
]
const collectedScopes = (ids: string[]) =>
  ids.map((scope) => ({ scope, status: 'collected' as const }))

const fullAgent: Agent = {
  id: 'agent-1',
  site_id: 'site-1',
  display_name: 'Agent 1',
  hostname: 'host-1',
  platform: 'windows',
  agent_version: 'test',
  status: 'online',
  supported: [...PROC_SCOPES, ...CONN_SCOPES],
  granted: [...PROC_SCOPES, ...CONN_SCOPES],
  effective: [...PROC_SCOPES, ...CONN_SCOPES],
  policy_source: 'environment',
  policy_hash: 'test',
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00Z',
  first_connected_at: null,
  last_disconnect_kind: '',
  connectivity_alerts_muted: false,
}

const initialSnapshot: HostSnapshot = {
  ts: '2026-01-01T00:00:00Z',
  request_id: 'r1',
  scopes: collectedScopes([...PROC_SCOPES, ...CONN_SCOPES]),
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
    { proto: 'tcp6', local_addr: '[::]:80', remote_addr: '[::]:0', state: 'LISTEN', pid: 40 },
    { proto: 'udp', local_addr: '0.0.0.0:4000', pid: 40 },
  ],
}

let wrapper: VueWrapper | undefined

async function render(
  snapshot: HostSnapshot = initialSnapshot,
  agent: Agent = fullAgent,
  remediation?: { reason: string; permissions_env?: string },
  props: Record<string, unknown> = {},
) {
  apiMock.agents.mockResolvedValue([agent])
  apiMock.agent.mockResolvedValue(agent)
  // The real inventory lists the WHOLE permission catalog in canonical order and
  // attaches, per ungranted permission, the dependency-closed line that grants it.
  // The fixture keeps that shape: anything already granted first, then the eight
  // snapshot scopes.
  const inventoryIds = [
    ...agent.granted.filter((id) => ![...PROC_SCOPES, ...CONN_SCOPES].includes(id)),
    ...PROC_SCOPES,
    ...CONN_SCOPES,
  ]
  apiMock.agentPermissions.mockResolvedValue({
    agent_id: agent.id,
    policy_source: agent.policy_source,
    policy_hash: agent.policy_hash,
    permissions: inventoryIds.map((id) => ({
      id,
      granted: agent.granted.includes(id),
      supported: agent.supported.includes(id),
      effective: agent.effective.includes(id),
      permissions_env: agent.granted.includes(id)
        ? undefined
        : `NETTACT_AGENT_PERMISSIONS=${[...agent.granted, id].join(',')}`,
    })),
  })
  apiMock.requestSnapshot.mockResolvedValue({ request_id: snapshot.request_id })
  apiMock.getSnapshot.mockResolvedValue({ snapshot, remediation })

  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  wrapper = mount(Processes, {
    props,
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
    await page.get('.connection-action').trigger('click')

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
    await page.get('.connection-action').trigger('click')
    await button(page, 'Refresh snapshot').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect((page.get('select#conn-filter').element as HTMLSelectElement).value).toBe('')
  })

  it('keeps a connection-only PID selected when process_name stays omitted', async () => {
    const connectionOnlyAgent: Agent = {
      ...fullAgent,
      supported: CONN_SCOPES,
      granted: CONN_SCOPES,
      effective: CONN_SCOPES,
    }
    const first: HostSnapshot = {
      ts: initialSnapshot.ts,
      request_id: 'r1',
      scopes: collectedScopes(CONN_SCOPES),
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

    const connectionsPanel = page.findAll('section.panel')[1]
    await connectionsPanel.get('.field-mode input').setValue(true)
    const links = page.findAllComponents(RouterLinkStub)
    expect(links).toHaveLength(4)
    expect(links.map((link) => link.props('to'))).toEqual(expect.arrayContaining([
      { path: '/monitoring/new', query: { kind: 'tcp', target: '1.1.1.1', port: '443' } },
      { path: '/monitoring/new', query: { kind: 'tcp', target: '2.2.2.2', port: '8443' } },
      { path: '/monitoring/new', query: { kind: 'icmp', target: '3.3.3.3' } },
      { path: '/monitoring/new', query: { kind: 'tcp', target: '2001:db8::1', port: '443' } },
    ]))
    expect(links.every((link) => link.text() === 'Add monitor')).toBe(true)
  })

  it('keeps secondary fields in a full-width expandable summary row', async () => {
    const page = await render()

    expect(page.find('.process-summary-table').exists()).toBe(true)
    expect(page.find('.full-fields-table').exists()).toBe(false)
    expect(page.get('.summary-row .identity-cell').text()).toContain('PID 10')
    expect(page.get('.summary-row .metric-value').text()).toContain('%')

    await page.get('.detail-toggle').trigger('click')
    const detail = page.get('.detail-row')
    expect(detail.get('td').attributes('colspan')).toBe('4')
    expect(detail.text()).toContain('Virtual')
    expect(detail.text()).toContain('Uptime')
    expect(detail.text()).toContain('Disk R / W')
  })

  it('filters locally and renders process rows in batches of 100', async () => {
    const manyProcesses = Array.from({ length: 205 }, (_, index) => ({
      pid: index + 1,
      name: index === 204 ? 'needle-process' : `worker-${String(index).padStart(3, '0')}`,
      cpu_pct: index,
      rss_bytes: index + 1,
    }))
    const page = await render({ ...initialSnapshot, process_total: 205, processes: manyProcesses })

    expect(page.findAll('.process-summary-table .summary-row')).toHaveLength(100)
    await button(page, 'Show 100 more').trigger('click')
    expect(page.findAll('.process-summary-table .summary-row')).toHaveLength(200)

    await page.get('.data-search input').setValue('needle')
    expect(page.findAll('.process-summary-table .summary-row')).toHaveLength(1)
    expect(page.get('.process-summary-table .summary-row').text()).toContain('needle-process')
  })

  it('uses horizontal scrolling only for the optional all-fields mode', async () => {
    const page = await render()
    const processPanel = page.findAll('section.panel')[0]
    const connectionPanel = page.findAll('section.panel')[1]
    const tableWrap = processPanel.get('.table-wrap')

    expect(tableWrap.classes()).not.toContain('all-fields')
    expect(processPanel.find('.process-summary-table').exists()).toBe(true)
    expect(connectionPanel.find('.connection-summary-table').exists()).toBe(true)
    await processPanel.get('.field-mode input').setValue(true)
    expect(tableWrap.classes()).toContain('all-fields')
    expect(processPanel.find('.summary-table').exists()).toBe(false)
    expect(processPanel.find('.full-fields-table').exists()).toBe(true)
    expect(connectionPanel.find('.connection-summary-table').exists()).toBe(true)
    expect(connectionPanel.find('.full-fields-table').exists()).toBe(false)

    await connectionPanel.get('.field-mode input').setValue(true)
    expect(connectionPanel.get('.table-wrap').classes()).toContain('all-fields')
    expect(connectionPanel.find('.connection-summary-table').exists()).toBe(false)
    expect(connectionPanel.find('.full-fields-table').exists()).toBe(true)
  })

  it('keeps process identity cells in the table layout in all-fields mode', async () => {
    const page = await render()
    const processPanel = page.findAll('section.panel')[0]
    await processPanel.get('.field-mode input').setValue(true)

    const firstRow = processPanel.get('.full-fields-table tbody tr')
    const cells = firstRow.findAll('td')
    expect(cells[0].classes()).not.toContain('truncate')
    expect(cells[0].get('.truncate').text()).toBe('alpha')
    expect(cells[1].text()).toBe('10')
  })

  it('keeps connections with a remote address ahead of listening sockets', async () => {
    const page = await render()
    await button(page, 'Connections').trigger('click')

    const rows = page.findAll('.connection-summary-table .summary-row')
    expect(rows).toHaveLength(6)
    expect(rows.slice(0, 4).every((row) => row.get('.identity-cell strong').attributes('title') !== '—')).toBe(true)
    expect(rows.slice(4).map((row) => row.get('.identity-cell strong').attributes('title')))
      .toEqual(expect.arrayContaining(['[::]:0', '—']))
    expect(rows[0].get('.connection-owner-layout').findAll(':scope > *')).toHaveLength(2)
    expect(rows[0].get('.connection-owner-layout > .detail-toggle').text()).toBe('Details')
  })

  it('keeps duplicate connection rows independently keyed', async () => {
    const duplicate = initialSnapshot.connections![0]
    const page = await render({
      ...initialSnapshot,
      connections: [duplicate, { ...duplicate }],
    })
    await button(page, 'Connections').trigger('click')

    const rows = page.findAll('.connection-summary-table .summary-row')
    expect(rows).toHaveLength(2)
    await rows[1].get('.detail-toggle').trigger('click')

    expect(page.findAll('.connection-summary-table .detail-row')).toHaveLength(1)
    expect(rows[0].get('.detail-toggle').attributes('aria-expanded')).toBe('false')
    expect(rows[1].get('.detail-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('keeps connection filters in stable toolbar slots across filter bases', async () => {
    const page = await render()
    await button(page, 'Connections').trigger('click')
    const toolbar = page.get('.connection-toolbar')

    expect(toolbar.get('.connection-process-filter').find('select#conn-filter').exists()).toBe(true)
    expect(toolbar.get('.connection-sort-control').find('select#connection-sort').exists()).toBe(true)
    await button(page, 'PID').trigger('click')
    expect(toolbar.get('.connection-process-filter').find('select#conn-filter').exists()).toBe(true)
    expect(toolbar.get('.connection-sort-control').find('select#connection-sort').exists()).toBe(true)
  })

  it('emits a peer-tab request from embedded process mode', async () => {
    const page = await render(initialSnapshot, fullAgent, undefined, {
      embedded: true,
      fixedAgentId: 'agent-1',
      fixedMode: 'processes',
    })

    expect(page.find('.workbench-tabs').exists()).toBe(false)
    await page.get('.connection-action').trigger('click')
    expect(page.emitted('request-mode')).toEqual([['connections', { name: 'alpha', pid: 10 }]])
  })

  it('does not expose the jump action without connection capability', async () => {
    const processOnlyAgent: Agent = {
      ...fullAgent,
      supported: PROC_SCOPES,
      granted: PROC_SCOPES,
      effective: PROC_SCOPES,
    }
    const processOnlySnapshot: HostSnapshot = {
      ...initialSnapshot,
      scopes: collectedScopes(PROC_SCOPES),
      connections: undefined,
    }
    const page = await render(processOnlySnapshot, processOnlyAgent)

    expect(page.findAll('button').some((item) => item.text() === 'View connections')).toBe(false)
    expect(page.find('select#conn-filter').exists()).toBe(false)
    expect(apiMock.requestSnapshot).toHaveBeenCalledWith('agent-1', PROC_SCOPES)
  })

  it('asks only for the scopes the agent can serve and lists the rest without the env line', async () => {
    const partialAgent: Agent = {
      ...fullAgent,
      supported: [...PROC_SCOPES, ...CONN_SCOPES],
      granted: ['host.process.basic.read'],
      effective: ['host.process.basic.read'],
    }
    const partialSnapshot: HostSnapshot = {
      ts: initialSnapshot.ts,
      request_id: 'partial',
      scopes: [{ scope: 'host.process.basic.read', status: 'collected' }],
      process_total: 1,
      processes: [{ pid: 10, name: 'alpha' }],
    }
    const page = await render(partialSnapshot, partialAgent)

    expect(apiMock.requestSnapshot).toHaveBeenCalledWith('agent-1', ['host.process.basic.read'])
    const denial = page.get('.denial')
    // Every scope that was never asked for is still named…
    expect(denial.text()).toContain('not granted')
    expect(denial.findAll('li')).toHaveLength(7)
    // …but the several-hundred-character policy line is not repeated per row; it
    // lives in the remediation dialog behind "How to fix this".
    expect(denial.text()).not.toContain('NETTACT_AGENT_PERMISSIONS')
    expect(page.text()).toContain('alpha')
  })

  it('never asks the agent when it can serve no snapshot scope at all', async () => {
    const noneAgent: Agent = {
      ...fullAgent,
      supported: [...PROC_SCOPES, ...CONN_SCOPES],
      granted: [],
      effective: [],
    }
    const page = await render(initialSnapshot, noneAgent)

    expect(apiMock.requestSnapshot).not.toHaveBeenCalled()
    expect(apiMock.getSnapshot).not.toHaveBeenCalled()
    // One calm empty state, not eight denial rows.
    expect(page.find('.denial').exists()).toBe(false)
    expect(page.get('.empty').text()).toContain('process / connection read permissions')
  })

  it('lets a newer agent switch win when the older read settles last', async () => {
    // The hazard is ordering, not overlap: whichever api.agent() resolves LAST
    // used to win, so the picker could show agent B while the permissions,
    // empty state and remediation were all derived from agent A.
    const agentA: Agent = { ...fullAgent, id: 'agent-a' }
    const agentB: Agent = {
      ...fullAgent,
      id: 'agent-b',
      supported: [...PROC_SCOPES, ...CONN_SCOPES],
      granted: [],
      effective: [],
    }
    apiMock.agents.mockResolvedValue([agentA, agentB])
    let releaseA: (v: Agent) => void = () => {}
    apiMock.agent
      .mockImplementationOnce(() => new Promise<Agent>((res) => (releaseA = res)))
      .mockResolvedValue(agentB)

    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    const page = mount(Processes, {
      global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    // Switch to B while A's read is still in flight, then let A land late.
    await page.get('select').setValue('agent-b')
    await flushPromises()
    releaseA(agentA)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    // B serves nothing, so the page must show B's empty state — not A's data.
    expect(page.get('.empty').text()).toContain('process / connection read permissions')
    expect(apiMock.requestSnapshot).not.toHaveBeenCalled()
  })

  it('hands the dialog one policy line that grants every missing scope', async () => {
    const noneAgent: Agent = {
      ...fullAgent,
      supported: [...PROC_SCOPES, ...CONN_SCOPES],
      granted: ['probe.icmp'],
      effective: [],
    }
    const page = await render(initialSnapshot, noneAgent)
    await button(page, 'How to fix this').trigger('click')
    await flushPromises()

    // The union of the server's per-permission lines: the base grant plus every
    // scope the page is missing, and no closure worked out in the browser.
    const dialog = document.querySelector('.prd-dialog')
    expect(dialog?.textContent).toContain(
      `NETTACT_AGENT_PERMISSIONS=${['probe.icmp', ...PROC_SCOPES, ...CONN_SCOPES].join(',')}`,
    )
  })

  it('re-reads the policy on refresh so a just-granted scope takes effect', async () => {
    // The operator followed the remediation, edited the policy and restarted the
    // agent. Refresh must pick that up: the record this page loaded still says
    // the agent serves nothing, so refreshing against it would request nothing.
    const before: Agent = {
      ...fullAgent,
      supported: [...PROC_SCOPES, ...CONN_SCOPES],
      granted: [],
      effective: [],
    }
    const after: Agent = { ...before, granted: [...PROC_SCOPES], effective: [...PROC_SCOPES] }
    const page = await render(initialSnapshot, before)
    expect(apiMock.requestSnapshot).not.toHaveBeenCalled()

    apiMock.agent.mockResolvedValue(after)
    const refresh = button(page, 'Refresh snapshot')
    // …and the button has to be reachable in the first place: an agent serving
    // nothing is exactly the state an operator arrives in to fix it.
    expect((refresh.element as HTMLButtonElement).disabled).toBe(false)
    await refresh.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(apiMock.requestSnapshot).toHaveBeenCalledWith(after.id, PROC_SCOPES)
  })

  it('keeps an agent-load failure on screen instead of blanking the page', async () => {
    apiMock.agents.mockResolvedValue([fullAgent])
    apiMock.agent.mockRejectedValue(new Error('agent read failed'))
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    wrapper = mount(Processes, {
      global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(wrapper.get('.err').text()).toContain('agent read failed')
    expect(apiMock.requestSnapshot).not.toHaveBeenCalled()
  })

  it('drops the cached inventory before reloading it', async () => {
    // A stale line can omit grants added since the last load; pasting it would
    // revoke them. On a failed reload the dialog must fall back to the generic
    // instruction rather than keep offering the old line.
    const noneAgent: Agent = {
      ...fullAgent,
      supported: [...PROC_SCOPES, ...CONN_SCOPES],
      granted: ['probe.icmp'],
      effective: [],
    }
    const page = await render(initialSnapshot, noneAgent)
    await button(page, 'How to fix this').trigger('click')
    await flushPromises()
    expect(document.querySelector('.prd-dialog')?.textContent).toContain(
      'NETTACT_AGENT_PERMISSIONS=',
    )

    await page.findComponent(PermissionRemediationDialog).vm.$emit('close')
    await flushPromises()
    apiMock.agentPermissions.mockRejectedValue(new Error('permissions read failed'))
    await button(page, 'How to fix this').trigger('click')
    await flushPromises()

    expect(document.querySelector('.prd-dialog')?.textContent).not.toContain(
      'NETTACT_AGENT_PERMISSIONS=',
    )
  })
})
