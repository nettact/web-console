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
  hostname: string
  platform: string
  agent_version: string
  status: string
  last_seen_at: string | null
  created_at: string
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
  // icmp
  packet_size?: number
  retries?: number
  // dns
  record_type?: string
  // http
  method?: string
  expected_status?: number
}
export interface ProbeTarget {
  id?: string
  kind: string
  target: string
  tier: string
  params?: ProbeParams
  enabled: boolean
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
  listDevices: (siteID: string) => req<Device[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/devices`),
  incidents: () => req<Incident[]>('GET', '/api/v1/incidents'),
  timeline: (id: string) => req<TimelineEntry[]>('GET', `/api/v1/incidents/${encodeURIComponent(id)}/timeline`),
  alerts: () => req<Alert[]>('GET', '/api/v1/alerts'),
  // Alarm rules: reusable templates + per-target rules.
  ruleTemplates: () => req<Rule[]>('GET', '/api/v1/rule-templates'),
  createTemplate: (rule: Partial<Rule>) => req<{ id: string }>('POST', '/api/v1/rule-templates', rule),
  targetRules: (probeTaskId: string) =>
    req<Rule[]>('GET', `/api/v1/targets/${encodeURIComponent(probeTaskId)}/rules`),
  createTargetRule: (probeTaskId: string, rule: Partial<Rule>) =>
    req<{ id: string }>('POST', `/api/v1/targets/${encodeURIComponent(probeTaskId)}/rules`, rule),
  applyTemplate: (probeTaskId: string, templateId: string) =>
    req<{ id: string }>('POST', `/api/v1/targets/${encodeURIComponent(probeTaskId)}/apply-template`, {
      template_id: templateId,
    }),
  updateRule: (id: string, rule: Partial<Rule>) =>
    req<unknown>('PUT', `/api/v1/rules/${encodeURIComponent(id)}`, rule),
  updateTemplate: (id: string, rule: Partial<Rule>) =>
    req<unknown>('PUT', `/api/v1/rule-templates/${encodeURIComponent(id)}`, rule),
  deleteRule: (id: string) => req<unknown>('DELETE', `/api/v1/rules/${encodeURIComponent(id)}`),
  deleteTemplate: (id: string) => req<unknown>('DELETE', `/api/v1/rule-templates/${encodeURIComponent(id)}`),
  channels: () => req<Channel[]>('GET', '/api/v1/channels'),
  createChannel: (name: string, type: string, config: Record<string, string>) =>
    req<{ id: string }>('POST', '/api/v1/channels', { name, type, config }),
  updateChannel: (id: string, body: { name: string; enabled: boolean; config?: Record<string, string> }) =>
    req<unknown>('PUT', `/api/v1/channels/${encodeURIComponent(id)}`, body),
  deleteChannel: (id: string) => req<unknown>('DELETE', `/api/v1/channels/${encodeURIComponent(id)}`),
}
