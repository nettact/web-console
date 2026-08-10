// The public status API client.
//
// Deliberately NOT the console's src/api.ts: that one sends credentials, assumes
// a same-origin server and carries the full authenticated type surface. This one
// is anonymous, cross-origin by design, and knows only the three public
// endpoints. The types mirror server-core/statuspage's public DTOs field for
// field — if one gains a field, add it here on purpose.

import { apiBase } from './config'

export interface PublicPage {
  slug: string
  title: string
  description?: string
  show_agent_view: boolean
  show_target_view: boolean
  show_target_address: boolean
  generated_at: string
}

export interface PublicAgentRow {
  /** Operator-set display name; empty when unset (render the ordinal instead). */
  name: string
  /** 1-based position in this page's agent list, stable across polls. */
  ordinal: number
  online: boolean
  status_since?: string
}

export interface PublicAgentStatuses {
  generated_at: string
  agents: PublicAgentRow[]
}

export type PublicTargetState = 'up' | 'down' | 'degraded' | 'unknown'

export interface PublicTargetRow {
  name: string
  /** 1-based position among this page's targets OF THE SAME KIND. */
  ordinal: number
  kind: string
  /** Present only when the page opted into showing addresses. */
  address?: string
  status: PublicTargetState
  /** Absent when the 24h window holds no verdict — "unknown" is not 0%. */
  availability_24h?: number
}

export interface PublicTargetStatuses {
  generated_at: string
  targets: PublicTargetRow[]
}

/**
 * The page does not exist, is unpublished, or does not show this view — the API
 * answers all three identically on purpose, so this is the only miss there is.
 */
export class NotFoundError extends Error {
  constructor() {
    super('page not found')
    this.name = 'NotFoundError'
  }
}

async function get<T>(path: string): Promise<T> {
  // No credentials: this surface is anonymous, and sending cookies to it would
  // be the one thing that makes the server's wildcard CORS unusable.
  const res = await fetch(apiBase + path, { headers: { Accept: 'application/json' } })
  if (res.status === 404) throw new NotFoundError()
  if (!res.ok) throw new Error(`request failed (${res.status})`)
  return (await res.json()) as T
}

const slugPath = (slug: string) => `/api/v1/public/pages/${encodeURIComponent(slug)}`

export const api = {
  page: (slug: string) => get<PublicPage>(slugPath(slug)),
  agentStatuses: (slug: string) => get<PublicAgentStatuses>(`${slugPath(slug)}/agent-statuses`),
  targetStatuses: (slug: string) => get<PublicTargetStatuses>(`${slugPath(slug)}/target-statuses`),
}
