// Thin fetch-based API client. Session cookie is sent via credentials:'include'.
// A 401 is surfaced as AuthError so the router guard can redirect to /login.

export interface User {
  id: string
  username: string
}
export interface ServerInfo {
  os: string
  native_notify: boolean
}
export interface Quota {
  used: number
  max: number
}
export interface Site {
  id: string
  name: string
  created_at: string
}
export interface Agent {
  id: string
  site_id: string
  display_name: string
  hostname: string
  platform: string
  agent_version: string
  status: string
  // Local permission policy. `supported` is everything the agent build can do on
  // its platform; `granted` is what the operator's policy allows; `effective` is
  // the usable intersection. `policy_source` says where the grant came from and
  // `policy_hash` fingerprints it for issue correlation.
  supported: string[]
  granted: string[]
  effective: string[]
  policy_source: string // default | environment | desktop_full_access
  policy_hash: string
  last_seen_at: string | null
  created_at: string
}

// One requested snapshot scope and how it resolved. `denied` = permission not
// granted, `unsupported` = platform/build can't collect it, `failed` = collection
// errored, `collected` = data present.
export interface SnapshotScopeResult {
  scope: string
  status: 'collected' | 'denied' | 'unsupported' | 'failed'
  reason?: string
}
// Remediation guidance attached to a denial or a permission issue.
export interface Remediation {
  reason: string
  permissions_env?: string
  matched_selector?: string
}
// Live host snapshot (ephemeral process / connection lists — never stored).
// Optional fields are absent when the corresponding scope was not granted.
export interface ProcessInfo {
  pid: number
  name: string
  status?: string
  user?: string
  cpu_pct?: number
  rss_bytes?: number
  virt_bytes?: number
  run_time_seconds?: number
  disk_read_bytes?: number
  disk_write_bytes?: number
}
export interface ConnectionInfo {
  proto: string
  state?: string
  local_addr?: string
  remote_addr?: string
  pid?: number
  process_name?: string
}
export interface HostSnapshot {
  ts: string
  request_id: string
  scopes: SnapshotScopeResult[]
  process_total?: number
  processes?: ProcessInfo[]
  connections?: ConnectionInfo[]
}
// POST /agents/{id}/snapshot response. Either an inline denial (request_id null,
// no requested scope was effective) or an accepted request with a precheck.
export interface SnapshotRequestResult {
  request_id: string | null
  scopes?: SnapshotScopeResult[] // inline-denial breakdown
  precheck?: SnapshotScopeResult[] // accepted request per-scope precheck
  remediation?: Remediation
}

// A monitoring/permission issue surfaced in the notification center. Full state is
// pushed over SSE; the badge count is server-authoritative (`unread_count`).
export interface Issue {
  id: string
  site_id: string
  agent_id: string
  agent_name: string
  category: string
  ref_id: string
  monitor_name: string
  reason: string
  missing_permissions: string[]
  matched_selector: string
  policy_hash: string
  state: 'active' | 'resolved'
  read: boolean
  count: number
  first_seen_at: string
  last_seen_at: string
  resolved_at: string | null
  remediation?: Remediation
}
export interface IssuesResponse {
  items: Issue[]
  unread_count: number
}

// Per-agent status of one monitor: whether it is actually collecting, or blocked
// by permission / target selector / lack of platform support. Retained only for
// the per-Agent execution-capability endpoint used by agent-detail views; current
// target health comes exclusively from the authoritative site batch below.
export interface MonitorStatusRow {
  agent_id: string
  agent_name?: string
  monitor_id: string
  monitor_name?: string
  kind?: string
  target?: string
  status: 'active' | 'permission_blocked' | 'target_blocked' | 'unsupported'
  missing_permissions: string[]
  matched_selector?: string
  reason?: string
  policy_hash?: string
  config_version: number
  updated_at: string
}

// ---- Authoritative target status (STATUS-001) ----
// One server-generated current status per target, aggregated read-time from
// configuration, execution eligibility, Agent liveness, fresh probe results,
// current rule-condition satisfaction, and firing alert/incident links. These
// are the ONLY source of current target health in the console — the browser
// never re-infers up/down from metric samples.

// Whether a target×Agent pair is actually executing, or why it is not.
export type ExecutionState =
  | 'disabled'
  | 'unassigned'
  | 'pending'
  | 'collecting'
  | 'permission_blocked'
  | 'target_blocked'
  | 'unsupported'
  | 'agent_offline'
