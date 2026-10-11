import type { ASNTableStatus } from '../api'

// Pure presentation mapping for the Settings page's IP→ASN table panel. Kept out
// of the component so the state precedence is testable without mounting it.

export type ASNBadgeTone = 'ok' | 'warn' | 'neutral'

export interface ASNBadge {
  tone: ASNBadgeTone
  // Locale key under settings.asnTable.
  key: 'statusOff' | 'statusChecking' | 'statusLoaded' | 'statusNotLoaded'
}

// Precedence: "off" wins (nothing can be checking or loaded there), then an
// in-flight check — a refresh of an already loaded table still says "checking",
// because that is the thing about to change — then loaded / not loaded.
export function asnBadge(s: Pick<ASNTableStatus, 'mode' | 'checking' | 'loaded'>): ASNBadge {
  if (s.mode === 'off') return { tone: 'neutral', key: 'statusOff' }
  if (s.checking) return { tone: 'neutral', key: 'statusChecking' }
  if (s.loaded) return { tone: 'ok', key: 'statusLoaded' }
  return { tone: 'warn', key: 'statusNotLoaded' }
}

export function asnModeKey(mode: ASNTableStatus['mode']): 'modeFile' | 'modeManaged' | 'modeOff' {
  if (mode === 'file') return 'modeFile'
  if (mode === 'managed') return 'modeManaged'
  return 'modeOff'
}

// Explanation shown while no table is loaded, per mode; null once one is loaded.
// "off" always explains how to turn it on — there is never a loaded table there.
export function asnExplanationKey(
  s: Pick<ASNTableStatus, 'mode' | 'loaded'>,
): 'explainOff' | 'explainManaged' | 'explainFile' | null {
  if (s.mode === 'off') return 'explainOff'
  if (s.loaded) return null
  return s.mode === 'managed' ? 'explainManaged' : 'explainFile'
}

// Signed distance of a timestamp from `now`, in whole seconds, so one helper can
// phrase both "3h ago" and "in 5h". Null when the value is missing or unparsable.
export function asnRelative(
  value: string | null | undefined,
  now: number,
): { seconds: number; future: boolean } | null {
  if (!value) return null
  const t = Date.parse(value)
  if (Number.isNaN(t)) return null
  const diff = (t - now) / 1000
  return { seconds: Math.abs(diff), future: diff > 0 }
}

// Range count with locale thousands separators ("1,234,567").
export function fmtCount(n: number, locale: string): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat(locale).format(n)
}
