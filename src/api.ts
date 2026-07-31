// Thin fetch-based API client. Session cookie is sent via credentials:'include'.
// A 401 is surfaced as AuthError so the router guard can redirect to /login.

export interface User {
  id: string
  username: string
}
export interface ListenStatus {
  effective_addr: string
  source: 'default' | 'flag' | 'db'
  desktop: boolean
  pending_addr?: string
  fallback_from?: string
  overrides_flag: boolean
}
// Last successful update check, as reported under server-info's "update" key.
// The key is absent until a check succeeds and while update checking is switched
// off, so its absence means "show no update UI at all".
export interface UpdateInfo {
  // How this install upgrades: 'store' (Microsoft Store desktop build), 'desktop'
  // (download-center desktop build) or 'server' (standalone server-lite). It only
  // changes the wording of the download action, never its destination.
  install_type: 'store' | 'desktop' | 'server'
  current_version: string
  // May be empty on a Store install that reports a pending package update without
  // naming its version; `update_available` stays authoritative either way.
  latest_version: string
  update_available: boolean
  // Whether the three fields above came from a check that completed. The block is
  // also published for `latest_agent_version` alone, so when this is false
  // `update_available: false` means "not known" — never "up to date".
  product_checked: boolean
  // Where to send the user, already resolved per install type by the server.
  download_url: string
  // Newest agent release, used to flag agents left behind. Omitted when unknown.
  latest_agent_version?: string
  checked_at: string
}
export interface ServerInfo {
  os: string
  native_notify: boolean
  listen?: ListenStatus
  update?: UpdateInfo
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
  // Local permission policy. `supported` is everything the agent can do in its
  // current build + platform + run mode — runtime capability included, e.g. an
  // agent not running as Administrator omits diagnostic.traceroute.tcp;
  // `granted` is what the operator's policy allows; `effective` is the usable
  // intersection. `policy_source` says where the grant came from and
  // `policy_hash` fingerprints it for issue correlation.
  supported: string[]
  granted: string[]
  effective: string[]
  policy_source: string // default | environment | desktop_full_access
  policy_hash: string
  last_seen_at: string | null
  created_at: string
  // Connectivity provenance (AGENT-001/002). null first_connected_at = the agent
  // enrolled but never completed a Hello (distinct from offline).
  first_connected_at: string | null
  last_disconnect_kind: string // '' | clean | error | superseded | revoked | server_shutdown | unsupported_schema
  connectivity_alerts_muted: boolean
}

// One row of an agent's full permission inventory (GET /agents/{id}/permissions).
// Unlike the three sets on Agent, this covers the WHOLE compiled catalog, so the
// detail page can show what the agent does NOT have and how to turn it on.
export interface AgentPermission {
  id: string
  granted: boolean
  supported: boolean
  effective: boolean
  // Direct required parents (never transitive): a child is pruned from effective
  // when a parent isn't effective, so this names the real blocker.
  requires?: string[]
  // Full `NETTACT_AGENT_PERMISSIONS=…` replacement line that grants this
  // permission, dependency-closed by the server. Present only when not granted —
  // the console never derives the closure itself.
  permissions_env?: string
}
export interface AgentPermissions {
  agent_id: string
  policy_source: string
  policy_hash: string
  permissions: AgentPermission[]
}

// The agent-independent permission catalog (GET /permissions), used by the
// enrollment screen where no agent exists yet.
export interface PermissionCatalogEntry {
  id: string
  // Direct required parents, for display.
  requires?: string[]
  // The FULL transitive requirement set. Selecting an entry means selecting
  // `[id, ...implies]`, so building a valid policy is a plain set union and the
  // console never walks the dependency graph itself.
  implies?: string[]
  // Whether the agent's built-in default policy grants it.
  default: boolean
}
export interface PermissionBundle {
  id: string
  permissions: string[]
}
export interface PermissionCatalog {
  permissions: PermissionCatalogEntry[]
  bundles: PermissionBundle[]
}