// The freshness/result verdict of the latest current-generation probe sample.
export type ProbeState = 'no_data' | 'healthy' | 'failed' | 'stale' | 'not_applicable'
// Whether any current rule condition is breaching / firing for the pair.
export type RuleState = 'normal' | 'breaching' | 'alerting'
// The target-level rollup shown as the headline state (display priority order).
export type DisplayState =
  | 'disabled'
  | 'unassigned'
  | 'alerting'
  | 'breaching'
  | 'partial_failure'
  | 'probe_failed'
  | 'blocked'
  | 'agent_offline'
  | 'pending'
  | 'stale'
  | 'no_data'
  | 'healthy'
// Stable per-agent reason summary (localized in the frontend only).
export type ReasonCode =
  | 'target_disabled'
  | 'no_applicable_agents'
  | 'agent_offline'
  | 'permission_blocked'
  | 'target_blocked'
  | 'unsupported'
  | 'awaiting_status_report'
  | 'alert_firing'
  | 'rule_breaching'
  | 'probe_failed'
  | 'probe_stale'
  | 'probe_no_data'
  | 'not_applicable'
  | 'ok'
export type WorstSeverity = 'info' | 'warn' | 'error' | 'critical'

// One currently-satisfied rule condition on a target×Agent pair. The display
// label is derived by the frontend from metric_kind + comparator; the server
// never invents display text. alert_id/incident_id are present only when the
// condition's rule has a firing alert (rule_state = alerting).
export interface ActiveCondition {
  condition_id: string
  rule_id: string
  rule_name: string
  severity: string
  metric_kind: string
  comparator: string // gt | gte | lt | lte | eq
  threshold: number
  last_value?: number
  unit?: string
  first_breach_at?: string
  alert_id?: string
  incident_id?: string
}
// One target's status as seen from one applicable Agent. The three dimensions are
// independent: a pair may be execution_state=pending with probe_state=no_data.
export interface TargetAgentStatusRow {
  agent_id: string
  agent_name: string
  agent_online: boolean
  execution_state: ExecutionState
  probe_state: ProbeState
  rule_state: RuleState
  reason_code: ReasonCode
  // Per-agent freshness window (reported effective schedule when confirmed, else
  // the desired-config fallback); omitted for host targets.
  stale_after_seconds?: number
  // Present iff execution_state = pending.
  pending_since?: string
  missing_permissions: string[]
  matched_selector: string
  block_reason: string
  // Latest current-generation sample facts (omitted when none exists).
  last_value?: number
  last_metric_kind?: string
  last_unit?: string
  last_observed_at?: string
  active_conditions: ActiveCondition[]
}
// One target's aggregated current status across every applicable Agent.
export interface TargetStatusRow {
  target_id: string
  group_id: string
  name: string
  kind: string
  target: string
  enabled: boolean
  display_state: DisplayState
  applicable_agents: number
  affected_agents: number
  // Present only for alerting/breaching targets.
  worst_severity?: WorstSeverity
  last_observed_at?: string
  active_condition_count: number
  rule_ids: string[]
  alert_ids: string[]
  incident_ids: string[]
  agents: TargetAgentStatusRow[]
}
// GET /sites/{id}/target-statuses: one deterministic batch for the whole site.
export interface SiteTargetStatuses {
  generated_at: string
  site_id: string
  targets: TargetStatusRow[]
}

