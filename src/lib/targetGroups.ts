// Historical target-chart helpers. Current target health never comes from these
// functions; it remains server-authoritative through targetStatus.ts.

import type { Agent, SeriesInfo } from '../api'

// One Agent that executes a selected monitoring target, plus the metric series
// recorded for that stable target id.
export interface Prober {
  agent: Agent
  series: SeriesInfo[]
}

// The boolean series used to draw the historical state band and calculate
// historical availability. This is explicitly not a current-health decision.
export interface BandSeries {
  kind: string
  toUp: (value: number) => number
}

const asBool = (value: number) => value >= 0.5 ? 1 : 0

export function bandSeriesFor(family: string): BandSeries | null {
  switch (family) {
    case 'probe.icmp':
      return { kind: 'probe.icmp.loss_pct', toUp: (value) => value < 100 ? 1 : 0 }
    case 'probe.dns':
      return { kind: 'probe.dns.ok', toUp: asBool }
    case 'probe.http':
      return { kind: 'probe.http.ok', toUp: asBool }
    case 'probe.tcp':
      return { kind: 'probe.tcp.ok', toUp: asBool }
    case 'probe.nat':
      return { kind: 'probe.nat.ok', toUp: asBool }
    case 'wifi':
      return { kind: 'wifi.up', toUp: asBool }
    default:
      return null
  }
}