// --- Agent status list (AGENT-001) ---

// The single authoritative overall status, computed server-side. Order here is
// the sort/severity priority (offline worst, ok best).
export type AgentOverallStatus = 'offline' | 'abnormal' | 'never_connected' | 'ok'

export interface AgentGroupRef {
  id: string
  name: string
}

// The firing connectivity fault embedded in an agent's status row.
export interface AgentConnAlertRef {
  id: string
  reason: string // unexpected | clean_shutdown | version_incompatible
  opened_at: string
  offline_since: string
}

export interface ScalarSample {
  value: number
  unit: string
  ts: string
  stale: boolean
}
export interface MemSample {
  pct: number
  used: number // bytes
  total: number // bytes
  ts: string
  stale: boolean
}
export interface DiskSample {
  pct: number
  used: number // bytes
  total: number // bytes
  mount: string // worst mount (highest pct)
  mounts: number
  ts: string
  stale: boolean
}
export interface NetSample {
  rx_bps: number
  tx_bps: number
  ts: string
  stale: boolean
}
export interface LoadSample {
  load1: number
  load5: number
  load15: number
  ts: string
  stale: boolean
}
// A nil field = no data (permission denied for that family, or never reported).
export interface AgentResources {
  cpu: ScalarSample | null
  memory: MemSample | null
  disk: DiskSample | null
  net: NetSample | null
  load: LoadSample | null
  uptime: ScalarSample | null // host uptime, unit "s"
}

export interface AgentStatusRow {
  id: string
  display_name: string
  hostname: string
  platform: string
  agent_version: string
  status: AgentOverallStatus
  presence: string // online | offline (raw registry status)
  status_since: string | null
  last_seen_at: string | null
  first_connected_at: string | null
  last_disconnect_kind: string
  connectivity_alerts_muted: boolean
  groups: AgentGroupRef[]
  firing_faults: number
  active_issues: number
  connectivity_alert: AgentConnAlertRef | null
  resources: AgentResources
  created_at: string
}

