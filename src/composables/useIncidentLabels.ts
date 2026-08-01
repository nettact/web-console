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
    // Long-form explanation of a terminal failure reason (why the trace couldn't
    // complete: no admin, DNS failure, timed out, …). Empty when none is defined,
    // so callers can hide the line rather than showing a raw code.
    traceReasonDetail: (r: string) => (r && te(`incidents.trace.reasonDetail.${r}`) ? t(`incidents.trace.reasonDetail.${r}`) : ''),
    modeLabel: (m: string) => tr(`incidents.trace.mode.${m}`, m),
    // Long-form explanation of why a report's mode was auto-switched (e.g. TCP
    // traceroute falling back to ICMP because the Agent lacks admin rights or the
    // grant). Empty when fallback_reason is unset/unknown, so callers can hide it.
    fallbackReasonDetail: (r: string) =>
      r && te(`incidents.trace.fallbackDetail.${r}`) ? t(`incidents.trace.fallbackDetail.${r}`) : '',

    // What a trace diagnosed, when that is not the monitored target itself: the
    // DNS resolver, the egress proxy, a WireGuard peer, the STUN server.
    traceSubjectLabel: (s: string) => tr(`incidents.trace.subject.${s}`, s),
    // Long-form "why this subject" note. Keyed by the subject reason when the
    // server sent one (it distinguishes two WireGuard cases that look identical
    // on the wire), else by the subject kind. Empty when nothing is defined, so
    // callers hide the note instead of showing a bare code.
    traceSubjectDetail: (kind: string, reason: string) => {
      const key = `incidents.trace.subjectDetail.${reason || kind}`
      return kind && kind !== 'target' && te(key) ? t(key) : ''
    },

    // Which PATH a trace was pinned to, when it is not the plain host stack:
    // inside the WireGuard tunnel, or the tunnel's outer (physical) leg.
    // Orthogonal to the subject helpers above — an in-tunnel trace examines the
    // target itself, so the subject badge stays silent and this one speaks.
    tracePathScopeLabel: (s: string) => tr(`incidents.trace.pathScope.${s}`, s),
    // What path this report is PINNED to — true whether or not a probe was ever
    // sent, so it is safe above a reason explaining that none was.
    tracePathScopeDetail: (s: string) =>
      s && te(`incidents.trace.pathScopeDetail.${s}`) ? t(`incidents.trace.pathScopeDetail.${s}`) : '',
    // How to READ hops measured over this path (an in-tunnel trace has its own
    // honest-interpretation rules). Only meaningful once hops exist, which is
    // the caller's gate. Empty when nothing is defined, so callers hide the note
    // instead of showing a bare code.
    tracePathScopeReading: (s: string) =>
      s && te(`incidents.trace.pathScopeReading.${s}`) ? t(`incidents.trace.pathScopeReading.${s}`) : '',

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
