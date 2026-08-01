// i18n-bound metric label/formatting helpers, shared by the Host Metrics and
// Target Status pages and their components. Pure metadata (colors, families, NAT
// codes) lives in lib/metricMeta.ts; anything that needs translations or the
// active locale lives here. Extracted from the old History view.

import { useI18n } from 'vue-i18n'
import { toDateLocale } from '../i18n'
import type { Tone } from '../lib/metricMeta'
import { familyOf } from '../lib/metricMeta'

// Family/metric labels live in i18n (metrics.family.* / metrics.metric.*) keyed
// with dots swapped for underscores; unknown keys fall back to the raw value.
export function useMetricMeta() {
  const { t, te, locale } = useI18n()

  const familyLabel = (kind: string) => {
    const fam = familyOf(kind)
    const key = `metrics.family.${fam.replace(/\./g, '_')}`
    return te(key) ? t(key) : fam
  }

  const metricLabel = (k: string) => {
    const key = `metrics.metric.${k.replace(/\./g, '_')}`
    return te(key) ? t(key) : k
  }

  // bytes / bps are formatted with scaled units (MB/GB/…) via fmtByUnit, not here.
  const UNIT_LABEL: Record<string, string> = { ms: 'ms', pct: '%', code: '', bool: '', count: '', load: '', dbm: 'dBm', mbps: 'Mbps', c: '°C' }
  const unitLabel = (u: string) => (u === 's' ? t('chart.unitSec') : UNIT_LABEL[u] ?? u)

  // natInfo returns the localized description of a NAT card's categories, shown in
  // the hover tooltip beside the (English) value.
  const natInfo = (kind: string) => {
    if (kind === 'probe.nat.type') return t('metrics.nat.infoType')
    if (kind === 'probe.nat.filtering') return t('metrics.nat.infoFiltering')
    return t('metrics.nat.infoMapping')
  }

  // probeReasonLabel maps a probe.*.error_class code (telemetry.ProbeReason*) to its
  // localized reason, shared by the TCP error-class card and the alert-evidence
  // reason chip; probeReasonInfo is the hover tooltip explaining the categories.
  // Single-digit codes are failure families; 4x = DNS, 5x = TLS, 7x = HTTP-acceptance
  // refinements. Unknown codes fall back to 'other'.
  const PROBE_REASON_KEY: Record<number, string> = {
    0: 'none', 1: 'timeout', 2: 'refused', 3: 'unreachable', 4: 'dns', 5: 'tls', 6: 'reset', 9: 'other',
    41: 'dnsNxdomain', 42: 'dnsServfail', 43: 'dnsNoRecord',
    51: 'tlsExpired', 52: 'tlsUntrusted', 53: 'tlsHostname',
    71: 'httpStatus', 72: 'httpKeyword',
    // The 8x family failed on the EGRESS PATH, never at the target. Rendering these
    // as generic failures would erase the one distinction the proxy feature adds.
    81: 'proxyConnect', 82: 'proxyAuth', 83: 'proxyDns', 84: 'proxyRefused', 85: 'proxyConfig',
  }
  const probeReasonLabel = (code: number) => t(`metrics.probeReason.${PROBE_REASON_KEY[Math.round(code)] ?? 'other'}`)
  const probeReasonInfo = () => t('metrics.probeReason.info')

  const SEV_TONE: Record<string, Tone> = { critical: 'bad', warning: 'bad', info: 'unknown' }
  const sevTone = (s: string): Tone => SEV_TONE[s] || 'unknown'
  const sevLabel = (s: string) => {
    const key = `metrics.sev.${s}`
    return te(key) ? t(key) : s
  }

  function fmtDur(sec: number): string {
    if (sec < 90) return t('common.durSeconds', { n: Math.round(sec) })
    const m = sec / 60
    if (m < 90) return t('common.durMinutes', { n: Math.round(m) })
    const h = sec / 3600
    if (h < 48) return t('common.durHours', { n: h.toFixed(1) })
    return t('common.durDays', { n: (h / 24).toFixed(1) })
  }
  const fmtTime = (s: string) => new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false })

  return { familyLabel, metricLabel, unitLabel, natInfo, probeReasonLabel, probeReasonInfo, sevTone, sevLabel, fmtDur, fmtTime }
}
