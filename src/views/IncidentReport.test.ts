import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

// The report fans out to many api endpoints via loadIncidentReport(); stub them
// so the view's own rendering is what is under test.
const apiMock = vi.hoisted(() => ({
  incident: vi.fn(),
  timeline: vi.fn(),
  incidentSnapshot: vi.fn(),
  incidentTraces: vi.fn(),
  fluctuations: vi.fn(),
  traceReport: vi.fn(),
  targetAvailability: vi.fn(),
}))
// The composable distinguishes a 404 (legitimate absence) from other failures via
// ApiError.status; the mock must export the same class the composable sees.
const ApiErrorMock = vi.hoisted(
  () =>
    class ApiError extends Error {
      status: number
      constructor(status: number, message: string) {
        super(message)
        this.status = status
      }
    },
)
vi.mock('../api', () => ({ api: apiMock, ApiError: ApiErrorMock }))

const serverInfoMock = vi.hoisted(() => ({
  ensureServerInfo: vi.fn(),
  serverInfo: { version: '', update: null as null | { current_version: string } },
}))
vi.mock('../serverInfo', () => serverInfoMock)

// The export rasterizes real DOM with html2canvas/jsPDF, which jsdom cannot do;
// stub the generator so the wiring (button → call with the report element and a
// filename) is what is under test.
const reportPdfMock = vi.hoisted(() => ({
  generateReportPdf: vi.fn().mockResolvedValue(undefined),
  reportFilename: vi.fn((title: string, _date: Date) => `NetTact-${title || 'report'}.pdf`),
}))
vi.mock('../lib/reportPdf', () => reportPdfMock)

import IncidentReport from './IncidentReport.vue'
import { i18n, setLocale } from '../i18n'
import type { FaultSignal } from '../api'

const T0 = '2026-08-01T10:00:00Z'

function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/incidents/:id/report', component: IncidentReport }],
  })
  return router
}

const availabilityMember = (over: Partial<FaultSignal> = {}): FaultSignal => ({
  id: 'm1',
  title: '「Router」ICMP 探测不可达',
  site_id: 'site_default',
  agent_id: 'a1',
  agent_name: 'Home Agent',
  target_id: 't1',
  target_name: 'Router',
  target_addr: '192.168.1.1',
  detector_key: 'availability',
  probe_kind: 'icmp',
  group_id: 'g1',
  group_name: '默认组',
  layer: 'lan',
  severity: 'error',
  state: 'firing',
  fail_threshold: 3,
  recover_threshold: 2,
  metric_kind: 'probe.icmp.loss_pct',
  comparator: 'gte',
  value: 100,
  threshold: 80,
  reason_code: 3,
  reason_detail: 'network is unreachable',
  baseline_p50: 0,
  baseline_p95: 0,
  observed_at: T0,
  confirmed_at: '2026-08-01T10:00:08Z',
  resolved_at: null,
  incident_id: 'inc1',
  currently_abnormal: true,
  rounds: [
    { ts: 1785584400, metric_kind: 'probe.icmp.loss_pct', value: 100, reason_code: 3, reason_detail: '' },
    { ts: 1785584403, metric_kind: 'probe.icmp.loss_pct', value: 100, reason_code: 1, reason_detail: '' },
  ],
  desc_zh: '「Router」ICMP 探测不可达',
  desc_en: 'Router unreachable',
  ...over,
})

const connectivityMember = (over: Partial<FaultSignal> = {}): FaultSignal => ({
  id: 'm2',
  title: 'Agent 离线',
  site_id: 'site_default',
  agent_id: 'a2',
  agent_name: 'Basement Agent',
  target_id: undefined,
  target_name: '',
  target_addr: '',
  detector_key: 'agent_connectivity',
  probe_kind: 'agent_connectivity',
  group_id: 'g1',
  group_name: '默认组',
  layer: 'wan',
  severity: 'warn',
  state: 'firing',
  fail_threshold: 0,
  recover_threshold: 0,
  metric_kind: '',
  comparator: '',
  value: 0,
  threshold: 0,
  reason_code: 0,
  reason_detail: '',
  baseline_p50: 0,
  baseline_p95: 0,
  observed_at: T0,
  confirmed_at: '2026-08-01T10:00:05Z',
  resolved_at: null,
  incident_id: 'inc1',
  currently_abnormal: true,
  rounds: null,
  desc_zh: 'Agent 离线',
  desc_en: 'Agent offline',
  ...over,
})

