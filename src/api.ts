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
// by permission / target selector / lack of platform support.
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
export interface ProbeTarget {
  id?: string
  kind: string
  name?: string
  target: string
  params?: ProbeParams
  enabled: boolean
  // Scope: all_agents=true pushes to every agent in the site (default). When
  // false, the target reaches only agents in group_ids.
  all_agents: boolean
  group_ids?: string[]
}
// A named set of agents used to scope monitoring targets. An agent may belong to
// several groups; a target scoped to a group is pushed to all its members.
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
export interface Incident {
  id: string
  site_id: string
  title: string
  suspected_layer: string
  state: string
  severity: string
  summary: string
  opened_at: string
  resolved_at: string | null
}
export interface TimelineEntry {
  ts: string
  kind: string
  message: string
}
export interface IncidentPage {
  items: Incident[]
  total: number
  page: number
  page_size: number
}
export interface Alert {
  id: string
  rule_name: string
  agent_id: string
  agent_host: string
  target: string
  target_name?: string
  layer: string
  severity: string
  state: string
  value: number
  started_at: string
  // Human description of the fault, rendered server-side in both languages.
  desc_zh?: string
  desc_en?: string
}
export interface Rule {
  id: string
  probe_task_id?: string
  name: string
  metric_kind: string
  comparator: string
  threshold: number
  fail_threshold: number
  for_seconds: number
  layer: string
  severity: string
  channel_ids: string[]
  is_template: boolean
  enabled: boolean
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
  // Per-agent monitor state (collecting vs blocked), keyed the two ways it's read:
  // all monitors on one agent, or one target across the agents that run it.
  agentMonitorStatus: (id: string) =>
    req<MonitorStatusRow[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/monitor-status`),
  targetAgentStatus: (targetID: string) =>
    req<MonitorStatusRow[]>('GET', `/api/v1/targets/${encodeURIComponent(targetID)}/agent-status`),
  listTokens: () => req<EnrollmentToken[]>('GET', '/api/v1/enrollment-tokens'),
  createToken: (note: string) =>
    req<{ token: string; expires_in_minutes: number }>('POST', '/api/v1/enrollment-tokens', { note }),
  listTargets: (siteID: string) => req<ProbeTarget[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/targets`),
  // Saving targets is a full reconcile; the server replies with per-monitor
  // warnings for monitors some in-scope agents can't run (permission/unsupported).
  setTargets: (siteID: string, targets: ProbeTarget[]) =>
    req<SaveTargetsResult>('PUT', `/api/v1/sites/${encodeURIComponent(siteID)}/targets`, { targets }),
  // History purges: per user-created monitor (across all agents), or by target
  // string for SYSTEM series only (e.g. a removed interface) — the string form
  // never touches monitor data.
  purgeMonitor: (siteID: string, monitorID: string) =>
    req<{ purged_series: number }>('POST', `/api/v1/sites/${encodeURIComponent(siteID)}/purge-target`, { monitor_id: monitorID }),
  purgeTarget: (siteID: string, target: string) =>
    req<{ purged_series: number }>('POST', `/api/v1/sites/${encodeURIComponent(siteID)}/purge-target`, { target }),
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
  incidents: (page = 1, pageSize = 15) =>
    req<IncidentPage>('GET', `/api/v1/incidents?page=${page}&page_size=${pageSize}`),
  timeline: (id: string) => req<TimelineEntry[]>('GET', `/api/v1/incidents/${encodeURIComponent(id)}/timeline`),
  alerts: () => req<Alert[]>('GET', '/api/v1/alerts'),
  // Alarm history (firing + resolved) for one agent, newest first — scoped to
  // a user-created monitor OR to a target string (host alerts).
  agentAlerts: (id: string, scope: { target?: string; monitor?: string }, limit = 10) => {
    const p = new URLSearchParams({ limit: String(limit) })
    if (scope.monitor) p.set('monitor', scope.monitor)
    else if (scope.target) p.set('target', scope.target)
    return req<Alert[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/alerts?${p.toString()}`)
  },
  // Alarm rules are configured per monitoring target.
  targetRules: (probeTaskId: string) =>
    req<Rule[]>('GET', `/api/v1/targets/${encodeURIComponent(probeTaskId)}/rules`),
  createTargetRule: (probeTaskId: string, rule: Partial<Rule>) =>
    req<{ id: string }>('POST', `/api/v1/targets/${encodeURIComponent(probeTaskId)}/rules`, rule),
  updateRule: (id: string, rule: Partial<Rule>) =>
    req<unknown>('PUT', `/api/v1/rules/${encodeURIComponent(id)}`, rule),
  deleteRule: (id: string) => req<unknown>('DELETE', `/api/v1/rules/${encodeURIComponent(id)}`),
  channels: () => req<Channel[]>('GET', '/api/v1/channels'),
  createChannel: (name: string, type: string, config: Record<string, string>) =>
    req<{ id: string }>('POST', '/api/v1/channels', { name, type, config }),
  updateChannel: (id: string, body: { name: string; enabled: boolean; config?: Record<string, string> }) =>
    req<unknown>('PUT', `/api/v1/channels/${encodeURIComponent(id)}`, body),
  deleteChannel: (id: string) => req<unknown>('DELETE', `/api/v1/channels/${encodeURIComponent(id)}`),
}