// A warning returned by a set-targets save: a saved monitor that some agents in
// scope cannot run (missing permission or unsupported). blocked_agents and
// capable_agent_list identify each agent independently so the UI can name capable
// vs blocked agents (acceptance criterion 8), not just show aggregate counts.
export interface SaveWarningAgent {
  agent_id: string
  agent_name: string
  status: 'active' | 'permission_blocked' | 'unsupported'
  missing_permissions: string[]
}
export interface SaveWarning {
  monitor_id: string
  monitor_name: string
  status: 'permission_blocked' | 'unsupported'
  affected_agents: number
  capable_agents: number
  missing_permissions: string[]
  blocked_agents: SaveWarningAgent[]
  capable_agent_list: SaveWarningAgent[]
}
export interface SaveTargetsResult {
  ok: true
  warnings: SaveWarning[]
}
export interface Sample {
  ts: string
  kind: string
  target: string
  layer: string
  value: number
  unit: string
  // The user-created monitor that produced this sample; absent for system
  // series (host.*, iface.up, agent.*).
  monitor_id?: string
}
export interface ProbeParams {
  interval_seconds?: number
  timeout_ms?: number
  // icmp / ping
  packet_size?: number
  retries?: number
  packet_count?: number
  global_timeout_ms?: number
  // dns
  record_type?: string
  resolver_server?: string
  resolver_port?: number
  resolver_protocol?: string
  // http
  method?: string
  expected_status?: number
  accepted_statuses?: string
  keyword?: string
  keyword_invert?: boolean
  headers?: Record<string, string>
  body?: string
  max_redirects?: number
  ignore_tls?: boolean
  max_response_bytes?: number
  // tcp
  port?: number
  tls?: boolean
  // nat (STUN behavior discovery)
  nat_transport?: string
  stun_server2?: string
  // gateway
  interface?: string
}
// A monitoring target. It belongs to exactly one monitor group (group_id), which
// owns the Agent execution scope and incident-merge policy shared by all of the
// group's targets. Targets no longer carry their own Agent scope.
export interface ProbeTarget {
  id?: string
  group_id: string
  kind: string
  name?: string
  target: string
  params?: ProbeParams
  enabled: boolean
}
// A monitor group: a site-scoped, static owner of targets plus the shared Agent
// execution scope (all_agents, or the union of referenced agent groups) and the
// incident-merge policy. Every site has one undeletable default group.
export interface MonitorGroup {
  id: string
  site_id: string
  name: string
  is_default: boolean
  merge_enabled: boolean
  all_agents: boolean
  agent_group_ids: string[]
}
// Create/update payload for a monitor group.
export interface MonitorGroupInput {
  name: string
  merge_enabled: boolean
  all_agents: boolean
  agent_group_ids: string[]
}
// A named set of agents used to scope monitor groups. An agent may belong to
// several groups; a group scoped to an agent group reaches all its members.
export interface AgentGroup {
  id: string
  site_id: string
  name: string
  agent_ids: string[]
  created_at: string
}
export interface EnrollmentToken {
  site_id: string
  note: string
  expires_at: string
  used_at: string | null
}
export interface Device {
  mac: string
  ip: string
  hostname: string
  vendor: string
  first_seen: string | null
  last_seen: string | null
}
// ---- Incidents (INCIDENT-001), immutable snapshots (INCIDENT-002) and shared
// traceroute reports (DIAG-001) ----

// One incident: a group-aware, stable fault lifecycle. `state` is 'open' |
// 'resolved'; `resolve_reason` distinguishes a genuine recovery ('recovered')
// from a configuration-driven termination ('configuration_changed'). Member
// counts are live; `snapshot_status` and `trace_count` summarize its evidence.
export interface Incident {
  id: string
  site_id: string
  group_id: string
  group_name: string
  title: string
  suspected_layer: string
  state: 'open' | 'resolved'
  severity: string
  summary: string
  resolve_reason?: string
  evidence_expired: boolean
  snapshot_status: string
  trace_count: number
  member_count: number
  active_member_count: number
  opened_at: string
  resolved_at: string | null
}
// One immutable, frozen condition that contributed to a firing alert.
export interface AlertEvidence {
  id: string
  condition_id: string
  target_id: string
  target_name: string
  target_addr: string
  probe_kind: string
  metric_kind: string
  comparator: string // gt | gte | lt | lte | eq
  threshold: number
  value: number
  observed_at: string
  // Read-time overlay (STATUS-001): whether this evidence's condition is STILL
  // currently satisfied on a firing alert. False ⇒ recovered historical evidence.
  currently_abnormal: boolean
}
// An alert instance: one firing of a group rule on one Agent, keyed (rule,
// agent), carrying the frozen evidence of every contributing condition. The
// active-alerts endpoint additionally renders a bilingual fault description.
export interface Alert {
  id: string
  rule_id: string
  rule_name: string
  group_id: string
  group_name: string
  agent_id: string
  agent_host: string
  site_id: string
  layer: string
  severity: string
  state: 'firing' | 'resolved'
  resolve_reason?: string // recovered | configuration_changed
  incident_id?: string
  started_at: string
  resolved_at: string | null
  evidence: AlertEvidence[]
  // Present only on the active-alerts list (/alerts): server-rendered fault text.
  desc_zh?: string
  desc_en?: string
}
export interface TimelineEntry {
  ts: string
  kind: string
  message: string
  // Entity the entry points at: an alert id, incident id or trace report id.
  ref?: string
}
// GET /incidents/{id}: one incident with its member alert instances (evidence).
// `abnormal_target_count` is computed read-time from CURRENT condition state — the
// number of distinct targets still abnormal on this incident's firing alerts — and
// is deliberately decoupled from the immutable evidence count.
export interface IncidentDetail {
  incident: Incident
  members: Alert[]
  abnormal_target_count: number
}
export interface IncidentPage {
  items: Incident[]
  total: number
  page: number
  page_size: number
  summary: IncidentSummary
}
export interface IncidentSummary {
  open: number
  opened_24h: number
  resolved_24h: number
  top_layer: string
}