export interface SiteAgentStatuses {
  generated_at: string
  site_id: string
  agents: AgentStatusRow[]
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
  // The agent's specific cause behind `reason` (proxy_missing, literal_denied,
  // method_requires_extended…). Absent for a server-evaluated host monitor. It exists
  // because the coarse status alone can mislead: an egress-proxy problem reports as
  // `unsupported`, which otherwise reads as "your platform cannot do this".
  detail_reason?: string
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
// Where the target's built-in detector stands for this pair. "confirming" is the
// honest middle answer: failing right now, but not yet past its threshold.
export type FaultState = 'normal' | 'confirming' | 'faulted'
// The target-level rollup shown as the headline state (display priority order).
export type DisplayState =
  | 'disabled'
  | 'unassigned'
  | 'faulted'
  | 'confirming'
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
  | 'fault_confirmed'
  | 'fault_confirming'
  | 'probe_failed'
  | 'probe_stale'
  | 'probe_no_data'
  | 'not_applicable'
  | 'ok'
export type WorstSeverity = 'info' | 'warn' | 'error' | 'critical'

// How far a detector is from confirming a fault: consecutive failing rounds
// against the number needed. Present whenever a failing streak is in progress.
export interface ConfirmProgress {
  fail_rounds: number
  need_rounds: number
  first_fail_at?: string
}
// The confirmed fault on a target×Agent pair, linked to the incident that owns it
// so every status row can deep-link into the fault centre.
export interface TargetFaultRef {
  signal_id: string
  incident_id: string
  severity: string
  title: string
  observed_at: string
  confirmed_at: string
}
// One target's status as seen from one applicable Agent. The three dimensions are
// independent: a pair may be execution_state=pending with probe_state=no_data.
export interface TargetAgentStatusRow {
  agent_id: string
  agent_name: string
  agent_online: boolean
  execution_state: ExecutionState
  probe_state: ProbeState
  fault_state: FaultState
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
  confirm?: ConfirmProgress
  fault?: TargetFaultRef
  availability_24h?: number
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
  // Present only for faulted targets.
  worst_severity?: WorstSeverity
  last_observed_at?: string
  // Share of verdict-reaching probe rounds in the last 24h that succeeded (0..1).
  // Absent when the window holds no verdict at all — "unknown" is not "0%".
  availability_24h?: number
  signal_ids: string[]
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
export interface SummaryLatest {
  ts: string
  value: number
}
// Server-side aggregates over a raw window (PERF-001): latest, nearest-rank
// P95, and mean, computed from the same samples the /metrics endpoint would
// return. latest_nonzero is the newest sample whose value rounds to a nonzero
// integer — categorical code cards use it to skip a transient "unknown" probe.
export interface KindSummary {
  latest: SummaryLatest | null
  latest_nonzero: SummaryLatest | null
  p95: number | null
  avg: number | null
  count: number
}
export interface MetricsSummary {
  window_seconds: number
  kinds: Record<string, KindSummary>
}
export interface ProbeParams {
  interval_seconds?: number
  timeout_ms?: number
  // icmp / ping
  packet_size?: number
  packet_count?: number
  global_timeout_ms?: number
  // dns
  record_type?: string
  resolver_server?: string
  resolver_port?: number
  resolver_protocol?: string
  // http
  method?: string
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
  // Pins this monitor's egress to a site proxy (Proxy.id). Empty/absent = direct.
  // It is a MATERIAL field: changing it changes what the agent does on the wire.
  proxy_id?: string
}

// Proxy types. socks5/http are relays (CONNECT); wireguard is a userspace tunnel
// the agent dials from inside, which is why it is the only type that can carry
// ICMP and UDP probes. Mirrors protocol/config/proxy.go.
export type ProxyType = 'socks5' | 'http' | 'wireguard'
// Where the target hostname is resolved. 'local' (default) resolves on the agent so
// its target-access policy still vets the concrete address; 'remote' hands the name
// to the proxy (needed for split-horizon DNS, but the agent can then only vet the
// name).
export type ProxyDNSMode = 'local' | 'remote'

// An egress proxy a monitoring target can be pinned to.
//
// Credential fields (password, wg_private_key, wg_preshared_key) are WRITE-ONLY:
// reads return REDACTED_SECRET when one is set, and sending that value back means
// "keep what is stored". Sending an empty string clears it.
export interface Proxy {
  id: string
  site_id: string
  name: string
  type: ProxyType
  enabled: boolean

  // socks5 / http
  host?: string
  port?: number
  username?: string
  password?: string
  dns_mode?: ProxyDNSMode
  connect_timeout_ms?: number

  // wireguard
  wg_private_key?: string
  wg_peer_public_key?: string
  wg_preshared_key?: string
  wg_endpoint?: string
  wg_allowed_ips?: string
  wg_local_addrs?: string
  wg_dns?: string
  wg_mtu?: number
  wg_keepalive_seconds?: number

