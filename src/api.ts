// Thin fetch-based API client (no axios). Session cookie is sent via
// credentials:'include' once login lands in M2.

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

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return (await r.json()) as T
}

export const api = {
  agents: () => get<Agent[]>('/api/v1/agents'),
  metrics: (id: string, kind: string, target?: string, limit = 200) => {
    const p = new URLSearchParams({ kind, limit: String(limit) })
    if (target) p.set('target', target)
    return get<Sample[]>(`/api/v1/agents/${encodeURIComponent(id)}/metrics?${p.toString()}`)
  },
}
