// Builds the status/summary stat cards for a target's metrics: the agent-uptime
// "online/offline" card, NAT categorical cards (with a stale-value fallback), the
// boolean availability card, and the numeric min/max/avg card. Extracted from the
// old History view so both the Host Metrics and Target Status pages render cards
// identically.

import type { KindSummary, Sample } from '../api'
import type { Tone } from '../lib/metricMeta'
import { NAT_CODE_KINDS, PROBE_ERROR_KINDS, CLASSIFIER_KINDS, natCodeLabel, natTone, probeReasonTone, fmtNum } from '../lib/metricMeta'
import { availability, countRestarts, toPoints, uptimeOnline } from '../lib/timeline'
import { fmtByUnit, isByteUnit } from '../lib/format'
import { useMetricMeta } from './useMetricMeta'
import { useI18n } from 'vue-i18n'

export interface CardInput {
  label: string
  color: string
  kind: string
  unit: string
  samples: Sample[]
}
export interface Card {
  label: string
  color: string
  value: string
  unit?: string
  foot: string
  tone?: Tone
  small?: boolean
  info?: string // hover-tooltip text (NAT category explanations)
}

export function useMetricCards() {
  const { t } = useI18n()
  const { unitLabel, natInfo, probeReasonLabel, probeReasonInfo, classifierCodeLabel, classifierTone, fmtDur, fmtTime } = useMetricMeta()

  function buildCard(m: CardInput): Card {
    const pts = toPoints(m.samples)
    if (!pts.length) return { label: m.label, color: m.color, value: '—', foot: t('metrics.noDataRange') }
    const now = Date.now()

    if (m.kind === 'agent.uptime_s') {
      const online = uptimeOnline(pts, now)
      return {
        label: m.label,
        color: m.color,
        tone: online ? 'good' : 'bad',
        value: online ? t('metrics.cardOnline') : t('metrics.cardOffline'),
        small: true,
        foot: t('metrics.cardRestartFoot', { n: countRestarts(pts), dur: fmtDur(pts[pts.length - 1].v) }),
      }
    }

    if (NAT_CODE_KINDS.has(m.kind)) {
      // The latest probe can be a transient "unknown" (a lost/rate-limited reply on
      // a flaky STUN server). Fall back to the most recent determinate result so one
      // inconclusive probe doesn't blank out the card; flag it as stale in the foot.
      const last = pts[pts.length - 1]
      let shown = last
      let stale = false
      if (Math.round(last.v) === 0) {
        for (let i = pts.length - 2; i >= 0; i--) {
          if (Math.round(pts[i].v) > 0) {
            shown = pts[i]
            stale = true
            break
          }
        }
      }
      const timeStr = fmtTime(new Date(shown.t).toISOString())
      return {
        label: m.label,
        color: m.color,
        tone: natTone(m.kind, shown.v),
        value: natCodeLabel(m.kind, shown.v),
        small: true,
        info: natInfo(m.kind),
        foot: stale ? t('metrics.nat.footStale', { time: timeStr }) : t('metrics.nat.foot', { time: timeStr }),
      }
    }

    if (PROBE_ERROR_KINDS.has(m.kind)) {
      // The latest failure classification as a labeled card: 0 (none) is healthy,
      // any other class explains the failure. No stale fallback — 0 is a valid
      // determinate "no error", unlike a lost NAT probe.
      const last = pts[pts.length - 1]
      return {
        label: m.label,
        color: m.color,
        tone: probeReasonTone(last.v),
        value: probeReasonLabel(last.v),
        small: true,
        info: probeReasonInfo(),
        foot: t('metrics.nat.foot', { time: fmtTime(new Date(last.t).toISOString()) }),
      }
    }

    if (CLASSIFIER_KINDS.has(m.kind)) {
      // A DEGRADE classifier (size_sweep / flow_fanout): the code is a diagnosis,
      // not a probe failure reason, so it gets its own label/tone (see
      // classifierCodeLabel in useMetricMeta) — routing it through probe reasons
      // would render "Timeout" for a size-correlation verdict.
      const last = pts[pts.length - 1]
      return {
        label: m.label,
        color: m.color,
        tone: classifierTone(m.kind, last.v),
        value: classifierCodeLabel(m.kind, last.v),
        small: true,
        foot: t('metrics.nat.foot', { time: fmtTime(new Date(last.t).toISOString()) }),
      }
    }

    if (m.kind === 'probe.http.connection_reused') {
      const last = pts[pts.length - 1]
      return {
        label: m.label,
        color: m.color,
        value: last.v >= 0.5 ? t('metrics.httpConnectionReused') : t('metrics.httpConnectionNew'),
        small: true,
        foot: t('metrics.httpConnectionFoot', { time: fmtTime(new Date(last.t).toISOString()) }),
      }
    }

    if (m.unit === 'bool') {
      // Current health is server-authoritative (the target-status batch), never
      // inferred from these samples. This card is purely historical: the
      // last-observed raw value with its timestamp, plus range uptime/outages. No
      // current-health tone and no "normal/interrupted" current-state labelling.
      const last = pts[pts.length - 1]
      let downs = 0
      for (let i = 1; i < pts.length; i++) if (pts[i - 1].v >= 0.5 && pts[i].v < 0.5) downs++
      return {
        label: m.label,
        color: m.color,
        value: last.v >= 0.5 ? t('metrics.cardBoolUp') : t('metrics.cardBoolDown'),
        small: true,
        foot: t('metrics.cardBoolFoot', {
          time: fmtTime(new Date(last.t).toISOString()),
          rate: (availability(pts, now) * 100).toFixed(1),
          downs,
        }),
      }
    }

    const vals = pts.map((p) => p.v)
    const sum = vals.reduce((a, b) => a + b, 0)
    // Capacity units (bytes / bps) carry their scaled suffix (MB/GB/…) and time
    // units ('s' → uptime) carry a humanized duration in the value itself, so
    // neither shows a separate unit chip.
    const scaled = isByteUnit(m.unit) || m.unit === 's'
    const vfmt = (v: number) => (isByteUnit(m.unit) ? fmtByUnit(m.unit, v) : m.unit === 's' ? fmtDur(v) : fmtNum(v))
    return {
      label: m.label,
      color: m.color,
      value: vfmt(vals[vals.length - 1]),
      unit: scaled ? undefined : unitLabel(m.unit),
      // The received-sample count is the window/sample-size behind the RTT
      // distribution, so it carries a tooltip explaining what a cycle measures.
      info: m.kind === 'probe.icmp.samples' ? t('metrics.samplesInfo') : undefined,
      foot: t('metrics.cardStatsFoot', {
        min: vfmt(Math.min(...vals)),
        max: vfmt(Math.max(...vals)),
        avg: scaled ? vfmt(sum / vals.length) : (sum / vals.length).toFixed(1),
      }),
    }
  }

  const buildCards = (list: CardInput[]): Card[] => list.map(buildCard)

  // buildSummaryCard renders latest-only diagnostics from raw-summary data.
  // Categorical codes and booleans cannot use /metrics rollup averages: an HTTP
  // 200 followed by 500 is not status 350, and reuse=0.6 is not a connection
  // state. NAT retains its newest-determinate fallback; every other kind uses
  // the exact newest raw observation.
  function buildSummaryCard(m: { label: string; color: string; kind: string }, summary: KindSummary | undefined): Card {
    const latest = summary?.latest
    if (!latest) return { label: m.label, color: m.color, value: '—', foot: t('metrics.noDataRange') }

    if (m.kind === 'probe.http.status') {
      return {
        label: m.label,
        color: m.color,
        value: `HTTP ${Math.round(latest.value)}`,
        small: true,
        foot: t('metrics.latestObservedFoot', { time: fmtTime(latest.ts) }),
      }
    }

    if (m.kind === 'probe.http.connection_reused') {
      return {
        label: m.label,
        color: m.color,
        value: latest.value >= 0.5 ? t('metrics.httpConnectionReused') : t('metrics.httpConnectionNew'),
        small: true,
        foot: t('metrics.latestObservedFoot', { time: fmtTime(latest.ts) }),
      }
    }

    if (NAT_CODE_KINDS.has(m.kind)) {
      // Same transient-"unknown" fallback as buildCard: a lost/rate-limited STUN
      // reply reports code 0; show the most recent determinate result instead
      // and flag it as stale in the foot.
      const fallback = Math.round(latest.value) === 0 ? summary?.latest_nonzero : null
      const shown = fallback ?? latest
      const timeStr = fmtTime(shown.ts)
      return {
        label: m.label,
        color: m.color,
        tone: natTone(m.kind, shown.value),
        value: natCodeLabel(m.kind, shown.value),
        small: true,
        info: natInfo(m.kind),
        foot: fallback ? t('metrics.nat.footStale', { time: timeStr }) : t('metrics.nat.foot', { time: timeStr }),
      }
    }

    // Probe error class: 0 (none) is a valid determinate "no error", so no stale
    // fallback — always the newest value.
    if (PROBE_ERROR_KINDS.has(m.kind)) {
      return {
        label: m.label,
        color: m.color,
        tone: probeReasonTone(latest.value),
        value: probeReasonLabel(latest.value),
        small: true,
        info: probeReasonInfo(),
        foot: t('metrics.nat.foot', { time: fmtTime(latest.ts) }),
      }
    }

    // DEGRADE classifier: its own label/tone (see classifierCodeLabel) — never
    // the probe-reason rendering, which would mislabel the codes.
    return {
      label: m.label,
      color: m.color,
      tone: classifierTone(m.kind, latest.value),
      value: classifierCodeLabel(m.kind, latest.value),
      small: true,
      foot: t('metrics.nat.foot', { time: fmtTime(latest.ts) }),
    }
  }

  return { buildCard, buildCards, buildSummaryCard }
}
