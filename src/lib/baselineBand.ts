// Projecting a learned baseline onto a chart's time axis.
//
// The server learns one band per (weekday|weekend × 6-hour daypart) in ITS local
// time; a chart draws a continuous window. Turning one into the other means
// walking the window in daypart-sized steps and asking which band covers each
// step — which is what this does.
//
// The walk uses the BROWSER's local time. In the overwhelmingly common case the
// browser and the server sit in the same timezone (a desktop app watching its own
// machine, a self-hosted box in the household it monitors), so the boundaries
// line up exactly. Where they do not, the corridor is drawn shifted by the offset
// between them; the detector's own verdicts are unaffected, since those are
// computed server-side against server-local buckets. Correcting it would need the
// server to report its offset, which is a contract change for a cosmetic
// improvement to a case that barely occurs.
import type { DaypartBand, TargetBaseline } from '../api'

// One rectangle of the corridor: a time span and the value range the metric
// normally sat between during it.
export interface BaselineSpan {
  from: number // epoch ms
  to: number // epoch ms
  lo: number
  hi: number
}

const DAYPART_HOURS = 6

// bucketOf mirrors baseline.BucketOf in server-core: which time-of-day class a
// moment belongs to.
export function bucketOf(ts: number): { daypart: number; weekend: boolean } {
  const d = new Date(ts)
  const day = d.getDay()
  return { daypart: Math.floor(d.getHours() / DAYPART_HOURS), weekend: day === 0 || day === 6 }
}

// daypartStart is the local-time start of the daypart containing ts. Built from
// the calendar rather than by rounding the epoch, so a DST transition shifts the
// boundary with the wall clock instead of sliding it an hour off.
function daypartStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(Math.floor(d.getHours() / DAYPART_HOURS) * DAYPART_HOURS, 0, 0, 0)
  return d.getTime()
}

function nextDaypartStart(ts: number): number {
  const d = new Date(daypartStart(ts))
  d.setHours(d.getHours() + DAYPART_HOURS)
  return d.getTime()
}

/**
 * baselineSpans turns a learned baseline into the rectangles a chart can shade
 * over [from, to].
 *
 * A daypart with no band is simply skipped rather than filled from a neighbour:
 * "we have not learned this time of day yet" and "this is what it usually looks
 * like" are different statements, and a corridor drawn from the wrong daypart
 * would be the second one made with the first one's evidence. Consecutive spans
 * sharing the same band are merged so the corridor reads as one shape.
 */
export function baselineSpans(baseline: TargetBaseline | null, from: number, to: number): BaselineSpan[] {
  if (!baseline || baseline.learning || !baseline.bands.length || to <= from) return []
  const byKey = new Map<string, DaypartBand>()
  for (const b of baseline.bands) byKey.set(`${b.weekend ? 1 : 0}:${b.daypart}`, b)

  const out: BaselineSpan[] = []
  // Bound the walk: a chart window is hours to days and one step is six hours, so
  // this runs tens of iterations. The cap only exists so a nonsensical range
  // cannot spin.
  let cursor = daypartStart(from)
  for (let i = 0; cursor < to && i < 400; i++) {
    const end = nextDaypartStart(cursor)
    const { daypart, weekend } = bucketOf(cursor)
    const band = byKey.get(`${weekend ? 1 : 0}:${daypart}`)
    if (band) {
      const spanFrom = Math.max(from, cursor)
      const spanTo = Math.min(to, end)
      const prev = out[out.length - 1]
      if (prev && prev.to === spanFrom && prev.lo === band.p50 && prev.hi === band.p95) {
        prev.to = spanTo
      } else {
        out.push({ from: spanFrom, to: spanTo, lo: band.p50, hi: band.p95 })
      }
    }
    cursor = end
  }
  return out
}
