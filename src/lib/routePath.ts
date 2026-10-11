// Pure helpers behind the route-monitor views: grouping a hop table by
// autonomous system, diffing two AS paths, finding where two hop lists part
// ways, and the compact number/duration formats those views print. Nothing here
// touches i18n or Vue; callers pass translated unit strings in where needed.

import type { ASHop, RouteHopView, RouteRTT } from '../api'

// The AS a hop is attributed to: the first responder that has one. A TTL that
// answered from several addresses (load balancing) almost always stays inside a
// single AS, and when it does not the first answer is as good a label as any —
// the full responder list is still rendered beside it.
export function hopASN(hop: RouteHopView): number | null {
  for (const r of hop.responders) if (r.asn != null) return r.asn
  return null
}

export interface GroupedHop {
  hop: RouteHopView
  // The AS this row is shown under; null when no responder had one and the row
  // could not be attributed to a neighbouring run either.
  asn: number | null
  // Rows with the same groupId sit in one visual block.
  groupId: number
  groupStart: boolean
  groupEnd: boolean
  // Alternates per AS-attributed group so adjacent blocks are distinguishable;
  // unattributed rows always get band -1 (no tint).
  band: number
}

// Groups consecutive hops crossing the same AS into one block.
//
// A hop with no ASN — a timeout, or a private/unannounced address — would split
// every carrier run that has one silent router in the middle into two blocks of
// the same AS, which reads as "left the network and came back". So such hops
// join the block around them when the hops on BOTH sides belong to the same AS,
// and otherwise stand alone, unattributed. Inferring an AS for the gap is a
// display choice only; the row still shows "*" or its private address.
export function groupHopsByAS(hops: RouteHopView[]): GroupedHop[] {
  const own = hops.map(hopASN)
  const resolved: (number | null)[] = own.slice()
  for (let i = 0; i < hops.length; i++) {
    if (own[i] != null) continue
    let prev: number | null = null
    for (let j = i - 1; j >= 0; j--) if (own[j] != null) { prev = own[j]; break }
    let next: number | null = null
    for (let j = i + 1; j < hops.length; j++) if (own[j] != null) { next = own[j]; break }
    resolved[i] = prev != null && prev === next ? prev : null
  }
  const out: GroupedHop[] = []
  let groupId = -1
  let band = -1
  let asGroups = 0
  for (let i = 0; i < hops.length; i++) {
    const asn = resolved[i]
    const sameAsPrev = i > 0 && asn != null && resolved[i - 1] === asn
    if (!sameAsPrev) {
      groupId++
      if (asn != null) band = asGroups++ % 2
    }
    out.push({
      hop: hops[i],
      asn,
      groupId,
      groupStart: !sameAsPrev,
      groupEnd: false,
      band: asn == null ? -1 : band,
    })
  }
  for (let i = 0; i < out.length; i++) {
    out[i].groupEnd = i === out.length - 1 || out[i + 1].groupId !== out[i].groupId
  }
  return out
}

export type DiffState = 'same' | 'removed' | 'added'
export interface DiffItem {
  hop: ASHop
  state: DiffState
}

// Longest-common-subsequence diff of two AS paths by ASN. `from` items absent
// from the new path are 'removed', `to` items absent from the old one 'added';
// the common backbone stays 'same'. AS paths are short (rarely over a dozen),
// so the quadratic table is fine.
export function diffASPaths(from: ASHop[], to: ASHop[]): { from: DiffItem[]; to: DiffItem[] } {
  const n = from.length
  const m = to.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = from[i].asn === to[j].asn ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    }
  }
  const keepFrom = new Set<number>()
  const keepTo = new Set<number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (from[i].asn === to[j].asn) {
      keepFrom.add(i)
      keepTo.add(j)
      i++
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return {
    from: from.map((hop, k) => ({ hop, state: keepFrom.has(k) ? 'same' : 'removed' })),
    to: to.map((hop, k) => ({ hop, state: keepTo.has(k) ? 'same' : 'added' })),
  }
}

// The set of addresses that answered at a hop, order-independent.
function responderKey(hop: RouteHopView | undefined): string {
  if (!hop || hop.timeout || !hop.responders.length) return ''
  return hop.responders.map((r) => r.ip).sort().join(',')
}

