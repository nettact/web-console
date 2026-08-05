import { beforeEach, describe, expect, it, vi } from 'vitest'

// loadIncidentReport() fans out to many api endpoints and the shared server-info
// store; stub both so the composable's own assembly logic is what is under test.
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

import type { FaultSignal, IncidentDetail, SnapshotView, TraceReportView } from '../api'
import { loadIncidentReport } from './useIncidentReport'

const member = (over: Partial<FaultSignal>): FaultSignal => ({
  id: 'm1',
  title: '「Router」不可达',
  site_id: 'site1',
  agent_id: 'a1',
  agent_name: 'Home',
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
  reason_detail: '',
  observed_at: '2026-08-01T10:00:00Z',
  confirmed_at: '2026-08-01T10:00:10Z',
  resolved_at: null,
  incident_id: 'inc1',
  currently_abnormal: true,
  rounds: null,
  desc_zh: '「Router」不可达',
  desc_en: 'Router unreachable',
  ...over,
})

const detail = (members: FaultSignal[]): IncidentDetail => ({
  incident: {
    id: 'inc1',
    site_id: 'site1',
    group_id: 'g1',
    group_name: '默认组',
    title: '路由器不可达',
    suspected_layer: 'lan',
    state: 'open',
    severity: 'error',
    summary: '…',
    evidence_expired: false,
    snapshot_status: 'complete',
    trace_count: 1,
    member_count: members.length,
    active_member_count: members.length,
    notified_count: 0,
    pending_notify_count: 0,
    opened_at: '2026-08-01T10:00:00Z',
    resolved_at: null,
  },
  members,
  abnormal_target_count: 1,
})

beforeEach(() => {
  vi.clearAllMocks()
  serverInfoMock.ensureServerInfo.mockResolvedValue(undefined)
  serverInfoMock.serverInfo.version = ''
  serverInfoMock.serverInfo.update = null
})

