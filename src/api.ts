// Thin fetch-based API client. Session cookie is sent via credentials:'include'.
// A 401 is surfaced as AuthError so the router guard can redirect to /login.

export interface User {
  id: string
  username: string
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
  capabilities?: string[]
  last_seen_at: string | null
  created_at: string
}
// Live host snapshot (ephemeral process / connection lists — never stored).
export interface ProcessInfo {
  pid: number
  name: string
  user?: string
  status?: string
  cpu_pct: number
  rss_bytes: number
  virt_bytes: number
  disk_read_bytes: number
  disk_write_bytes: number
  run_time_seconds: number
}
export interface ConnectionInfo {
  proto: string
  local_addr: string
  remote_addr?: string
  state?: string
  pid?: number
  process_name?: string
}
export interface HostSnapshot {
  ts: string
  request_id: string
  process_total: number
  processes?: ProcessInfo[]
  connections?: ConnectionInfo[]
}
export interface Sample {
  ts: string
  kind: string
  target: string
  layer: string
  value: number
  unit: string
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
export interface Alert {
  id: string
  rule_name: string
  agent_id: string
  target: string
  layer: string
  severity: string
  state: string
  value: number
  started_at: string
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
  quota: () => req<Quota>('GET', '/api/v1/quota'),
  stats: () => req<StorageStats>('GET', '/api/v1/stats'),
  sites: () => req<Site[]>('GET', '/api/v1/sites'),
  agents: () => req<Agent[]>('GET', '/api/v1/agents'),
  agent: (id: string) => req<Agent>('GET', `/api/v1/agents/${encodeURIComponent(id)}`),
  updateAgent: (id: string, displayName: string) =>
    req<Agent>('PUT', `/api/v1/agents/${encodeURIComponent(id)}`, { display_name: displayName }),
  deleteAgent: (id: string) => req<unknown>('DELETE', `/api/v1/agents/${encodeURIComponent(id)}`),
  // Live host snapshot: ask the agent (POST), then poll for the result (GET).
  requestSnapshot: (id: string, wantProcesses = true, wantConnections = true) =>
    req<{ request_id: string }>('POST', `/api/v1/agents/${encodeURIComponent(id)}/snapshot`, {
      want_processes: wantProcesses,
      want_connections: wantConnections,
    }),
  getSnapshot: (id: string) =>
    req<{ snapshot: HostSnapshot | null; pending: boolean }>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(id)}/snapshot`,
    ),
  metrics: (id: string, kind: string, target?: string, limit = 200, sinceSeconds?: number) => {
    const p = new URLSearchParams({ kind, limit: String(limit) })
    if (target) p.set('target', target)
    if (sinceSeconds) p.set('since_seconds', String(sinceSeconds))
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
  agentStatusHistory: (id: string) =>
    req<StatusEvent[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/status-history`),
  listTokens: () => req<EnrollmentToken[]>('GET', '/api/v1/enrollment-tokens'),
  createToken: (note: string) =>
    req<{ token: string; expires_in_minutes: number }>('POST', '/api/v1/enrollment-tokens', { note }),
  listTargets: (siteID: string) => req<ProbeTarget[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/targets`),
  setTargets: (siteID: string, targets: ProbeTarget[]) =>
    req<unknown>('PUT', `/api/v1/sites/${encodeURIComponent(siteID)}/targets`, { targets }),
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
  incidents: () => req<Incident[]>('GET', '/api/v1/incidents'),
  timeline: (id: string) => req<TimelineEntry[]>('GET', `/api/v1/incidents/${encodeURIComponent(id)}/timeline`),
  alerts: () => req<Alert[]>('GET', '/api/v1/alerts'),
  // Alarm history (firing + resolved) for one agent+target, newest first.
  agentAlerts: (id: string, target: string, limit = 10) => {
    const p = new URLSearchParams({ limit: String(limit) })
    if (target) p.set('target', target)
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