// Snapshot lifecycle status (shared by the snapshot and each per-Agent entry).
export type SnapshotStatus = 'collecting' | 'complete' | 'partial' | 'failed'
// Per-field-group collection outcome (allowlisted groups only).
export type FieldGroupStatus = 'collected' | 'denied' | 'unsupported' | 'failed'

// GET /incidents/{id}/snapshot: the one immutable snapshot — the frozen server
// base plus every per-Agent scene entry with its collection status.
export interface SnapshotView {
  incident_id: string
  status: SnapshotStatus
  base: SnapshotBase | null
  total_bytes: number
  truncated: boolean
  deadline_at: string
  created_at: string
  entries: SnapshotEntry[]
}
export interface SnapshotEntry {
  agent_id: string
  agent_name: string
  status: SnapshotStatus
  reason?: string
  clock_skew_ms: number
  skewed: boolean
  payload?: SnapshotEntryPayload | null
  requested_at: string
  received_at: string | null
}
// Server-authored base, frozen once at incident-open time.
export interface SnapshotBase {
  incident_id: string
  site_id: string
  group: { id: string; name: string }
  severity: string
  suspected_layer?: string
  triggered_at: string
  received_at: string
  members: SnapshotBaseMember[]
  agents: SnapshotBaseAgent[]
  targets: SnapshotBaseTarget[]
}
export interface SnapshotBaseMember {
  alert_id: string
  rule_id: string
  rule_name: string
  agent_id: string
  agent_name: string
  severity: string
  layer?: string
  started_at: string
  evidence: SnapshotBaseEvidence[]
}
export interface SnapshotBaseEvidence {
  condition_id: string
  target_id: string
  target_name?: string
  target_addr?: string
  probe_kind?: string
  metric_kind: string
  comparator: string
  threshold: number
  value: number
  observed_at: string
  recent_samples?: { ts: string; value: number }[]
}
export interface SnapshotBaseAgent {
  agent_id: string
  name?: string
  hostname?: string
  platform?: string
  agent_version?: string
}
export interface SnapshotBaseTarget {
  monitor_id: string
  kind?: string
  target?: string
  port?: number
}
// Per-Agent allowlisted scene payload. Only these typed groups are ever present
// — never process lists, user names, file paths, credentials or request bodies.
export interface SnapshotEntryPayload {
  groups: SnapshotGroupResult[]
  network?: SnapshotNetwork
  agent?: SnapshotAgentInfo
  resources?: SnapshotResources
  targets?: SnapshotTargetResult[]
}
export interface SnapshotGroupResult {
  group: string // network | agent | resources | targets
  status: FieldGroupStatus
  reason?: string
  collected_at?: string
}
export interface SnapshotNetwork {
  interfaces?: SnapshotInterface[]
  default_route?: SnapshotRoute
  dns_servers?: string[]
}
export interface SnapshotInterface {
  name: string
  addrs?: string[]
  up: boolean
  is_wireless?: boolean
}
export interface SnapshotRoute {
  gateway?: string
  interface?: string
}
export interface SnapshotAgentInfo {
  agent_id?: string
  hostname?: string
  platform?: string
  agent_version?: string
}
export interface SnapshotResources {
  cpu_percent?: number
  memory_total_bytes?: number
  memory_used_bytes?: number
}
export interface SnapshotTargetResult {
  monitor_id: string
  kind?: string
  target?: string
  resolved_ips?: string[]
  endpoints?: string[]
  error_class?: string
}

// Terminal + pre-terminal traceroute statuses. queued/running live server-side;
// the rest are the agent's terminal results.
export type TraceStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'timed_out'
  | 'unsupported'
  | 'failed'
  | 'canceled'