  // Number of monitors pinned to this proxy (read-only). A referenced proxy cannot
  // be deleted.
  used_by: number
}

// REDACTED_SECRET is what the API returns in place of a stored credential, and what
// a write may send back to mean "unchanged". It must match api.redactedSecret in
// server-core/api/proxies.go.
export const REDACTED_SECRET = '••••••'

export type ProxyInput = Omit<Proxy, 'id' | 'site_id' | 'used_by'>

// The 409 body returned when deleting a proxy that monitors still reference.
export interface ProxyInUseError {
  error: string
  monitors: string[]
  used_by: number
}
// First-run onboarding progress, stored server-side so the wizard is
// interruptible and re-enterable across reloads/devices. status/step carry the
// resume point; regions is the set of catalog regions the user picked.
export interface OnboardingState {
  version: number
  status: 'in_progress' | 'done'
  step: string
  regions: string[]
  banner_dismissed: boolean
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
  // Notification summary: how many records were actually sent, and how many are
  // still waiting out their policy delay. Both 0 with an open incident means the
  // fault is recorded but no channel is configured to hear about it.
  notified_count: number
  pending_notify_count: number
  // Set when this fault was correlated into a burst that was announced once as a
  // whole (ALERT-001). Both notify counts can then be 0 while everyone WAS told,
  // so the list reads this before concluding "recorded only".
  storm_id?: string
  opened_at: string
  resolved_at: string | null
}
// A fault signal: one confirmed fault lifecycle for one (agent, target,
// detector). Every display fact is frozen at confirmation time, so renaming or
// deleting the target afterwards cannot rewrite what the fault said.
export interface FaultSignal {
  id: string
  // Server-rendered standard statement, e.g. "「Router」的 ICMP 探测不可达".
  title: string
  site_id: string
  agent_id: string
  agent_name: string
  target_id?: string
  target_name: string
  target_addr: string
  target_port?: number
  detector_key: 'availability' | 'agent_connectivity'
  probe_kind: string
  group_id?: string
  group_name: string
  layer: string
  severity: string
  state: 'firing' | 'resolved'
  // recovered | configuration_changed | target_disabled | target_deleted |
  // agent_scope_changed | agent_deleted | muted | disabled. Only "recovered"
  // means the fault actually went away.
  resolve_reason?: string
  fail_threshold: number
  recover_threshold: number
  metric_kind: string
  comparator: string // gte (icmp loss) | lt (probe ok)
  value: number
  threshold: number
  // Frozen probe failure reason (telemetry.ProbeReason* code): the underlying
  // cause (unreachable / DNS-failed / timeout). 0 = none.
  reason_code: number
  // Raw underlying error in English machine text (e.g. "dial tcp …: connection
  // refused", "HTTP 503", "NXDOMAIN"); deliberately not localized. '' if absent.
  reason_detail: string
  // First failing round, the round that reached the threshold, and (once ended)
  // when it ended. Duration is measured from observed_at.
  observed_at: string
  confirmed_at: string
  resolved_at: string | null
  incident_id: string
  // Read-time overlay: whether the detector still has an unbroken failing streak.
  // False on a firing signal ⇒ it is answering again but has not yet recovered.
  currently_abnormal: boolean
  // Server-rendered fault description in both languages.
  desc_zh?: string
  desc_en?: string
}
export interface TimelineEntry {
  ts: string
  kind: string
  message: string
  // Entity the entry points at: a fault signal id, incident id or trace report id.
  ref?: string
}
// GET /incidents/{id}: one incident with its member fault signals.
// `abnormal_target_count` is computed read-time from CURRENT detector state — the
// number of distinct targets still failing right now — and is deliberately
// decoupled from the member count, whose evidence is immutable.
export interface IncidentDetail {
  incident: Incident
  members: FaultSignal[]
  abnormal_target_count: number
}
// Fault-centre filters. Every field is optional; the unset default is "every
// incident, newest first".
export interface IncidentFilter {
  state?: 'open' | 'resolved'
  severity?: string
  group?: string
  agent?: string
  target?: string
  // A probe kind (icmp | tcp | http | dns | nat | gateway) or a detector key
  // (agent_connectivity).
  kind?: string
  // Narrow to the members of one correlated burst.
  storm?: string
  q?: string
  since?: string
  until?: string
}
export interface IncidentPage {
  items: Incident[]
  total: number
  page: number
  page_size: number
  summary: IncidentSummary
  // Open storms for the site. Like `summary`, deliberately UNFILTERED: "several
  // things broke at once" is a fact about the site right now, not about the
  // narrowing the reader happens to have applied to the table.
  storms: AlertStorm[]
}
export interface IncidentSummary {
  open: number
  opened_24h: number
  resolved_24h: number
  top_layer: string
}
// A correlated burst of faults seen from one Agent's vantage point, announced
// once instead of once per fault (ALERT-001). It is a heading over its member
// incidents, never a replacement for them — every member is still listed.
export interface AlertStorm {
  id: string
  site_id: string
  agent_id: string
  agent_name: string
  state: 'open' | 'resolved'
  severity: string
  suspected_layer: string
  fault_count: number
  open_fault_count: number
  group_count: number
  notified_count: number
  pending_notify_count: number
  opened_at: string
  resolved_at: string | null
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
  signal_id: string
  detector_key: string
  agent_id: string
  agent_name?: string
  severity: string
  layer?: string
  observed_at: string
  confirmed_at: string
  evidence: SnapshotBaseEvidence
}
export interface SnapshotBaseEvidence {
  target_id?: string
  target_name?: string
  target_addr?: string
  probe_kind?: string
  metric_kind?: string
  comparator?: string
  threshold: number
  value: number
  reason_code?: number
  reason_detail?: string
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
  // Present when the requested mode couldn't run and the Agent transparently
  // fell back to another mode (currently tcp -> icmp only, when the Agent lacks
  // admin rights or policy grant for TCP traceroute but can still run ICMP).
  fallback_from?: string // '' | 'tcp' — the mode this report was originally requested as
  fallback_reason?: string // raw_socket_unavailable | permission_denied
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
// ---- notification policies (ALERT-002) ----
// A policy decides whether, when and where a RECORDED fault is announced. It
// takes no part in detecting one: detection always runs, so a policy with no
// channels is a legal, meaningful state meaning "record everything, send
// nothing". Exactly one policy applies to any incident, resolved by a fixed
// precedence with no stacking: group > site default.
export type PolicyScope = 'site' | 'group'
export interface NotificationPolicy {
  id: string
  site_id: string
  name: string
  scope_kind: PolicyScope
  scope_id: string
  enabled: boolean
  min_severity: string
  warn_delay_sec: number
  critical_delay_sec: number
  notify_recovery: boolean
  channel_ids: string[]
  is_default: boolean
  created_at: string
}
export interface NotificationPolicyInput {
  name: string
  scope_kind: PolicyScope
  scope_id: string
  enabled: boolean
  min_severity: string
  warn_delay_sec: number
  critical_delay_sec: number
  notify_recovery: boolean
  channel_ids: string[]
}
// The one policy that governs a target, and the scope it came from — the same
// resolver the delivery planner uses, so a preview can never disagree with what
// actually happens.
export interface EffectivePolicy {
  policy: NotificationPolicy | null
  source: PolicyScope | 'none'
  chain: PolicyScope[]
}
// One planned or completed notification, so the console can show whether a fault
// was announced, is still waiting out its delay, or was deliberately not sent.
export interface NotificationDelivery {
  id: string
  incident_id?: string
  // Set instead of incident_id on the records that announced a correlated burst.
  // A member fault surfaces these too, so its detail panel can say "told once, as
  // part of a storm" rather than showing only canceled rows.
  storm_id?: string
  event_kind: 'incident.opened' | 'incident.resolved' | 'storm.opened' | 'storm.resolved'
  channel_id: string
  channel_name?: string
  policy_id?: string
  status: 'pending' | 'sent' | 'failed' | 'canceled'
  due_at: string
  sent_at?: string
}

// ---- built-in detection sensitivity ----
// The only tunables the built-in detector has. There is deliberately no "off":
// fault recording is a product guarantee, so a user who does not want the probe
// disables the target, and one who does not want to be disturbed edits its
// monitor group's notification policy.
export type DetectionProfile = 'balanced' | 'fast' | 'stable' | 'custom'
export interface DetectionSettings {
  target_id: string
  kind: string
  profile: DetectionProfile
  fail_rounds: number
  recover_rounds: number
  // Loss percentage at or above which an ICMP/gateway round counts as a failure.
  // 100 = only total loss is a fault.
  icmp_loss_pct: number
  revision: number
  updated_at?: string
}
export interface DetectionSettingsInput {
  profile: DetectionProfile
  fail_rounds: number
  recover_rounds: number
  icmp_loss_pct: number
}

// ---- availability ----
// Share of verdict-reaching probe rounds that succeeded. Rounds that reached no
// verdict (blocked permission, unsupported platform, agent offline) are absent
// from the denominator rather than counted as failures.
export interface AvailabilityRatio {
  monitor_id: string
  agent_id?: string
  rounds: number
  ok_rounds: number
  ratio: number
}
export type AvailabilityWindow = '24h' | '7d' | '30d'
export interface SiteAvailability {
  window: string
  targets: Record<string, AvailabilityRatio>
}
export interface TargetAvailabilityWindow {
  window: AvailabilityWindow
  total: AvailabilityRatio
  agents: AvailabilityRatio[]
}
export interface TargetAvailability {
  target_id: string
  windows: TargetAvailabilityWindow[]
}

export interface Channel {
  id: string
  name: string
  type: string
  config: Record<string, string>
  enabled: boolean
  // Receive ONE summary when many faults break out at once under a single Agent,
  // instead of one message per fault (ALERT-001). On by default; turn it off for
  // a machine consumer that needs one record per incident.
  storm_merge: boolean
}
// Outcome of a webhook test send: the request always returns 200, carrying the
// delivery result (ok=false on a transport error or a >=300 status).
export interface ChannelTestResult {
  ok: boolean
  status_code: number
  body: string
  error?: string
}
export interface StatusEvent {
  status: string
  changed_at: string
  // Disconnect kind for offline transitions ('' for online) — AGENT-002.
  reason?: string
}

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
  default_route?: {
    gateway: string
    interface: string
  }
}

export class AuthError extends Error {}

// Non-2xx responses other than 401 throw ApiError, which carries the HTTP status
// so callers can branch on it (e.g. 403 = wrong old password on change-password)
// without string-matching the server's English `error` text.
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

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
    throw new ApiError(r.status, msg)
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
    throw new ApiError(r.status, msg)
  }
  return (await r.json()) as T
}

