// Display helpers: how a public row turns into the text and colour the page
// renders. Kept framework-free (the translator is passed in) so they can be unit
// tested without mounting anything, matching the console's src/lib convention.

import type { PublicAgentRow, PublicTargetRow, PublicTargetState } from './api'

type Tr = (key: string, named?: Record<string, unknown>) => string

/** Semantic tone per public status. Colour NEVER travels alone — every badge
 *  renders this tone together with its translated label. */
export const STATUS_TONE: Record<PublicTargetState, 'good' | 'bad' | 'warn' | 'muted'> = {
  up: 'good',
  down: 'bad',
  degraded: 'warn',
  unknown: 'muted',
}

/** Human label for a target's protocol kind, falling back to the raw kind
 *  upper-cased so a kind added server-side still renders as something. */
export function kindLabel(kind: string, tr: Tr): string {
  const key = `kind.${kind}`
  const label = tr(key)
  return label === key ? kind.toUpperCase() : label
}

/**
 * What to call a published target. Named targets use their name; unnamed ones
 * become "HTTP target 3" — a label built from the kind and the server's stable
 * per-kind ordinal, because the raw address is exactly what an unnamed target
 * would otherwise leak.
 */
export function targetRowLabel(row: PublicTargetRow, tr: Tr): string {
  if (row.name) return row.name
  return tr('targets.unnamed', { kind: kindLabel(row.kind, tr), n: row.ordinal })
}

/** What to call a published agent. Never the hostname — the API does not send
 *  one, and an unnamed agent is "Node 2". */
export function agentRowLabel(row: PublicAgentRow, tr: Tr): string {
  return row.name || tr('agents.unnamed', { n: row.ordinal })
}

/**
 * Formats a 0..1 availability ratio as a percentage. Returns null when the
 * server sent nothing: no verdict in the window is "unknown", which must look
 * different from 0%.
 */
export function formatAvailability(ratio: number | undefined): string | null {
  if (ratio === undefined || ratio === null || Number.isNaN(ratio)) return null
  const pct = ratio * 100
  // Two decimals near the top of the range, where the difference between 100%
  // and 99.95% is the whole story; one below it, where it is noise.
  return `${pct >= 99 ? pct.toFixed(2) : pct.toFixed(1)}%`
}

/** Relative "updated Ns ago" line, chosen so the page visibly keeps up. */
export function relativeUpdated(fromISO: string, now: number, tr: Tr): string {
  const then = Date.parse(fromISO)
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((now - then) / 1000))
  if (secs < 10) return tr('updated.justNow')
  if (secs < 60) return tr('updated.secondsAgo', { n: secs })
  if (secs < 3600) return tr('updated.minutesAgo', { n: Math.floor(secs / 60) })
  return tr('updated.hoursAgo', { n: Math.floor(secs / 3600) })
}