// TTLs at which two paths answer differently. A TTL that timed out on either
// side is not counted: a silent router is not evidence of a different one.
export function differingTTLs(before: RouteHopView[], after: RouteHopView[]): Set<number> {
  const b = new Map(before.map((h) => [h.ttl, h]))
  const a = new Map(after.map((h) => [h.ttl, h]))
  const out = new Set<number>()
  for (const ttl of new Set([...b.keys(), ...a.keys()])) {
    const kb = responderKey(b.get(ttl))
    const ka = responderKey(a.get(ttl))
    if (!kb || !ka) {
      // One side has the TTL with answers and the other has no such TTL at all:
      // the paths have different lengths, which is a difference.
      if ((kb && !a.has(ttl)) || (ka && !b.has(ttl))) out.add(ttl)
      continue
    }
    if (kb !== ka) out.add(ttl)
  }
  return out
}

// First TTL where two paths part ways: the server's own figure when it gave one,
// otherwise the lowest differing TTL computed here. null when they agree.
export function firstDivergingTTL(
  before: RouteHopView[],
  after: RouteHopView[],
  serverTTL?: number | null,
): number | null {
  if (serverTTL != null && serverTTL > 0) return serverTTL
  const d = [...differingTTLs(before, after)]
  return d.length ? Math.min(...d) : null
}

// Milliseconds as the views print them: one decimal under 10 ms (where the
// decimal is the signal), whole numbers above.
export function fmtMs(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  return `${a < 10 ? v.toFixed(1) : Math.round(v)} ms`
}

export type DeltaTone = 'worse' | 'better' | 'same' | 'unknown'
export interface RTTDelta {
  text: string // "+12 ms" / "−3.4 ms" / "±0 ms" / "—"
  tone: DeltaTone
}

// Below this a latency shift is measurement noise for a traceroute-grade figure.
const RTT_NOISE_MS = 1

// Signed change from before to after. Higher latency is 'worse'.
export function rttDelta(before: number | null | undefined, after: number | null | undefined): RTTDelta {
  if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) {
    return { text: '—', tone: 'unknown' }
  }
  const d = after - before
  if (Math.abs(d) < RTT_NOISE_MS) return { text: '±0 ms', tone: 'same' }
  const a = Math.abs(d)
  const num = a < 10 ? a.toFixed(1) : String(Math.round(a))
  return { text: `${d > 0 ? '+' : '−'}${num} ms`, tone: d > 0 ? 'worse' : 'better' }
}

// Convenience for the change timeline: p50 and p95 deltas side by side.
export function rttDeltas(before: RouteRTT | null, after: RouteRTT | null): { p50: RTTDelta; p95: RTTDelta } {
  return {
    p50: rttDelta(before?.p50_ms, after?.p50_ms),
    p95: rttDelta(before?.p95_ms, after?.p95_ms),
  }
}

export interface SpanUnits {
  d: string
  h: string
  m: string
  lessThanMinute: string
}

// A span in seconds as its two most significant parts: "3d 4h", "2h 5m", "12m".
// Units are passed in so the caller can localize them ("3天 4小时").
export function humanizeSpan(seconds: number, u: SpanUnits): string {
  if (!Number.isFinite(seconds) || seconds < 60) return u.lessThanMinute
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}${u.d} ${h}${u.h}` : `${d}${u.d}`
  if (h > 0) return m > 0 ? `${h}${u.h} ${m}${u.m}` : `${h}${u.h}`
  return `${m}${u.m}`
}

// "AS13335" — the canonical short form.
export const asLabel = (asn: number | null | undefined): string => (asn == null ? '' : `AS${asn}`)

// Share 0..1 as a whole percentage.
export function fmtRatio(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '—'
  return `${Math.round(r * 100)}%`
}

// The interval presets the monitor form offers for a route monitor, in seconds.
// 0 is "the default" (ten minutes) and is what a fresh monitor stores.
export const TRACE_INTERVAL_DEFAULT_S = 600
export const TRACE_INTERVAL_MIN_S = 300
export const TRACE_INTERVAL_PRESETS = [TRACE_INTERVAL_DEFAULT_S, 1800] as const