// incidentQuery serializes the fault-centre filter onto the incidents query.
function incidentQuery(f: IncidentFilter): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v))
  const qs = p.toString()
  return qs ? '&' + qs : ''
}

export const api = {
  login: (username: string, password: string) => req<User>('POST', '/api/v1/auth/login', { username, password }),
  logout: () => req<unknown>('POST', '/api/v1/auth/logout'),
  me: () => req<User>('GET', '/api/v1/auth/me'),
  // Change the current user's password. A wrong old password comes back 403
  // (ApiError with status 403 — a field error, NOT a session expiry); a missing
  // or expired session is 401 (AuthError → send the user back to login); a too-
  // weak new password is 400 with `error`. On success the server keeps THIS
  // session and invalidates the others.
  changePassword: (oldPassword: string, newPassword: string) =>
    req<{ ok: boolean }>('POST', '/api/v1/auth/password', { old_password: oldPassword, new_password: newPassword }),
  serverInfo: () => req<ServerInfo>('GET', '/api/v1/server-info'),
  quota: () => req<Quota>('GET', '/api/v1/quota'),
  stats: () => req<StorageStats>('GET', '/api/v1/stats'),
  sites: () => req<Site[]>('GET', '/api/v1/sites'),
  agents: () => req<Agent[]>('GET', '/api/v1/agents'),
  agent: (id: string) => req<Agent>('GET', `/api/v1/agents/${encodeURIComponent(id)}`),
  // Patch an agent: display_name and/or the connectivity-alert mute switch.
  // Omitted fields are left untouched (pointer semantics on the server).
  updateAgent: (id: string, patch: { display_name?: string; connectivity_alerts_muted?: boolean }) =>
    req<Agent>('PUT', `/api/v1/agents/${encodeURIComponent(id)}`, patch),
  deleteAgent: (id: string) => req<unknown>('DELETE', `/api/v1/agents/${encodeURIComponent(id)}`),
  // Per-agent health + resource rollup for the Agent status list (AGENT-001).
  agentStatuses: (siteID: string) =>
    req<SiteAgentStatuses>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/agent-statuses`),
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
  // Per-kind latest/P95/avg aggregated server-side from raw samples (default
  // window 2h, capped at raw retention) — stat cards get one small response
  // instead of a sample window. Same monitor/target scoping as `metrics`;
  // `reduce: 'worst'` collapses to the per-timestamp worst value across series
  // and `excludeTargets` drops series by target string (dashboard quality).
  metricsSummary: (
    id: string,
    kinds: string[],
    opts: { monitor?: string; target?: string; sinceSeconds?: number; reduce?: 'worst'; excludeTargets?: string[] } = {},
  ) => {
    const p = new URLSearchParams({ kinds: kinds.join(',') })
    if (opts.monitor) p.set('monitor', opts.monitor)
    if (opts.target) p.set('target', opts.target)
    if (opts.sinceSeconds) p.set('since_seconds', String(opts.sinceSeconds))
    if (opts.reduce) p.set('reduce', opts.reduce)
    if (opts.excludeTargets?.length) p.set('exclude_targets', opts.excludeTargets.join(','))
    return req<MetricsSummary>('GET', `/api/v1/agents/${encodeURIComponent(id)}/metrics/summary?${p.toString()}`)
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
  // The agent's whole permission catalog — granted and not granted — each
  // ungranted one carrying the exact policy line that would grant it.
  agentPermissions: (id: string) =>
    req<AgentPermissions>('GET', `/api/v1/agents/${encodeURIComponent(id)}/permissions`),
  // Every permission this server build knows, plus the enrollment presets.
  permissionCatalog: () => req<PermissionCatalog>('GET', '/api/v1/permissions'),
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
  updateSettings: (patch: Record<string, string>) =>
    req<{ ok: boolean; listen_effect?: 'restarting' | 'pending' }>('PUT', '/api/v1/settings', patch),
  dashboardLayout: () => req<unknown>('GET', '/api/v1/dashboard-layout'),
  updateDashboardLayout: (layout: unknown) => req<unknown>('PUT', '/api/v1/dashboard-layout', layout),
  // First-run onboarding progress. GET returns null until the wizard first runs
  // (that null is the console's auto-open signal). PUT persists the resume point.
  onboardingState: () => req<OnboardingState | null>('GET', '/api/v1/onboarding'),
  updateOnboardingState: (state: OnboardingState) => req<OnboardingState>('PUT', '/api/v1/onboarding', state),
  incidents: (page = 1, pageSize = 15, filter: IncidentFilter = {}) =>
    req<IncidentPage>('GET', `/api/v1/incidents?page=${page}&page_size=${pageSize}${incidentQuery(filter)}`),
  // One incident with its member fault signals (each carrying frozen evidence).
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
  // Notification records for one incident: what was sent, to where, when — or
  // why nothing was.
  incidentNotifications: (id: string) =>
    req<NotificationDelivery[]>('GET', `/api/v1/incidents/${encodeURIComponent(id)}/notifications`),
  // Fault signals: the one history surface for confirmed faults. Filter by agent,
  // target, detector (availability | agent_connectivity) and state.
  faultSignals: (
    opts: {
      agent?: string
      target?: string
      detector?: 'availability' | 'agent_connectivity'
      state?: 'firing' | 'resolved'
      limit?: number
    } = {},
  ) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(opts)) if (v) p.set(k, String(v))
    const qs = p.toString()
    return req<FaultSignal[]>('GET', `/api/v1/fault-signals${qs ? '?' + qs : ''}`)
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
  // Egress proxies a monitor can be pinned to. Credentials are write-only: reads
  // return REDACTED_SECRET, and sending it back means "keep the stored value".
  // Deleting a proxy that monitors still reference is refused with 409.
  proxies: (siteID: string) => req<Proxy[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/proxies`),
  createProxy: (siteID: string, body: ProxyInput) =>
    req<{ id: string }>('POST', `/api/v1/sites/${encodeURIComponent(siteID)}/proxies`, body),
  updateProxy: (id: string, body: ProxyInput) =>
    req<unknown>('PUT', `/api/v1/proxies/${encodeURIComponent(id)}`, body),
  deleteProxy: (id: string) => req<unknown>('DELETE', `/api/v1/proxies/${encodeURIComponent(id)}`),
  // Notification policies: whether/when/where a recorded fault is announced. The
  // site default is created on first read and cannot be deleted.
  notificationPolicies: (siteID: string) =>
    req<NotificationPolicy[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/notification-policies`),
  createNotificationPolicy: (siteID: string, body: NotificationPolicyInput) =>
    req<NotificationPolicy>('POST', `/api/v1/sites/${encodeURIComponent(siteID)}/notification-policies`, body),
  updateNotificationPolicy: (id: string, body: NotificationPolicyInput) =>
    req<NotificationPolicy>('PATCH', `/api/v1/notification-policies/${encodeURIComponent(id)}`, body),
  deleteNotificationPolicy: (id: string) =>
    req<unknown>('DELETE', `/api/v1/notification-policies/${encodeURIComponent(id)}`),
  // Preview which single policy governs a target, and through which scope.
  effectiveNotificationPolicy: (targetID: string) =>
    req<EffectivePolicy>('GET', `/api/v1/targets/${encodeURIComponent(targetID)}/effective-notification-policy`),
  // Built-in detector sensitivity for one target.
  detectionSettings: (targetID: string) =>
    req<DetectionSettings>('GET', `/api/v1/targets/${encodeURIComponent(targetID)}/detection-settings`),
  updateDetectionSettings: (targetID: string, body: DetectionSettingsInput) =>
    req<DetectionSettings>('PATCH', `/api/v1/targets/${encodeURIComponent(targetID)}/detection-settings`, body),
  // Availability over a window: every target of a site, or one target broken
  // down per Agent.
  siteAvailability: (siteID: string, window: AvailabilityWindow = '24h') =>
    req<SiteAvailability>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/availability?window=${window}`),
  targetAvailability: (targetID: string, windows: AvailabilityWindow[] = ['24h', '7d', '30d']) =>
    req<TargetAvailability>(
      'GET',
      `/api/v1/targets/${encodeURIComponent(targetID)}/availability?windows=${windows.join(',')}`,
    ),
  channels: () => req<Channel[]>('GET', '/api/v1/channels'),
  // A new channel always starts with storm merging on; it is changed afterwards
  // through updateChannel.
  createChannel: (name: string, type: string, config: Record<string, string>) =>
    req<{ id: string }>('POST', '/api/v1/channels', { name, type, config }),
  // A full PUT of the channel's flags: every caller must send the current
  // storm_merge along with name/enabled, or it is turned off.
  updateChannel: (
    id: string,
    body: { name: string; enabled: boolean; storm_merge: boolean; config?: Record<string, string> },
  ) => req<unknown>('PUT', `/api/v1/channels/${encodeURIComponent(id)}`, body),
  deleteChannel: (id: string) => req<unknown>('DELETE', `/api/v1/channels/${encodeURIComponent(id)}`),
  // Send a sample incident to a webhook config without saving a channel.
  testChannel: (type: string, config: Record<string, string>) =>
    req<ChannelTestResult>('POST', '/api/v1/channels/test', { type, config }),
}