describe('loadIncidentReport', () => {
  it('assembles every section and keys availability by target', async () => {
    apiMock.incident.mockResolvedValue(detail([member({})]))
    apiMock.timeline.mockResolvedValue([{ ts: '2026-08-01T10:00:00Z', kind: 'fault.confirmed', message: 'x' }])
    apiMock.incidentSnapshot.mockResolvedValue({ incident_id: 'inc1', status: 'complete' } as SnapshotView)
    apiMock.incidentTraces.mockResolvedValue([{ report_id: 'r1', agent_id: 'a1' }])
    apiMock.fluctuations.mockResolvedValue({ items: [{ id: 'f1' }], total: 1 })
    apiMock.traceReport.mockResolvedValue({ report_id: 'r1', hops: [] } as unknown as TraceReportView)
    apiMock.targetAvailability.mockResolvedValue({ target_id: 't1', windows: [] })
    serverInfoMock.serverInfo.version = 'v1.2.0'

    const data = await loadIncidentReport('inc1')

    expect(data.detail.incident.id).toBe('inc1')
    expect(data.timeline).toHaveLength(1)
    expect(data.snapshot?.status).toBe('complete')
    expect(data.traces).toHaveLength(1)
    expect(data.precursors).toHaveLength(1)
    expect(data.precursorTotal).toBe(1)
    expect(data.availability.get('t1')).toEqual({ target_id: 't1', windows: [] })
    expect(data.availabilityFailedTargets).toEqual([])
    expect(data.version).toBe('v1.2.0')
    expect(data.failed).toEqual({ snapshot: false, traces: false, precursors: false, availability: false })
    expect(apiMock.traceReport).toHaveBeenCalledWith('r1')
    expect(apiMock.targetAvailability).toHaveBeenCalledWith('t1', ['24h', '7d'])
  })

  it('reads the running version from the shared server-info store', async () => {
    apiMock.incident.mockResolvedValue(detail([member({})]))
    apiMock.timeline.mockResolvedValue([])
    apiMock.incidentSnapshot.mockResolvedValue(null)
    apiMock.incidentTraces.mockResolvedValue([])
    apiMock.fluctuations.mockResolvedValue({ items: [], total: 0 })
    apiMock.targetAvailability.mockResolvedValue(null)
    serverInfoMock.serverInfo.version = 'v9.9.9'

    const data = await loadIncidentReport('inc1')

    expect(data.version).toBe('v9.9.9')
  })

  it('marks a listed trace whose detail is gone as an incomplete section', async () => {
    apiMock.incident.mockResolvedValue(detail([member({})]))
    apiMock.timeline.mockResolvedValue([])
    apiMock.incidentSnapshot.mockResolvedValue(null)
    apiMock.incidentTraces.mockResolvedValue([{ report_id: 'r1' }, { report_id: 'r2' }])
    apiMock.fluctuations.mockResolvedValue({ items: [], total: 0 })
    apiMock.traceReport.mockImplementation((id: string) =>
      id === 'r1'
        ? Promise.resolve({ report_id: 'r1', hops: [] } as unknown as TraceReportView)
        : Promise.reject(new ApiErrorMock(404, 'cleaned up')),
    )
    apiMock.targetAvailability.mockResolvedValue(null)

    const data = await loadIncidentReport('inc1')

    // The listing proved the incident had diagnostics; a detail that 404s now
    // is unavailable evidence, not "never existed", so the section is flagged.
    expect(data.traces.map((r) => r.report_id)).toEqual(['r1'])
    expect(data.failed.traces).toBe(true)
  })

  it('keeps a deleted target as an absence but flags a real availability failure', async () => {
    apiMock.incident.mockResolvedValue(
      detail([member({ id: 'm1', target_id: 't1' }), member({ id: 'm2', target_id: 't2' })]),
    )
    apiMock.timeline.mockResolvedValue([])
    apiMock.incidentSnapshot.mockResolvedValue(null)
    apiMock.incidentTraces.mockResolvedValue([])
    apiMock.fluctuations.mockResolvedValue({ items: [], total: 0 })
    apiMock.targetAvailability
      .mockRejectedValueOnce(new ApiErrorMock(404, 'target gone'))
      .mockRejectedValueOnce(new Error('boom'))

    const data = await loadIncidentReport('inc1')

    // The 404 is an honest absence; the second target's read really failed and
    // is recorded by id so the view can name the row.
    expect(data.availability.get('t1')).toBeNull()
    expect(data.availability.has('t2')).toBe(false)
    expect(data.availabilityFailedTargets).toEqual(['t2'])
    expect(data.failed.availability).toBe(true)
  })

  it('degrades the context sections to empty and flags which reads failed', async () => {
    // One member has no target_id (an agent-connectivity fault); the other's
    // availability read fails. Neither may sink the report, but each failing
    // read is flagged so the view can say "could not read" rather than "none
    // existed". Only the incident and its timeline are core reads.
    apiMock.incident.mockResolvedValue(
      detail([member({ id: 'm1', target_id: 't1' }), member({ id: 'm2', target_id: undefined, detector_key: 'agent_connectivity' })]),
    )
    apiMock.timeline.mockResolvedValue([])
    apiMock.incidentSnapshot.mockRejectedValue(new Error('500'))
    apiMock.incidentTraces.mockRejectedValue(new Error('boom'))
    apiMock.fluctuations.mockRejectedValue(new Error('boom'))
    apiMock.targetAvailability.mockRejectedValue(new Error('boom'))
    serverInfoMock.serverInfo.update = null

    const data = await loadIncidentReport('inc1')

    expect(data.timeline).toEqual([])
    expect(data.snapshot).toBeNull()
    expect(data.traces).toEqual([])
    expect(data.precursors).toEqual([])
    expect(data.precursorTotal).toBe(0)
    expect(data.availability.has('t1')).toBe(false)
    expect(data.availability.size).toBe(0)
    expect(data.availabilityFailedTargets).toEqual(['t1'])
    expect(data.version).toBe('')
    expect(data.failed).toEqual({ snapshot: true, traces: true, precursors: true, availability: true })
  })

  it('propagates a 404 on the incident itself so the view can say what failed', async () => {
    apiMock.incident.mockRejectedValue(new Error('404 incident not found'))

    await expect(loadIncidentReport('missing')).rejects.toThrow('404 incident not found')
  })
})
