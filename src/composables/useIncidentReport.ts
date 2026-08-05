// Assembles every datum a self-contained incident report needs (INCIDENT-004):
// the incident with its member fault signals, the timeline, the immutable
// snapshot, the shared traceroute reports, the claimed precursor fluctuations,
// per-target availability history and the server version for the footer.
//
// Nothing here is report-only — every field is an existing API response, and the
// incident detail drawer already reads most of them — but the report consumes
// them all at once and has no polling, so they are bundled into one load.
//
// Degradation rule: the incident and its timeline are the record itself, so a
// read failure propagates and fails the report. The context collections (the
// snapshot, traces, precursors, availability) degrade instead of sinking the
// report — but a FAILED read is kept apart from a legitimately empty response.
// A fault may have no snapshot; a snapshot read that errored is not the same
// thing, and an evidence document must not claim an absence it did not observe.
// The view renders each failed section with a "could not read" note rather than
// the "none existed" empty-state wording.
import { api, ApiError, type Fluctuation, type IncidentDetail, type SnapshotView, type TargetAvailability, type TimelineEntry, type TraceReportView } from '../api'
import { ensureServerInfo, serverInfo } from '../serverInfo'

// Which context-section reads failed. False does not mean "present" — it means
// "read did not fail", so a null snapshot with failed.snapshot=false is the
// honest "there is no snapshot" state.
export interface ReportSectionFailures {
  snapshot: boolean
  traces: boolean
  precursors: boolean
  availability: boolean
}

export interface IncidentReportData {
  detail: IncidentDetail
  timeline: TimelineEntry[]
  snapshot: SnapshotView | null
  traces: TraceReportView[]
  precursors: Fluctuation[]
  precursorTotal: number
  // Per-target 24h/7d availability, keyed by target id. null means the target no
  // longer resolves or its window held no verdict; a member fault without a
  // target_id (agent-connectivity) is simply absent from the map. A target whose
  // READ failed is absent here and listed in availabilityFailedTargets instead,
  // so the view can say "read failed" for that row rather than "no data".
  availability: Map<string, TargetAvailability | null>
  availabilityFailedTargets: string[]
  version: string
  failed: ReportSectionFailures
}

// A 404 is a legitimate "nothing here" (a deleted target, a trace report cleaned
// up between listing and reading); every other status is a real read failure.
const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404

export async function loadIncidentReport(id: string): Promise<IncidentReportData> {
  const failed: ReportSectionFailures = {
    snapshot: false,
    traces: false,
    precursors: false,
    availability: false,
  }

  const [detail, timeline, snapshot, sums, pre] = await Promise.all([
    api.incident(id),
    api.timeline(id),
    api.incidentSnapshot(id).catch(() => {
      failed.snapshot = true
      return null
    }),
    api.incidentTraces(id).catch(() => {
      failed.traces = true
      return []
    }),
    api.fluctuations({ incident: id, limit: 500 }).catch(() => {
      failed.precursors = true
      return null
    }),
    // ensureServerInfo never rejects; after it resolves the shared store holds
    // the update block (or null when this install doesn't check for updates).
    ensureServerInfo(),
  ])

  // The full hop detail is read per report id. The listing already proved this
  // incident HAD path diagnostics, so a detail that cannot be read now (cleaned
  // up by retention, or a transient error) marks the section incomplete rather
  // than letting the view claim no diagnostics ever existed.
  const reports = await Promise.all(
    sums.map((s) =>
      api.traceReport(s.report_id).catch(() => {
        failed.traces = true
        return null
      }),
    ),
  )
  const traces = reports.filter((r): r is TraceReportView => !!r)

  const targetIds = [...new Set(detail.members.map((m) => m.target_id).filter((t): t is string => !!t))]
  const availability = new Map<string, TargetAvailability | null>()
  const availabilityFailedTargets: string[] = []
  const availResults = await Promise.all(
    targetIds.map((tid) =>
      api.targetAvailability(tid, ['24h', '7d']).catch((e) => {
        if (!isNotFound(e)) {
          failed.availability = true
          availabilityFailedTargets.push(tid)
          return undefined
        }
        return null
      }),
    ),
  )
  targetIds.forEach((tid, i) => {
    const v = availResults[i]
    if (v !== undefined) availability.set(tid, v)
  })

  return {
    detail,
    timeline,
    snapshot,
    traces,
    precursors: pre?.items ?? [],
    precursorTotal: pre?.total ?? 0,
    availability,
    availabilityFailedTargets,
    version: serverInfo.version,
    failed,
  }
}