// One traceroute report as referenced from an incident. The execution record is
// shared: the same report_id/content appears everywhere it is referenced.
export interface TraceSummary {
  report_id: string
  agent_id: string
  agent_name: string
  mode: string // icmp | tcp
  dest_host: string
  dest_ip?: string
  port?: number
  status: TraceStatus
  reason?: string
  reached: boolean
  reached_ttl?: number
  active_refs: number
  requested_at: string
  started_at: string | null
  completed_at: string | null
  deadline_at: string
}
// GET /trace-reports/{id}: a full shared report with its per-attempt hops.
export interface TraceReportView extends TraceSummary {
  hops: TraceHopView[]
}
export interface TraceHopView {
  ttl: number
  attempts: TraceAttemptView[]
}
export interface TraceAttemptView {
  attempt: number
  addr?: string
  hostname?: string
  rtt_ms?: number
  timeout: boolean
}
// A group-level alert rule: a one-layer AND/OR list of conditions, each bound to
// a target in the rule's monitor group. It produces per-Agent alert instances.
export interface GroupRule {
  id: string
  group_id: string
  site_id: string
  name: string
  op: 'and' | 'or'
  layer: string
  severity: string
  channel_ids: string[]
  enabled: boolean
  conditions: RuleCondition[]
}
// One threshold test inside a group rule, bound to a target in the rule's group.
// consecutive breaching evaluations (fail_threshold) and an extra dwell gate
// (for_seconds) gate when the condition is considered satisfied.
export interface RuleCondition {
  id: string
  rule_id: string
  target_id: string
  metric_kind: string
  comparator: string // gt | gte | lt | lte | eq
  threshold: number
  fail_threshold: number
  for_seconds: number
  position: number
}
// Create/update payload for a group rule (ids/site are assigned server-side).
export interface GroupRuleInput {
  name: string
  op: 'and' | 'or'
  layer: string
  severity: string
  channel_ids: string[]
  enabled: boolean
  conditions: RuleConditionInput[]
}
export interface RuleConditionInput {
  target_id: string
  metric_kind: string
  comparator: string
  threshold: number
  fail_threshold: number
  for_seconds: number
}
export interface Channel {
  id: string
  name: string
  type: string
  config: Record<string, string>
  enabled: boolean
}
export interface StatusEvent {
  status: string
  changed_at: string
}

export type AgentAlertScope =
  | { monitor: string; target?: never }
  | { target: string; monitor?: never }

export interface StorageStats {
  series: number
  samples: number
  rollup_1m: number
  rollup_1h: number
  rollup_1d: number
}

export interface SeriesInfo {
  kind: string
  target: string
  layer: string
  unit: string
  monitor_id?: string
}

// ---- history data cleanup (DATA-001) ----

export type CleanupStatus = 'live' | 'deleted' | 'system'

export interface CleanupSeries {
  kind: string
  target: string
  layer: string
  unit: string
  generations: number
  earliest_ts: number
  latest_ts: number
  est_samples: number
}
export interface CleanupGroup {
  monitor_id: string
  monitor_name: string
  status: CleanupStatus
  series: CleanupSeries[]
}
export interface CleanupAgent {
  agent_id: string
  agent_name: string
  agent_present: boolean
  groups: CleanupGroup[]
}
export interface CleanupInventory {
  agents: CleanupAgent[]
  orphans: { series: number; monitors: number; est_samples: number }
}
export interface CleanupItemKey {
  agent_id: string
  monitor_id: string
  kind: string
  target: string
}
export interface CleanupSelection {
  mode: 'selection' | 'orphans' | 'all'
  items: CleanupItemKey[]
  from_ts: number
  to_ts: number
  allow_live: boolean
}
export interface CleanupPreviewItem extends CleanupItemKey {
  label: string
  status: CleanupStatus
  series: number
  samples: number
  rollup_1m: number
  rollup_1h: number
  rollup_1d: number
  blocked: boolean
  blocked_reason?: string
}
export interface CleanupPreview {
  items: CleanupPreviewItem[]
  totals: { series: number; samples: number; rollups: number }
  not_cascaded: string[]
}
export interface CleanupJobItem {
  idx: number
  agent_id: string
  monitor_id: string
  kind: string
  target: string
  label: string
  state: 'pending' | 'done' | 'failed'
  detail: string
}
export interface CleanupJob {
  id: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'interrupted'
  mode: string
  from_ts: number
  to_ts: number
  total_items: number
  done_items: number
  failed_items: number
  deleted: { samples: number; rollups: number; series: number }
  error: string
  items: CleanupJobItem[]
  created_at: string | null
  started_at: string | null
  finished_at: string | null
}
export interface CleanupJobSummary {
  id: string
  state: CleanupJob['state']
  mode: string
  total_items: number
  done_items: number
  failed_items: number
  created_at: string | null
}