const incident = {
  id: 'inc1',
  site_id: 'site_default',
  group_id: 'g1',
  group_name: '默认组',
  title: '路由器不可达',
  suspected_layer: 'lan',
  state: 'open',
  severity: 'error',
  summary: '网关探测失败',
  evidence_expired: false,
  scene_count: 1,
  trace_count: 1,
  member_count: 2,
  active_member_count: 1,
  notified_count: 0,
  pending_notify_count: 0,
  opened_at: T0,
  resolved_at: null,
  attribution: 'router',
  attribution_evidence: [
    { kind: 'gateway_down' },
    { kind: 'only_target_failing', count: 1, targets: ['1.1.1.1'] },
  ],
}

// A realistic incident: one availability member with per-round evidence, one
// agent-connectivity member (no target), a trace with hops, a snapshot entry,
// a precursor, and 24h/7d availability for the target.
function seed(extraMembers: Partial<FaultSignal>[] = []) {
  const members = [availabilityMember(), connectivityMember(), ...extraMembers.map((over) => availabilityMember(over))]
  apiMock.incident.mockResolvedValue({ incident, members, abnormal_target_count: 1 })
  apiMock.timeline.mockResolvedValue([
    { ts: T0, kind: 'fault.confirmed', message: 'Router 探测失败', ref: 'm1' },
    { ts: '2026-08-01T10:00:08Z', kind: 'incident.opened', message: '事故已创建', ref: 'inc1' },
  ])
  apiMock.incidentSnapshot.mockResolvedValue({
    incident_id: 'inc1',
    truncated: false,
    created_at: T0,
    scenes: [
      {
        report_id: 'scene_1',
        agent_id: 'a1',
        agent_name: 'Home Agent',
        clock_skew_ms: 120,
        skewed: true,
        truncated: false,
        collected_at: T0,
        received_at: '2026-08-01T10:00:02Z',
        triggers: [
          { kind: 'probe_fault', monitor_id: 't1', config_serial: 3, trigger_streak: 3, first_failed_at: T0 },
        ],
        payload: {
          groups: [{ group: 'network', status: 'collected' }],
          network: {
            default_route: { gateway: '192.168.1.1', interface: 'eth0' },
            dns_servers: ['192.168.1.1'],
            interfaces: [{ name: 'eth0', addrs: ['192.168.1.10/24'], up: true, is_wireless: false }],
          },
          resources: { cpu_percent: 12, memory_used_bytes: 1048576, memory_total_bytes: 8388608 },
          targets: [{ monitor_id: 't1', kind: 'icmp', target: '192.168.1.1', resolved_ips: ['192.168.1.1'] }],
        },
      },
    ],
  })
  apiMock.incidentTraces.mockResolvedValue([
    {
      report_id: 'r1',
      agent_id: 'a1',
      agent_name: 'Home Agent',
      mode: 'icmp',
      dest_host: '1.1.1.1',
      dest_ip: '1.1.1.1',
      status: 'succeeded',
      reached: true,
      reached_ttl: 12,
      requested_at: T0,
      started_at: T0,
      completed_at: '2026-08-01T10:00:30Z',
      deadline_at: T0,
      subject_kind: 'target',
      path_scope: 'direct',
    },
  ])
  apiMock.traceReport.mockResolvedValue({
    report_id: 'r1',
    agent_id: 'a1',
    agent_name: 'Home Agent',
    mode: 'icmp',
    dest_host: '1.1.1.1',
    dest_ip: '1.1.1.1',
    status: 'succeeded',
    reached: true,
    reached_ttl: 12,
    requested_at: T0,
    started_at: T0,
    completed_at: '2026-08-01T10:00:30Z',
    deadline_at: T0,
    subject_kind: 'target',
    path_scope: 'direct',
    hops: [
      { ttl: 1, attempts: [{ attempt: 1, addr: '192.168.1.1', rtt_ms: 2.1, timeout: false }] },
      { ttl: 12, attempts: [{ attempt: 1, addr: '1.1.1.1', rtt_ms: 8.4, timeout: false }] },
    ],
  })
  apiMock.fluctuations.mockResolvedValue({
    items: [
      {
        id: 'f1',
        site_id: 'site_default',
        agent_id: 'a1',
        agent_name: 'Home Agent',
        target_id: 't1',
        target_name: 'Router',
        target_addr: '192.168.1.1',
        probe_kind: 'icmp',
        layer: 'lan',
        fail_rounds: 2,
        fail_threshold: 3,
        metric_kind: 'probe.icmp.loss_pct',
        comparator: 'gte',
        value: 100,
        threshold: 80,
        reason_code: 1,
        reason_detail: '',
        baseline_p50: 0,
        baseline_p95: 0,
        rounds: null,
        started_at: '2026-08-01T09:55:00Z',
        ended_at: '2026-08-01T09:56:00Z',
        concurrent_targets: 0,
        concurrent_fluctuations: 0,
        concurrent_faults: 0,
      },
    ],
    total: 1,
  })
  apiMock.targetAvailability.mockResolvedValue({
    target_id: 't1',
    windows: [
      { window: '24h', total: { monitor_id: 't1', rounds: 100, ok_rounds: 95, ratio: 0.95 }, agents: [] },
      { window: '7d', total: { monitor_id: 't1', rounds: 0, ok_rounds: 0, ratio: 0 }, agents: [] },
    ],
  })
  serverInfoMock.ensureServerInfo.mockResolvedValue(undefined)
  serverInfoMock.serverInfo.version = 'v1.2.0'
}

