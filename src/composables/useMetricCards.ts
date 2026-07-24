// Builds the status/summary stat cards for a target's metrics: the agent-uptime
// "online/offline" card, NAT categorical cards (with a stale-value fallback), the
// boolean availability card, and the numeric min/max/avg card. Extracted from the
// old History view so both the Host Metrics and Target Status pages render cards
// identically.

import type { KindSummary, Sample } from '../api'
import type { Tone } from '../lib/metricMeta'
import { NAT_CODE_KINDS, TCP_ERROR_KIND, natCodeLabel, natTone, tcpErrorTone, fmtNum } from '../lib/metricMeta'
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
  const { unitLabel, natInfo, tcpErrorLabel, tcpErrorInfo, fmtDur, fmtTime } = useMetricMeta()

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

    if (m.kind === TCP_ERROR_KIND) {
      // The latest connect classification as a labeled card: 0 (none) is healthy,
      // any other class explains the failure. No stale fallback — 0 is a valid
      // determinate "no error", unlike a lost NAT probe.
      const last = pts[pts.length - 1]
      return {
        label: m.label,
        color: m.color,
        tone: tcpErrorTone(last.v),
        value: tcpErrorLabel(last.v),
        small: true,
        info: tcpErrorInfo(),
        foot: t('metrics.nat.foot', { time: fmtTime(new Date(last.t).toISOString()) }),
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

  // buildCodeCard renders a categorical code card (NAT / TCP error class) from a
  // server-side KindSummary instead of a raw sample window: these cards only
  // need the newest value (plus, for NAT, the newest determinate value as the
  // stale fallback), so fetching thousands of samples per agent just to read the
  // last one was pure waste (PERF-001 follow-up). Mirrors buildCard's NAT/TCP
  // branches exactly.
  function buildCodeCard(m: { label: string; color: string; kind: string }, summary: KindSummary | undefined): Card {
    const latest = summary?.latest
    if (!latest) return { label: m.label, color: m.color, value: '—', foot: t('metrics.noDataRange') }

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

    // TCP error class: 0 (none) is a valid determinate "no error", so no stale
    // fallback — always the newest value.
    return {
      label: m.label,
      color: m.color,
      tone: tcpErrorTone(latest.value),
      value: tcpErrorLabel(latest.value),
      small: true,
      info: tcpErrorInfo(),
      foot: t('metrics.nat.foot', { time: fmtTime(latest.ts) }),
    }
  }

  return { buildCard, buildCards, buildCodeCard }
}
