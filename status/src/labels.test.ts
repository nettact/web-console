import { describe, it, expect } from 'vitest'
import {
  STATUS_TONE,
  agentRowLabel,
  formatAvailability,
  formatBps,
  formatBytes,
  formatLoad,
  formatLoadValue,
  formatPct,
  formatUptime,
  hasResources,
  kindLabel,
  relativeUpdated,
  targetRowLabel,
  usageTone,
  windowLabel,
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
  'targets.window.24h': '24h',
  'targets.window.7d': '7 days',
  'res.uptimeDH': '{d}d {h}h',
  'res.uptimeHM': '{h}h {m}m',
  'res.uptimeM': '{m}m',
  'res.uptimeS': '{s}s',
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
  availability: [],
  days: [],
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

describe('windowLabel', () => {
  it('translates a known window', () => {
    expect(windowLabel('24h', tr)).toBe('24h')
    expect(windowLabel('7d', tr)).toBe('7 days')
  })

  // The server owns the window list, so one added there must still render as
  // something a reader understands rather than as a missing-key path.
  it('falls back to the raw token for a window it has no translation for', () => {
    expect(windowLabel('6h', tr)).toBe('6h')
  })
})

describe('resource formatting', () => {
  it('scales byte counts', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(8_160_000_000)).toBe('7.6 GB')
  })

  it('renders a rate as bytes per second', () => {
    expect(formatBps(1_200_000)).toBe('1.1 MB/s')
  })

  // A missing family is a gap, never a zero — the one rule that matters here.
  it('renders absent readings as an em dash rather than zero', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBps(undefined)).toBe('—')
    expect(formatPct(null)).toBe('—')
    expect(formatLoad(undefined)).toBe('—')
    expect(formatUptime(null, tr)).toBe('—')
  })

  it('rounds percentages to whole numbers', () => {
    expect(formatPct(47.4)).toBe('47%')
    expect(formatPct(0)).toBe('0%')
  })

  it('keeps load averages in 1/5/15 order', () => {
    expect(formatLoad([0.42, 0.31, 0.28])).toBe('0.42 / 0.31 / 0.28')
    expect(formatLoadValue(0.42)).toBe('0.42')
    expect(formatLoadValue(Number.NaN)).toBe('—')
  })

  it('formats uptime as the two largest units that matter', () => {
    expect(formatUptime(1_051_200, tr)).toBe('12d 4h')
    expect(formatUptime(12_000, tr)).toBe('3h 20m')
    expect(formatUptime(360, tr)).toBe('6m')
    expect(formatUptime(42, tr)).toBe('42s')
  })
})

describe('hasResources', () => {
  it('is false for nothing reported, true for any single family', () => {
    expect(hasResources(undefined)).toBe(false)
    expect(hasResources({})).toBe(false)
    // stale alone is metadata about readings that do not exist; it is not a reading.
    expect(hasResources({ stale: true })).toBe(false)
    expect(hasResources({ cpu_pct: 3 })).toBe(true)
    expect(hasResources({ uptime_s: 10 })).toBe(true)
  })
})

describe('usageTone', () => {
  it('escalates with utilisation and stays muted without a reading', () => {
    expect(usageTone(10)).toBe('good')
    expect(usageTone(80)).toBe('warn')
    expect(usageTone(95)).toBe('bad')
    expect(usageTone(null)).toBe('muted')
  })
})

describe('formatAvailability', () => {
  // Null is "no verdict in this window". Rendering it as 0% would publish an
  // outage that never happened.
  it('distinguishes no data from zero', () => {
    expect(formatAvailability(null)).toBeNull()
    expect(formatAvailability(undefined)).toBeNull()
    expect(formatAvailability(0)).toBe('0.0%')
  })

  it('keeps two decimals near the top of the range where they carry the story', () => {
    expect(formatAvailability(1)).toBe('100.00%')
    expect(formatAvailability(0.9993)).toBe('99.93%')
    expect(formatAvailability(0.5)).toBe('50.0%')
  })
})