let router: ReturnType<typeof makeRouter>

beforeEach(() => {
  vi.clearAllMocks()
  setLocale('zh')
  seed()
  router = makeRouter()
  reportPdfMock.generateReportPdf.mockReset().mockResolvedValue(undefined)
  reportPdfMock.reportFilename.mockReset().mockImplementation((title: string, _d: Date) => `NetTact-${title || 'report'}.pdf`)
})

afterEach(() => {
  document.title = 'NetTact'
})

async function mountReport() {
  await router.push('/incidents/inc1/report')
  await router.isReady()
  const wrapper = mount(IncidentReport, {
    global: { plugins: [router, i18n] },
  })
  await flushPromises()
  return wrapper
}

describe('IncidentReport', () => {
  it('renders every report section from the incident record', async () => {
    const wrapper = await mountReport()
    const text = wrapper.text()

    expect(wrapper.get('.report-brand').attributes()).toMatchObject({
      src: '/nettact-logo-horizontal.svg',
      alt: 'NetTact',
      width: '140',
      height: '40',
    })

    // Header: merged localized heading (1 distinct target), attribution
    // sentence, state/group/layer.
    expect(text).toContain('共 1 个受影响目标')
    expect(text).toContain('进行中')
    expect(text).toContain('默认组')
    // Attribution sentence + clue chips (INCIDENT-003).
    expect(text).toContain('网关不可达')
    expect(text).toContain('仅该目标失败')

    // Sections in order.
    expect(text).toContain('影响范围')
    expect(text).toContain('故障证据')
    expect(text).toContain('时间线')
    expect(text).toContain('路径诊断')
    expect(text).toContain('状态快照')
    expect(text).toContain('相关历史')

    // Member evidence: metric, frozen reason (human translation, not the code),
    // the raw machine text, and the per-round table.
    expect(text).toContain('网络不可达')
    expect(text).toContain('network is unreachable')
    expect(text).toContain('确认过程中的逐轮失败原因')

    // Timeline + precursor.
    expect(text).toContain('事故已创建')
    expect(text).toContain('前兆波动')

    // Trace: destination, reached verdict, hop addresses.
    expect(text).toContain('1.1.1.1')
    expect(text).toContain('已到达')
    expect(text).toContain('192.168.1.1')

    // Snapshot per-Agent items.
    expect(text).toContain('Home Agent')
    expect(text).toContain('192.168.1.10/24')

    // Availability: 24h ratio present, 7d has no verdict → No data.
    expect(text).toContain('95%')
    expect(text).toContain('无数据')

    // Footer.
    expect(text).toContain('由 NetTact 生成')
    expect(text).toContain('v1.2.0')

    // Document title set for a meaningful PDF filename.
    expect(document.title).toContain('故障诊断报告')
  })

  it('prints one availability row per target even when two agents observe it', async () => {
    // A second agent fails the SAME target; availability is a target-wide total,
    // so the history table must not duplicate the row.
    seed([{ id: 'm3', agent_id: 'a3', agent_name: 'Office Agent', target_id: 't1' }])
    const wrapper = await mountReport()

    const sections = wrapper.findAll('section.report-section')
    const history = sections[sections.length - 1]
    // 1 header row + 1 target row (t1 deduped), not 2.
    expect(history.findAll('tr')).toHaveLength(2)
  })

  // A degradation's threshold is a number the product derived from the target's
  // own history. Printed the usual way it becomes "(gte_baseline 67.5)" — an
  // internal token in an exported PDF, next to a threshold nobody chose.
  it('states a degradation against its baseline instead of a raw comparator', async () => {
    apiMock.incident.mockResolvedValue({
      incident,
      members: [
        availabilityMember({
          id: 'm_deg',
          detector_key: 'latency_degradation',
          severity: 'info',
          metric_kind: 'probe.icmp.rtt_ms',
          comparator: 'gte_baseline',
          value: 180,
          threshold: 67.5,
          baseline_p50: 40,
          baseline_p95: 45,
          reason_code: 0,
          reason_detail: '',
          rounds: null,
        }),
      ],
      abnormal_target_count: 1,
    })
    const text = (await mountReport()).text()

    expect(text).not.toContain('gte_baseline')
    expect(text).toContain('与平时对比')
    expect(text).toContain('平时同时段约 40')
  })

  it('says when the precursor page was capped by the server', async () => {
    apiMock.fluctuations.mockResolvedValue({
      items: [
        {
          id: 'f1',
          site_id: 'site_default',
          agent_id: 'a1',
          agent_name: 'Home Agent',
          target_id: 't1',
          target_name: 'Router',
          target_addr: '192.168.1.1',
          probe_kind: 'icmp',
          layer: 'lan',
          fail_rounds: 2,
          fail_threshold: 3,
          metric_kind: 'probe.icmp.loss_pct',
          comparator: 'gte',
          value: 100,
          threshold: 80,
          reason_code: 1,
          reason_detail: '',
          baseline_p50: 0,
          baseline_p95: 0,
          rounds: null,
          started_at: '2026-08-01T09:55:00Z',
          ended_at: '2026-08-01T09:56:00Z',
          concurrent_targets: 0,
          concurrent_fluctuations: 0,
          concurrent_faults: 0,
        },
      ],
      total: 5000,
    })
    const wrapper = await mountReport()

    expect(wrapper.text()).toContain('仅显示前 1 条前兆（共 5000 条）')
  })

  it('says a section could not be read instead of claiming it is empty', async () => {
    apiMock.incidentSnapshot.mockRejectedValue(new Error('500 snapshot service down'))
    const wrapper = await mountReport()
    const text = wrapper.text()

    // The snapshot section carries the failure note, not the "no snapshot" hint.
    expect(text).toContain('该部分读取失败，报告可能不完整')
    expect(text).not.toContain('暂无状态快照')
    // The rest of the report still renders.
    expect(text).toContain('影响范围')
    expect(text).toContain('故障证据')
  })

  // An incident with no claimed scene is the ordinary state during an outage —
  // the Agent collects locally and delivers on reconnect — so the report has to
  // say that rather than imply nothing was found.
  it('explains an absent scene instead of reading as empty', async () => {
    apiMock.incidentSnapshot.mockResolvedValue({
      incident_id: 'inc1',
      truncated: false,
      created_at: T0,
      scenes: [],
    })
    const wrapper = await mountReport()

    expect(wrapper.text()).toContain('本次故障暂无现场')
    // The copy must also say a scene is not guaranteed, so an operator does not
    // wait for evidence a host fault or a lite Agent will never produce.
    expect(wrapper.text()).toContain('并非每种故障都有现场')
  })

  it('keeps recovery rows from borrowing the failure sentence', async () => {
    // fault.confirmed rows are re-derived from the member description, but a
    // fault.resolved row referencing the same member must keep its own wording —
    // substituting the failure sentence would read "已恢复 | 探测不可达".
    apiMock.timeline.mockResolvedValue([
      { ts: T0, kind: 'fault.confirmed', message: '「Router」ICMP 探测不可达', ref: 'm1' },
      { ts: '2026-08-01T10:30:00Z', kind: 'fault.resolved', message: '「Router」探测恢复', ref: 'm1' },
    ])
    const wrapper = await mountReport()

    expect(wrapper.text()).toContain('「Router」探测恢复')
    // The confirmation row IS localized to the member statement.
    expect(wrapper.text()).toContain('「Router」ICMP 探测不可达')
  })

  it('keeps the original port in a TCP-to-ICMP fallback note', async () => {
    const fallbackTrace = {
      report_id: 'r1',
      agent_id: 'a1',
      agent_name: 'Home Agent',
      mode: 'icmp',
      dest_host: '1.1.1.1',
      dest_ip: '1.1.1.1',
      status: 'succeeded',
      reached: true,
      reached_ttl: 12,
      requested_at: T0,
      started_at: T0,
      completed_at: '2026-08-01T10:00:30Z',
      deadline_at: T0,
      subject_kind: 'target',
      path_scope: 'direct',
      port: 443,
      fallback_from: 'tcp',
      fallback_reason: 'raw_socket_unavailable',
    }
    apiMock.incidentTraces.mockResolvedValue([fallbackTrace])
    apiMock.traceReport.mockResolvedValue({ ...fallbackTrace, hops: [] })
    const wrapper = await mountReport()

    expect(wrapper.text()).toContain('TCP:443 → ICMP')
  })

  it('marks an availability row as read failed rather than no data', async () => {
    apiMock.targetAvailability.mockRejectedValue(new Error('boom'))
    const wrapper = await mountReport()
    const sections = wrapper.findAll('section.report-section')
    const history = sections[sections.length - 1]

    // Both cells of the failed target say "read failed", not "no data".
    const cells = history.findAll('tbody td.mono').map((td) => td.text())
    expect(cells).toEqual(['读取失败', '读取失败'])
    expect(history.text()).toContain('该部分读取失败')
  })

  it('never rounds an imperfect availability ratio up to 100%', async () => {
    apiMock.targetAvailability.mockResolvedValue({
      target_id: 't1',
      windows: [
        { window: '24h', total: { monitor_id: 't1', rounds: 10000, ok_rounds: 9999, ratio: 0.9999 }, agents: [] },
        { window: '7d', total: { monitor_id: 't1', rounds: 0, ok_rounds: 0, ratio: 0 }, agents: [] },
      ],
    })
    const wrapper = await mountReport()
    const sections = wrapper.findAll('section.report-section')
    const history = sections[sections.length - 1]
    const cells = history.findAll('tbody td.mono').map((td) => td.text())

    expect(cells[0]).toBe('99.99%')
  })

  it('suppresses success-flag metrics on failed rounds', async () => {
    apiMock.incident.mockResolvedValue({
      incident,
      members: [
        {
          ...availabilityMember({}),
          rounds: [{ ts: 1785584400, metric_kind: 'probe.tcp.ok', value: 0, reason_code: 2, reason_detail: '' }],
        },
      ],
      abnormal_target_count: 1,
    })
    const wrapper = await mountReport()
    const text = wrapper.text()

    // The failure reason is the story; the affirmative success label must not
    // render as "连接成功 0".
    expect(text).toContain('请求被拒绝')
    expect(text).not.toContain('连接成功')
  })

  it('downloads a PDF directly instead of opening a print dialog', async () => {
    const wrapper = await mountReport()
    const btn = wrapper.find('.toolbar .btn.primary')

    // While the (stubbed) generator is in flight the button shows progress and
    // is disabled; a second click is ignored.
    let release!: () => void
    reportPdfMock.generateReportPdf.mockReturnValue(new Promise<void>((r) => (release = r)))
    await btn.trigger('click')
    expect(btn.text()).toContain('生成 PDF…')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(reportPdfMock.generateReportPdf).toHaveBeenCalledTimes(1)

    const [el, name] = reportPdfMock.generateReportPdf.mock.calls[0]
    expect(name).toMatch(/\.pdf$/)
    expect((el as HTMLElement).classList.contains('report')).toBe(true)

    release()
    await flushPromises()
    expect(btn.text()).toContain('导出 PDF')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('shows an error state instead of the report when the incident cannot be read', async () => {
    apiMock.incident.mockRejectedValue(new Error('404 incident not found'))
    const wrapper = await mountReport()

    expect(wrapper.text()).toContain('无法生成诊断报告')
    expect(wrapper.text()).toContain('404 incident not found')
    expect(wrapper.text()).not.toContain('影响范围')
  })
})
