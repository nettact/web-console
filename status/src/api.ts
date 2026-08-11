// The public status API client.
//
// Deliberately NOT the console's src/api.ts: that one sends credentials, assumes
// a same-origin server and carries the full authenticated type surface. This one
// is anonymous, cross-origin by design, and knows only the four public
// endpoints. The types mirror server-core/statuspage's public DTOs field for
// field — if one gains a field, add it here on purpose.

import { apiBase } from './config'

export interface PublicPage {
  slug: string
  title: string
  description?: string
  show_agent_view: boolean
  show_target_view: boolean
  show_incidents: boolean
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
  /** Absent when the page publishes no resource detail (agent_metrics=off), and
   *  also when the node has never reported any. */
  resources?: PublicResources
}

/**
 * What a published node says about its own load.
 *
 * EVERY field is optional and that is load-bearing, not defensive typing: the
 * host metric families are permission-gated per agent, so a denied family has no
 * samples at all. Render an absent field as a gap — never as 0, which would claim
 * something the server did not say. The byte totals and the mount name arrive
 * only when the page opted into full detail.
 */
export interface PublicResources {
  cpu_pct?: number
  /** [1m, 5m, 15m] load average, in that order. */
  load?: [number, number, number]
  mem_pct?: number
  mem_used?: number
  mem_total?: number
  /** The busiest mount, not the sum of all of them. */
  disk_pct?: number
  disk_used?: number
  disk_total?: number
  disk_mount?: string
  disk_mounts?: number
  rx_bps?: number
  tx_bps?: number
  uptime_s?: number
  /** The node stopped refreshing at least one family; dim the row. */
  stale?: boolean
}

export interface PublicAgentStatuses {
  generated_at: string
  agents: PublicAgentRow[]
}

export type PublicTargetState = 'up' | 'down' | 'degraded' | 'unknown'

/** One window's reliability. Ratio is null when the window reached no verdict at
 *  all — "unknown" and 0% are different answers and must look different. */
export interface PublicAvailability {
  window: string
  ratio: number | null
  rounds: number
}

/** One UTC day's conclusive probe totals. A null ratio with zero rounds is a
 *  genuine gap, not an outage. */
export interface PublicDailyAvailability {
  ratio: number | null
  rounds: number
  ok_rounds: number
}

export interface PublicTargetRow {
  name: string
  /** 1-based position among this page's targets OF THE SAME KIND. */
  ordinal: number
  kind: string
  /** Present only when the page opted into showing addresses. */
  address?: string
  status: PublicTargetState
  /** One entry per published window, always the same set in the same order, so
   *  the board can render fixed columns without looking anything up. */
  availability: PublicAvailability[]
  /** The uptime bar: one summary per UTC day, oldest first. */
  days: PublicDailyAvailability[]
}

export interface PublicTargetStatuses {
  generated_at: string
  /** UTC date (YYYY-MM-DD) of days[0] on every row. */
  days_from: string
  targets: PublicTargetRow[]
}

export type PublicIncidentSubject =
  | { type: 'target'; name: string; ordinal: number; kind: string }
  | { type: 'agent'; name: string; ordinal: number; kind?: never }

/** A deliberately narrow incident record. Internal ids, group names, summaries,
 * attribution, notifications and diagnostics never cross the public boundary. */
export interface PublicIncident {
  state: 'open' | 'resolved'
  impact: 'degraded' | 'outage'
  started_at: string
  resolved_at?: string
  subjects: PublicIncidentSubject[]
}

export interface PublicIncidentHistory {
  generated_at: string
  window_start: string
  incidents: PublicIncident[]
  truncated?: boolean
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

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  // No credentials: this surface is anonymous, and sending cookies to it would
  // be the one thing that makes the server's wildcard CORS unusable.
  //
  // The signal matters more than it looks. Without cancellation a request for a
  // page the reader has already navigated away from keeps running to completion,
  // and since fetch has no timeout of its own, one stalled connection can hold a
  // slot open indefinitely — which is enough to stop the page the reader IS
  // looking at from refreshing.
  const res = await fetch(apiBase + path, { headers: { Accept: 'application/json' }, signal })
  if (res.status === 404) throw new NotFoundError()
  if (!res.ok) throw new Error(`request failed (${res.status})`)
  return (await res.json()) as T
}

const slugPath = (slug: string) => `/api/v1/public/pages/${encodeURIComponent(slug)}`

export const api = {
  page: (slug: string, signal?: AbortSignal) => get<PublicPage>(slugPath(slug), signal),
  agentStatuses: (slug: string, signal?: AbortSignal) =>
    get<PublicAgentStatuses>(`${slugPath(slug)}/agent-statuses`, signal),
  targetStatuses: (slug: string, signal?: AbortSignal) =>
    get<PublicTargetStatuses>(`${slugPath(slug)}/target-statuses`, signal),
  incidents: (slug: string, signal?: AbortSignal) =>
    get<PublicIncidentHistory>(`${slugPath(slug)}/incidents`, signal),
}
