import { describe, expect, it } from 'vitest'

import {
  HTTP_PRIMARY_NUMERIC_KIND,
  INFO_KINDS,
  LATEST_ONLY_KINDS,
  defaultNumericKinds,
  kindColor,
  orderOf,
  primaryNumericKind,
} from './metricMeta'

const kinds = [
  'probe.http.connect_ms',
  'probe.http.dns_ms',
  'probe.http.latency_ms',
  'probe.http.status',
  'probe.http.tls_ms',
  'probe.http.total_ms',
  'probe.http.ttfb_ms',
]

describe('HTTP metric presentation metadata', () => {
  it('keeps the established latency series as the headline', () => {
    expect(primaryNumericKind('probe.http', kinds)).toBe(HTTP_PRIMARY_NUMERIC_KIND)
    expect(orderOf('probe.http.latency_ms')).toBeLessThan(orderOf('probe.http.connect_ms'))
  })

  it('opens only latency, total and TTFB charts by default', () => {
    expect(defaultNumericKinds('probe.http', kinds)).toEqual([
      'probe.http.latency_ms',
      'probe.http.total_ms',
      'probe.http.ttfb_ms',
    ])
  })

  it('assigns stable distinct colors to HTTP timing phases', () => {
    const timings = ['probe.http.total_ms', 'probe.http.ttfb_ms', 'probe.http.connect_ms', 'probe.http.dns_ms', 'probe.http.tls_ms']
    expect(timings.map(kindColor)).toEqual(['#38bdf8', '#fbbf24', '#34d399', '#818cf8', '#fb923c'])
    expect(new Set(timings.map(kindColor)).size).toBe(timings.length)
  })

  it('treats HTTP status and connection reuse as latest-only diagnostics', () => {
    for (const kind of ['probe.http.status', 'probe.http.connection_reused']) {
      expect(LATEST_ONLY_KINDS.has(kind)).toBe(true)
      expect(INFO_KINDS.has(kind)).toBe(true)
    }
  })
})
