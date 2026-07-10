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
export interface ProbeTarget {
  id?: string
  kind: string
  target: string
  tier: string
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
  sites: () => req<Site[]>('GET', '/api/v1/sites'),
  agents: () => req<Agent[]>('GET', '/api/v1/agents'),
  metrics: (id: string, kind: string, target?: string, limit = 200) => {
    const p = new URLSearchParams({ kind, limit: String(limit) })
    if (target) p.set('target', target)
    return req<Sample[]>('GET', `/api/v1/agents/${encodeURIComponent(id)}/metrics?${p.toString()}`)
  },
  listTokens: () => req<EnrollmentToken[]>('GET', '/api/v1/enrollment-tokens'),
  createToken: (note: string) =>
    req<{ token: string; expires_in_minutes: number }>('POST', '/api/v1/enrollment-tokens', { note }),
  listTargets: (siteID: string) => req<ProbeTarget[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/targets`),
  setTargets: (siteID: string, targets: ProbeTarget[]) =>
    req<unknown>('PUT', `/api/v1/sites/${encodeURIComponent(siteID)}/targets`, { targets }),
  listDevices: (siteID: string) => req<Device[]>('GET', `/api/v1/sites/${encodeURIComponent(siteID)}/devices`),
}
