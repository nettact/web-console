import { describe, it, expect } from 'vitest'
import zh from './zh'
import en from './en'
import { INFO_KINDS, orderOf } from '../lib/metricMeta'

// The overload notice and the packets-sent metric both exist to explain a
// silence: probes the agent's concurrency budget skipped produce no sample, so
// their monitors go stale exactly as they would if the network had gone away.
// A key that falls back to its raw path turns that explanation into noise, and
// nothing else in the suite would notice — the parity test only proves a key
// exists in both files, not that it resolves.

type Dict = Record<string, unknown>
function at(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Dict)?.[key], tree)
}

describe('probe overload copy', () => {
  const keys = [
    'agentStatus.probeOverload',
    'agentStatus.probeOverloadDetail',
    'agentStatus.probeOverloadHint',
    'metrics.metric.probe_icmp_sent',
  ]

  for (const key of keys) {
    it(`${key} resolves in both locales`, () => {
      for (const [name, tree] of [['zh', zh], ['en', en]] as const) {
        const v = at(tree, key)
        expect(typeof v, `${name}.${key} is not a string`).toBe('string')
        expect(String(v).trim(), `${name}.${key} is empty`).not.toBe('')
      }
    })
  }

  // The detail line names both the count and the limit, because the count alone
  // ("skipped 37 probes") gives an operator nothing to act on — the whole point
  // is to name the knob and how far short it fell.
  it('the detail line interpolates both the count and the limit', () => {
    for (const [name, tree] of [['zh', zh], ['en', en]] as const) {
      const s = String(at(tree, 'agentStatus.probeOverloadDetail'))
      expect(s, `${name} detail omits {n}`).toContain('{n}')
      expect(s, `${name} detail omits {limit}`).toContain('{limit}')
    }
  })

  // The hint has to name the setting verbatim: it is the one string a user will
  // search their config file for.
  it('the hint names max_probe_concurrency', () => {
    for (const [name, tree] of [['zh', zh], ['en', en]] as const) {
      expect(
        String(at(tree, 'agentStatus.probeOverloadHint')),
        `${name} hint does not name the setting`,
      ).toContain('max_probe_concurrency')
    }
  })
})

describe('probe.icmp.sent metric classification', () => {
  // On every healthy round it equals the configured packet count, so as a line
  // it is a flat constant. It earns its place as a card, where the round that
  // DIPS is the whole signal.
  it('is an info kind, never a plotted line', () => {
    expect(INFO_KINDS.has('probe.icmp.sent')).toBe(true)
  })

  it('sorts next to the sample count it qualifies', () => {
    expect(orderOf('probe.icmp.sent')).toBe(orderOf('probe.icmp.samples') + 1)
  })
})
