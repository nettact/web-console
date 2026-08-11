// Display helpers: how a public row turns into the text and colour the page
// renders. Kept framework-free (the translator is passed in) so they can be unit
// tested without mounting anything, matching the console's src/lib convention.

import type { PublicAgentRow, PublicResources, PublicTargetRow, PublicTargetState } from './api'

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
 * Human label for an availability window ("24h", "7d", …). Same fallback shape as
 * kindLabel: the server owns the window list, so a window added there renders as
 * its own token rather than as a missing-translation key.
 */
export function windowLabel(window: string, tr: Tr): string {
  const key = `targets.window.${window}`
  const label = tr(key)
  return label === key ? window : label
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
export function formatAvailability(ratio: number | null | undefined): string | null {
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

// ---- node resource formatting ----
//
// These are deliberate COPIES of the console's src/lib/format.ts rather than
// imports. status/ must not reach into ../src (the console's client is
// session-bound and origin-relative, which is exactly what this app must not be),
// and status/src/theme.ts is already a copy for the same reason. The originals are
// small and stable; duplicating ~20 lines is the cheaper side of that trade.

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** Scales a byte count to KB/MB/GB/… — raw counters are unreadable at this size. */
export function formatBytes(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  const neg = v < 0
  let n = Math.abs(v)
  let i = 0
  while (n >= 1024 && i < BYTE_UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${neg ? '-' : ''}${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${BYTE_UNITS[i]}`
}

/** A throughput rate, from the same scale. */
export const formatBps = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? '—' : `${formatBytes(v)}/s`

/**
 * A percentage reading. Whole numbers: on a status page the difference between
 * 47% and 47.3% memory is noise, unlike an availability ratio where the decimals
 * ARE the story.
 */
export function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${Math.round(v)}%`
}

/** One load-average point, kept separate so the UI can establish 1/5/15 hierarchy. */
export function formatLoadValue(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? '—' : v.toFixed(2)
}

/** Load averages, two decimals, in the 1/5/15 order every tool prints them. */
export function formatLoad(v: PublicResources['load']): string {
  if (!v) return '—'
  return v.map(formatLoadValue).join(' / ')
}

/**
 * Uptime as the largest two units that matter — "12d 4h", "3h 20m", "6m".
 * Seconds are dropped above a minute: a node that has been up for eleven days is
 * not more informative for knowing about the 37 seconds.
 */
export function formatUptime(sec: number | null | undefined, tr: Tr): string {
  if (sec == null || Number.isNaN(sec) || sec < 0) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return tr('res.uptimeDH', { d, h })
  if (h > 0) return tr('res.uptimeHM', { h, m })
  if (m > 0) return tr('res.uptimeM', { m })
  return tr('res.uptimeS', { s: Math.floor(sec) })
}

/** Whether a node reported anything worth drawing a resource row for. */
export function hasResources(r: PublicResources | undefined): boolean {
  if (!r) return false
  return (
    r.cpu_pct != null ||
    r.load != null ||
    r.mem_pct != null ||
    r.disk_pct != null ||
    r.rx_bps != null ||
    r.tx_bps != null ||
    r.uptime_s != null
  )
}

/**
 * Tone for a utilisation percentage, so a node close to full reads as such
 * without the page inventing a threshold per metric. Colour never travels alone:
 * every cell renders its number beside this.
 */
export function usageTone(v: number | null | undefined): 'good' | 'warn' | 'bad' | 'muted' {
  if (v == null || Number.isNaN(v)) return 'muted'
  if (v >= 90) return 'bad'
  if (v >= 75) return 'warn'
  return 'good'
}
