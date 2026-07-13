// Groups an agent's target-status series (probe.*) by MONITOR — one entry per
// user-created monitor (keyed by its monitor_id), plus one per (family, target)
// for monitor-less system series (e.g. iface.up). Shared by the Target Status
// page shell and its grid so both agree on the group list and its keys.

import type { Agent, SeriesInfo } from '../api'
import { familyOf } from './metricMeta'

export interface TargetGroup {
  key: string // `mon:${monitor_id}` for monitors, `${family} ${target}` for system series
  family: string
  familyLabel: string
  target: string
  monitorId?: string // set for user-created monitors
  name?: string // the monitor's display name (from listTargets), when known
  metrics: SeriesInfo[]
}

// One agent that probes a given target, with the series it records for it.
export interface Prober {
  agent: Agent
  series: SeriesInfo[]
}

export function groupKeyOf(s: SeriesInfo): string {
  return s.monitor_id ? `mon:${s.monitor_id}` : `${familyOf(s.kind)} ${s.target}`
}

export function groupTargets(
  series: SeriesInfo[],
  familyLabel: (kind: string) => string,
  monitorNames?: Map<string, string>,
): TargetGroup[] {
  const m = new Map<string, TargetGroup>()
  for (const s of series) {
    const key = groupKeyOf(s)
    let g = m.get(key)
    if (!g) {
      g = {
        key,
        family: familyOf(s.kind),
        familyLabel: familyLabel(s.kind),
        target: s.target,
        monitorId: s.monitor_id || undefined,
        name: s.monitor_id ? monitorNames?.get(s.monitor_id) : undefined,
        metrics: [],
      }
      m.set(key, g)
    }
    g.metrics.push(s)
  }
  return [...m.values()].sort(
    (a, b) =>
      a.familyLabel.localeCompare(b.familyLabel) ||
      (a.name || a.target).localeCompare(b.name || b.target) ||
      a.key.localeCompare(b.key),
  )
}

// The label a group is shown as: the monitor's user-given name, falling back to
// its target string.
export function groupLabel(g: TargetGroup): string {
  return g.name || g.target
}