// Collection-level Wi-Fi verdict for an agent (from the latest InterfaceSnapshot).
export interface WiFiCollection {
  state: string // "ok" | "unreadable" | "" (never reported)
  reason?: string // "permission" | "driver" when unreadable
  sampled_at: string | null
  stale: boolean
}
// One wireless adapter's current status on an interface row. The numeric fields
// are the current authoritative round's readings (null when the driver omitted
// them this round, or the adapter is not connected) — never an older round's value.
export interface WiFiInfo {
  state: string // "connected" | "disconnected" | "unreadable"
  reason?: string
  ssid?: string
  band?: string // "2.4" | "5" | "6"
  channel?: number
  signal_dbm: number | null
  quality_pct: number | null
  rx_mbps: number | null
  tx_mbps: number | null
}
export interface AgentInterface {
  name: string
  addrs: string[]
  gateway?: string
  dns: string[]
  up: boolean
  is_wireless: boolean
  updated_at: string | null
  wifi?: WiFiInfo
}
export interface AgentInterfaces {
  wifi: WiFiCollection
  interfaces: AgentInterface[]
}

export class AuthError extends Error {}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, credentials: 'include' }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  const r = await fetch(url, opts)
  if (r.status === 401) throw new AuthError('unauthorized')
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const j = await r.json()
      if (j?.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}

