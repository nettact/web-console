import { describe, it, expect } from 'vitest'
import {
  STATUS_TONE,
  agentRowLabel,
  formatAvailability,
  kindLabel,
  relativeUpdated,
  targetRowLabel,
} from './labels'
import type { PublicAgentRow, PublicTargetRow } from './api'

// A translator that echoes the key when it has no entry — the same shape
// vue-i18n's `te`-guarded lookups take, so the fallback branches are reachable.
const dict: Record<string, string> = {
  'kind.http': 'HTTP(s)',
  'kind.icmp': 'Ping',
  'targets.unnamed': '{kind} target {n}',
  'agents.unnamed': 'Node {n}',
  'updated.justNow': 'updated just now',
  'updated.secondsAgo': 'updated {n}s ago',
  'updated.minutesAgo': 'updated {n}m ago',
  'updated.hoursAgo': 'updated {n}h ago',
}
const tr = (key: string, named?: Record<string, unknown>) => {
  const raw = dict[key]
  if (raw === undefined) return key
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(named?.[k] ?? ''))
}

const target = (over: Partial<PublicTargetRow> = {}): PublicTargetRow => ({
  name: '',
  ordinal: 1,
  kind: 'http',
  status: 'up',
  ...over,
})

describe('targetRowLabel', () => {
  it('prefers the operator-set name', () => {
    expect(targetRowLabel(target({ name: 'Website' }), tr)).toBe('Website')
  })

  // The point of the ordinal: an unnamed target gets a label that is not its
  // address.
  it('builds a kind + ordinal label for an unnamed target', () => {
    expect(targetRowLabel(target({ ordinal: 3 }), tr)).toBe('HTTP(s) target 3')
  })

  it('falls back to the raw kind when there is no translation', () => {
    expect(targetRowLabel(target({ kind: 'quic', ordinal: 2 }), tr)).toBe('QUIC target 2')
  })
})

describe('agentRowLabel', () => {
  const agent = (over: Partial<PublicAgentRow> = {}): PublicAgentRow => ({
    name: '',
    ordinal: 1,
    online: true,
    ...over,
  })

  it('prefers the display name', () => {
    expect(agentRowLabel(agent({ name: 'Alpha' }), tr)).toBe('Alpha')
  })

  it('numbers an unnamed agent', () => {
    expect(agentRowLabel(agent({ ordinal: 2 }), tr)).toBe('Node 2')
  })
})

describe('kindLabel', () => {
  it('translates a known kind', () => {
    expect(kindLabel('icmp', tr)).toBe('Ping')
  })
  it('upper-cases an unknown one instead of showing the key', () => {
    expect(kindLabel('quic', tr)).toBe('QUIC')
  })
})

describe('formatAvailability', () => {
  it('distinguishes no data from zero', () => {
    expect(formatAvailability(undefined)).toBeNull()
    expect(formatAvailability(0)).toBe('0.0%')
  })

  // Near the top of the range the decimals are the whole story; lower down they
  // are noise.
  it('keeps two decimals only where they carry meaning', () => {
    expect(formatAvailability(1)).toBe('100.00%')
    expect(formatAvailability(0.9995)).toBe('99.95%')
    expect(formatAvailability(0.873)).toBe('87.3%')
  })
})

describe('relativeUpdated', () => {
  const now = Date.parse('2026-08-10T12:00:00Z')

  it('scales the unit with the age', () => {
    expect(relativeUpdated('2026-08-10T11:59:57Z', now, tr)).toBe('updated just now')
    expect(relativeUpdated('2026-08-10T11:59:20Z', now, tr)).toBe('updated 40s ago')
    expect(relativeUpdated('2026-08-10T11:45:00Z', now, tr)).toBe('updated 15m ago')
    expect(relativeUpdated('2026-08-10T09:00:00Z', now, tr)).toBe('updated 3h ago')
  })

  // A clock skew between server and viewer must not render "updated -4s ago".
  it('clamps a future timestamp instead of showing negative time', () => {
    expect(relativeUpdated('2026-08-10T12:00:04Z', now, tr)).toBe('updated just now')
  })

  it('renders nothing for an unparseable timestamp', () => {
    expect(relativeUpdated('not-a-time', now, tr)).toBe('')
  })
})

describe('STATUS_TONE', () => {
  // Unknown must not borrow the healthy tone: a page with no data yet would
  // otherwise read as all-green.
  it('maps every state, with unknown kept visually neutral', () => {
    expect(STATUS_TONE).toEqual({ up: 'good', down: 'bad', degraded: 'warn', unknown: 'muted' })
  })
})
