// Localized labels for the server-emitted incident / snapshot / traceroute
// enums, reasons and timeline kinds. Every helper falls back to the raw server
// code when a translation is missing, so a newly-added server code degrades to a
// visible token instead of a blank. Shared by the incident detail, snapshot and
// trace components so the vocabulary stays in one place.
import { useI18n } from 'vue-i18n'

// Comparator → math symbol (locale-independent; a screen-reader label is provided
// separately via comparatorLabel).
const CMP_SYMBOL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' }

export function useIncidentLabels() {
  const { t, te } = useI18n()
  // Translate `key`, else show the raw code (or an em dash when empty).
  const tr = (key: string, raw: string) => (raw && te(key) ? t(key) : raw || '—')

  return {
    sevLabel: (s: string) => tr(`mform.sev_${s}`, s),
    layerLabel: (l: string) => tr(`incidents.layer.${l}`, l),
    // Timeline kinds are dotted (e.g. "alert.raised") → nested i18n path.
    kindLabel: (k: string) => (k && te(`incidents.kind.${k}`) ? t(`incidents.kind.${k}`) : k),

    // Incident resolution reason (recovered vs configuration_changed).
    resolveReasonLabel: (r: string) => tr(`incidents.resolveReason.${r}`, r),

    // Snapshot overall / per-entry status and per-field-group outcome.
    snapStatusLabel: (s: string) => tr(`incidents.snap.status.${s}`, s),
    groupStatusLabel: (s: string) => tr(`incidents.snap.groupStatus.${s}`, s),
    fieldGroupLabel: (g: string) => tr(`incidents.snap.group.${g}`, g),
    // Stable snapshot reason codes (per group and per entry).
    snapReasonLabel: (r: string) => tr(`incidents.snap.reason.${r}`, r),

    // Traceroute status / stable reason / mode.
    traceStatusLabel: (s: string) => tr(`incidents.trace.status.${s}`, s),
    traceReasonLabel: (r: string) => tr(`incidents.trace.reason.${r}`, r),
    modeLabel: (m: string) => tr(`incidents.trace.mode.${m}`, m),

    // Evidence comparator, as symbol (compact) and as words (accessible).
    comparatorSymbol: (c: string) => CMP_SYMBOL[c] ?? c,
    comparatorLabel: (c: string) => tr(`incidents.cmp.${c}`, c),
    errorClassLabel: (c: string) => tr(`incidents.snap.errorClass.${c}`, c),
  }
}

// Map a status/severity to a tone class (color-independent text is always shown
// alongside). success = healthy/complete, danger = open/failed, warn = partial.
export function statusTone(status: string): 'ok' | 'warn' | 'open' | 'neutral' {
  switch (status) {
    case 'complete':
    case 'succeeded':
    case 'resolved':
      return 'ok'
    case 'partial':
    case 'collecting':
    case 'queued':
    case 'running':
      return 'warn'
    case 'failed':
    case 'timed_out':
    case 'unsupported':
    case 'canceled':
    case 'open':
      return 'open'
    default:
      return 'neutral'
  }
}

// Severity → tone. info is neutral, warn is warn, error/critical are danger.
export function severityTone(sev: string): 'ok' | 'warn' | 'open' | 'neutral' {
  switch (sev) {
    case 'warn':
      return 'warn'
    case 'error':
    case 'critical':
      return 'open'
    default:
      return 'neutral'
  }
}
