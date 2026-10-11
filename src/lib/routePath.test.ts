import { describe, expect, it } from 'vitest'
import type { ASHop, RouteHopView, RouteResponder } from '../api'
import {
  diffASPaths,
  differingTTLs,
  firstDivergingTTL,
  fmtMs,
  fmtRatio,
  groupHopsByAS,
  humanizeSpan,
  rttDelta,
  rttDeltas,
} from './routePath'

function resp(ip: string, asn: number | null = null): RouteResponder {
  return { ip, hostname: '', asn, as_name: asn ? `Net${asn}` : '', as_country: '', prefix: '' }
}
function hop(ttl: number, ...responders: RouteResponder[]): RouteHopView {
  return { ttl, responders, timeout: responders.length === 0 }
}
const as = (asn: number): ASHop => ({ asn, as_name: `Net${asn}`, as_country: 'US' })

describe('groupHopsByAS', () => {
  it('groups consecutive hops of one AS and alternates bands between groups', () => {
    const rows = groupHopsByAS([
      hop(1, resp('192.168.1.1')),
      hop(2, resp('10.0.0.1', 64500)),
      hop(3, resp('10.0.0.2', 64500)),
      hop(4, resp('20.0.0.1', 64501)),
      hop(5, resp('30.0.0.1', 64502)),
    ])
    expect(rows.map((r) => r.asn)).toEqual([null, 64500, 64500, 64501, 64502])
    expect(rows.map((r) => r.groupStart)).toEqual([true, true, false, true, true])
    expect(rows.map((r) => r.groupEnd)).toEqual([true, false, true, true, true])
    expect(rows.map((r) => r.band)).toEqual([-1, 0, 0, 1, 0])
    expect(rows[1].groupId).toBe(rows[2].groupId)
  })

  it('keeps a silent hop inside the AS that surrounds it', () => {
    const rows = groupHopsByAS([
      hop(1, resp('10.0.0.1', 64500)),
      hop(2),
      hop(3, resp('10.0.0.3', 64500)),
    ])
    expect(rows.map((r) => r.asn)).toEqual([64500, 64500, 64500])
    expect(rows.map((r) => r.groupStart)).toEqual([true, false, false])
  })

  it('leaves a silent hop between two different networks unattributed', () => {
    const rows = groupHopsByAS([
      hop(1, resp('10.0.0.1', 64500)),
      hop(2),
      hop(3, resp('20.0.0.1', 64501)),
    ])
    expect(rows.map((r) => r.asn)).toEqual([64500, null, 64501])
    expect(rows[1].band).toBe(-1)
    expect(rows.map((r) => r.groupStart)).toEqual([true, true, true])
  })

  it('attributes a multi-responder hop by its first responder with an AS', () => {
    const rows = groupHopsByAS([hop(1, resp('192.168.0.1'), resp('10.0.0.1', 64500))])
    expect(rows[0].asn).toBe(64500)
  })
})

describe('diffASPaths', () => {
  it('marks the common backbone same and the swapped carrier removed/added', () => {
    const d = diffASPaths([as(1), as(2), as(3)], [as(1), as(4), as(3)])
    expect(d.from.map((x) => x.state)).toEqual(['same', 'removed', 'same'])
    expect(d.to.map((x) => x.state)).toEqual(['same', 'added', 'same'])
  })

  it('handles an extra network and empty paths', () => {
    const d = diffASPaths([as(1), as(3)], [as(1), as(2), as(3)])
    expect(d.from.map((x) => x.state)).toEqual(['same', 'same'])
    expect(d.to.map((x) => x.state)).toEqual(['same', 'added', 'same'])
    const e = diffASPaths([], [as(1)])
    expect(e.from).toEqual([])
    expect(e.to.map((x) => x.state)).toEqual(['added'])
  })
})

describe('differingTTLs / firstDivergingTTL', () => {
  const before = [hop(1, resp('a')), hop(2, resp('b')), hop(3, resp('c')), hop(4, resp('d'))]

  it('finds TTLs that answer from different addresses, ignoring order', () => {
    const after = [hop(1, resp('a')), hop(2, resp('x'), resp('b')), hop(3, resp('c')), hop(4, resp('d'))]
    expect([...differingTTLs(before, after)]).toEqual([2])
    expect(firstDivergingTTL(before, after)).toBe(2)
  })

  it('does not count a silent hop as a difference', () => {
    const after = [hop(1, resp('a')), hop(2), hop(3, resp('c')), hop(4, resp('d'))]
    expect(differingTTLs(before, after).size).toBe(0)
    expect(firstDivergingTTL(before, after)).toBeNull()
  })

  it('counts a hop present on only one side as a difference', () => {
    const after = [...before, hop(5, resp('e'))]
    expect([...differingTTLs(before, after)]).toEqual([5])
  })

  it("prefers the server's diverge TTL when given", () => {
    expect(firstDivergingTTL(before, before, 3)).toBe(3)
  })
})

describe('formatting', () => {
  it('formats milliseconds with a decimal only below 10 ms', () => {
    expect(fmtMs(3.456)).toBe('3.5 ms')
    expect(fmtMs(42.6)).toBe('43 ms')
    expect(fmtMs(null)).toBe('—')
  })

  it('formats signed RTT deltas with a tone', () => {
    expect(rttDelta(20, 32.4)).toEqual({ text: '+12 ms', tone: 'worse' })
    expect(rttDelta(20, 16.6)).toEqual({ text: '−3.4 ms', tone: 'better' })
    expect(rttDelta(20, 20.4)).toEqual({ text: '±0 ms', tone: 'same' })
    expect(rttDelta(null, 5)).toEqual({ text: '—', tone: 'unknown' })
    const d = rttDeltas(
      { count: 3, min_ms: 1, max_ms: 9, p50_ms: 10, p95_ms: 20 },
      { count: 3, min_ms: 1, max_ms: 9, p50_ms: 15, p95_ms: 18 },
    )
    expect(d.p50.tone).toBe('worse')
    expect(d.p95.tone).toBe('better')
  })

  it('humanizes spans to their two largest parts', () => {
    const u = { d: 'd', h: 'h', m: 'm', lessThanMinute: '<1m' }
    expect(humanizeSpan(30, u)).toBe('<1m')
    expect(humanizeSpan(12 * 60, u)).toBe('12m')
    expect(humanizeSpan(2 * 3600 + 5 * 60, u)).toBe('2h 5m')
    expect(humanizeSpan(3600, u)).toBe('1h')
    expect(humanizeSpan(3 * 86400 + 4 * 3600 + 59 * 60, u)).toBe('3d 4h')
    expect(humanizeSpan(2 * 86400, u)).toBe('2d')
  })

  it('formats a ratio as a whole percentage', () => {
    expect(fmtRatio(0.987)).toBe('99%')
    expect(fmtRatio(undefined)).toBe('—')
  })
})