// Like req, but a 404 resolves to null instead of throwing — for optional
// sub-resources (e.g. an incident that has no snapshot row yet). 401 still throws
// AuthError so the router guard can redirect.
async function reqOrNull<T>(method: string, url: string): Promise<T | null> {
  const r = await fetch(url, { method, credentials: 'include' })
  if (r.status === 401) throw new AuthError('unauthorized')
  if (r.status === 404) return null
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const j = await r.json()
      if (j?.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return (await r.json()) as T
}

export const api = {
  login: (username: string, password: string) => req<User>('POST', '/api/v1/auth/login', { username, password }),
  logout: () => req<unknown>('POST', '/api/v1/auth/logout'),
  me: () => req<User>('GET', '/api/v1/auth/me'),
  serverInfo: () => req<ServerInfo>('GET', '/api/v1/server-info'),
  quota: () => req<Quota>('GET', '/api/v1/quota'),
  stats: () => req<StorageStats>('GET', '/api/v1/stats'),
  sites: () => req<Site[]>('GET', '/api/v1/sites'),
  agents: () => req<Agent[]>('GET', '/api/v1/agents'),
  agent: (id: string) => req<Agent>('GET', `/api/v1/agents/${encodeURIComponent(id)}`),
  updateAgent: (id: string, displayName: string) =>
    req<Agent>('PUT', `/api/v1/agents/${encodeURIComponent(id)}`, { display_name: displayName }),
  deleteAgent: (id: string) => req<unknown>('DELETE', `/api/v1/agents/${encodeURIComponent(id)}`),
  // Live host snapshot: ask the agent for the given scopes (POST), then poll for
  // the result (GET). The POST may return an inline denial (request_id null).
  requestSnapshot: (id: string, scopes: string[]) =>
    req<SnapshotRequestResult>('POST', `/api/v1/agents/${encodeURIComponent(id)}/snapshot`, { scopes }),
  getSnapshot: (id: string) =>
    req<{ snapshot: HostSnapshot | null; pending: boolean; remediation?: Remediation }>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(id)}/snapshot`,
    ),
  // Samples for one kind, scoped by monitor (user-created monitors) or by
  // target string (system series). When `monitor` is set the server filters on
  // the series' monitor_id, so two monitors sharing a target never mix.
  metrics: (
    id: string,
    kind: string,
    opts: { target?: string; monitor?: string; limit?: number; sinceSeconds?: number } = {},
  ) => {
    const p = new URLSearchParams({ kind, limit: String(opts.limit ?? 200) })
    if (opts.target) p.set('target', opts.target)
    if (opts.monitor) p.set('monitor', opts.monitor)
    if (opts.sinceSeconds) p.set('since_seconds', String(opts.sinceSeconds))
    return req<Sample[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/metrics?${p.toString()}`)
  },
  // Latest value per series (one point per target) — cheap "current status".
  latest: (id: string, sinceSeconds?: number) => {
    const p = new URLSearchParams()
    if (sinceSeconds) p.set('since_seconds', String(sinceSeconds))
    const qs = p.toString()
    return req<Sample[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/latest${qs ? '?' + qs : ''}`)
  },
  // All series recorded for an agent — populates the history browser selector.
  listSeries: (id: string) => req<SeriesInfo[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/series`),
  // Current interface set + collection-level Wi-Fi verdict (with server-computed
  // freshness). Agent-scoped, session-protected.
  agentInterfaces: (id: string) =>
    req<AgentInterfaces>('GET', `/api/v1/agents/${encodeURIComponent(id)}/interfaces`),
  agentStatusHistory: (id: string) =>
    req<StatusEvent[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/status-history`),
  // Monitoring/permission issues (notification center). Full-state list + the
  // server-authoritative unread count; SSE pushes updates live.
  listIssues: () => req<IssuesResponse>('GET', '/api/v1/issues'),
  // Mark the given issues read; omit ids (or pass []) to mark all active read.
  markIssuesRead: (ids?: string[]) =>
    req<unknown>('POST', '/api/v1/issues/mark-read', ids && ids.length ? { ids } : {}),
  issueUnreadCount: () => req<{ unread_count: number }>('GET', '/api/v1/issues/unread-count'),
  agentIssues: (id: string) => req<Issue[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/issues`),
  // Per-agent monitor state (collecting vs blocked) for one agent's detail view.
  agentMonitorStatus: (id: string) =>
    req<MonitorStatusRow[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/monitor-status`),
  // Authoritative current status for every target of a site, in one deterministic
  // batch. The single source of current target health across the console.
  targetStatuses: (siteID: string) =>
    req<SiteTargetStatuses>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/target-statuses`),
  listTokens: () => req<EnrollmentToken[]>('GET', '/api/v1/enrollment-tokens'),
  createToken: (note: string) =>
    req<{ token: string; expires_in_minutes: number }>('POST', '/api/v1/enrollment-tokens', { note }),
  listTargets: (siteID: string) => req<ProbeTarget[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/targets`),
  // Saving targets is a full reconcile; the server replies with per-monitor
  // warnings for monitors some in-scope agents can't run (permission/unsupported).
  setTargets: (siteID: string, targets: ProbeTarget[]) =>
    req<SaveTargetsResult>('PUT', `/api/v1/sites/${encodeURIComponent(siteID)}/targets`, { targets }),
  // History data cleanup: controlled series inventory, dry-run preview, and async
  // delete jobs (whole series or a time range; one-click orphan cleanup).
  cleanupSeries: (siteID: string) =>
    req<CleanupInventory>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/cleanup/series`),
  cleanupPreview: (siteID: string, body: CleanupSelection) =>
    req<CleanupPreview>('POST', `/api/v1/sites/${encodeURIComponent(siteID)}/cleanup/preview`, body),
  createCleanupJob: (siteID: string, body: CleanupSelection & { client_token: string }) =>
    req<{ job_id: string }>('POST', `/api/v1/sites/${encodeURIComponent(siteID)}/cleanup/jobs`, body),
  cleanupJob: (id: string) => req<CleanupJob>('GET', `/api/v1/cleanup/jobs/${encodeURIComponent(id)}`),
  cleanupJobs: (siteID: string, limit = 5) =>
    req<CleanupJobSummary[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/cleanup/jobs?limit=${limit}`),
  // Agent groups scope monitoring targets to a subset of agents.
  agentGroups: (siteID: string) =>
    req<AgentGroup[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/agent-groups`),
  createAgentGroup: (siteID: string, name: string) =>
    req<{ id: string }>('POST', `/api/v1/sites/${encodeURIComponent(siteID)}/agent-groups`, { name }),
  updateAgentGroup: (id: string, name: string, agentIds: string[]) =>
    req<unknown>('PUT', `/api/v1/agent-groups/${encodeURIComponent(id)}`, { name, agent_ids: agentIds }),
  deleteAgentGroup: (id: string) => req<unknown>('DELETE', `/api/v1/agent-groups/${encodeURIComponent(id)}`),
  listDevices: (siteID: string) => req<Device[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/devices`),
  // Global server settings (flat key/value map, e.g. console_base_url).
  settings: () => req<Record<string, string>>('GET', '/api/v1/settings'),
  updateSettings: (patch: Record<string, string>) => req<unknown>('PUT', '/api/v1/settings', patch),
  dashboardLayout: () => req<unknown>('GET', '/api/v1/dashboard-layout'),
  updateDashboardLayout: (layout: unknown) => req<unknown>('PUT', '/api/v1/dashboard-layout', layout),
  incidents: (page = 1, pageSize = 15) =>
    req<IncidentPage>('GET', `/api/v1/incidents?page=${page}&page_size=${pageSize}`),
  // One incident with its member alert instances (each carrying frozen evidence).
  incident: (id: string) => req<IncidentDetail>('GET', `/api/v1/incidents/${encodeURIComponent(id)}`),
  timeline: (id: string) => req<TimelineEntry[]>('GET', `/api/v1/incidents/${encodeURIComponent(id)}/timeline`),
  // Immutable incident snapshot (server base + per-Agent scene entries). null when
  // the incident has no snapshot row yet.
  incidentSnapshot: (id: string) =>
    reqOrNull<SnapshotView>('GET', `/api/v1/incidents/${encodeURIComponent(id)}/snapshot`),
  // Traceroute reports referenced by an incident, each with this incident's
  // active-reference count. The full hop detail is read per report id below.
  incidentTraces: (id: string) =>
    req<TraceSummary[]>('GET', `/api/v1/incidents/${encodeURIComponent(id)}/traces`),
  // One full shared traceroute report with all hops — every referencing incident
  // reads the identical execution through this report id.
  traceReport: (reportId: string) =>
    req<TraceReportView>('GET', `/api/v1/trace-reports/${encodeURIComponent(reportId)}`),
  alerts: () => req<Alert[]>('GET', '/api/v1/alerts'),
  // Alarm history (firing + resolved) for one agent, newest first — scoped to
  // a user-created monitor OR to a target string (host alerts).
  agentAlerts: (id: string, scope: AgentAlertScope, limit = 10) => {
    const p = new URLSearchParams({ limit: String(limit) })
    if (scope.monitor) p.set('monitor', scope.monitor)
    else if (scope.target) p.set('target', scope.target)
    return req<Alert[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/alerts?${p.toString()}`)
  },
  // Monitor groups own targets, their shared Agent execution scope and the
  // incident-merge policy. CRUD is site-scoped; the default group cannot be
  // deleted (server replies 400).
  monitorGroups: (siteID: string) =>
    req<MonitorGroup[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/monitor-groups`),
  createMonitorGroup: (siteID: string, body: MonitorGroupInput) =>
    req<{ id: string }>('POST', `/api/v1/sites/${encodeURIComponent(siteID)}/monitor-groups`, body),
  updateMonitorGroup: (id: string, body: MonitorGroupInput) =>
    req<unknown>('PUT', `/api/v1/monitor-groups/${encodeURIComponent(id)}`, body),
  deleteMonitorGroup: (id: string) => req<unknown>('DELETE', `/api/v1/monitor-groups/${encodeURIComponent(id)}`),
  // Group-level one-layer AND/OR alert rules, configured on a monitor group.
  groupRules: (groupID: string) =>
    req<GroupRule[]>('GET', `/api/v1/monitor-groups/${encodeURIComponent(groupID)}/rules`),
  createGroupRule: (groupID: string, rule: GroupRuleInput) =>
    req<{ id: string }>('POST', `/api/v1/monitor-groups/${encodeURIComponent(groupID)}/rules`, rule),
  updateGroupRule: (id: string, rule: GroupRuleInput) =>
    req<unknown>('PUT', `/api/v1/group-rules/${encodeURIComponent(id)}`, rule),
  deleteGroupRule: (id: string) => req<unknown>('DELETE', `/api/v1/group-rules/${encodeURIComponent(id)}`),
  channels: () => req<Channel[]>('GET', '/api/v1/channels'),
  createChannel: (name: string, type: string, config: Record<string, string>) =>
    req<{ id: string }>('POST', '/api/v1/channels', { name, type, config }),
  updateChannel: (id: string, body: { name: string; enabled: boolean; config?: Record<string, string> }) =>
    req<unknown>('PUT', `/api/v1/channels/${encodeURIComponent(id)}`, body),
  deleteChannel: (id: string) => req<unknown>('DELETE', `/api/v1/channels/${encodeURIComponent(id)}`),
}
