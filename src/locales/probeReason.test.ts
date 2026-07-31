import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import zh from './zh'
import en from './en'

// Failure causes are rendered in two places that sit side by side — a fault's
// bilingual description, which the SERVER writes from its own label tables, and
// the reason chip, which the CONSOLE renders from these locale files. If the two
// drift, one row says "refused by peer" and the chip beside it says something
// else, and the operator cannot tell whether they are looking at one failure or
// two.
//
// This guards the console half: every telemetry.ProbeReason* code the server can
// freeze onto a fault or fluctuation must resolve to a real label in both locales.
// A missing branch renders the raw key, or silently falls back to "other" — which
// reads as a plausible answer while hiding the actual cause.
//
// Kept in step with PROBE_REASON_KEY in composables/useMetricMeta.ts and with
// probeReasonZh/probeReasonEn in server-core/notification/message.go.
const REASON_KEYS = [
  'none',
  'timeout',
  'refused',
  'unreachable',
  'reset',
  'dns',
  'dnsNxdomain',
  'dnsServfail',
  'dnsNoRecord',
  'tls',
  'tlsExpired',
  'tlsUntrusted',
  'tlsHostname',
  'httpStatus',
  'httpKeyword',
  // The 8x family failed on the egress path, never at the target. Rendering these
  // as generic failures would erase the one distinction the proxy feature adds.
  'proxyConnect',
  'proxyAuth',
  'proxyDns',
  'proxyRefused',
  'proxyConfig',
  'other',
]

describe('probe failure reason labels', () => {
  for (const locale of ['zh', 'en'] as const) {
    const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'zh', messages: { zh, en } })
    const t = i18n.global.t as (k: string) => string
    const te = i18n.global.te as (k: string) => boolean
    for (const key of REASON_KEYS) {
      it(`${locale}: resolves metrics.probeReason.${key}`, () => {
        const path = `metrics.probeReason.${key}`
        expect(te(path)).toBe(true)
        expect(t(path)).not.toBe(path)
      })
    }
    it(`${locale}: every reason label is distinct`, () => {
      // Two codes sharing a label makes the chip useless for telling them apart —
      // "proxy refused" and "refused" are different findings.
      const labels = REASON_KEYS.map((k) => t(`metrics.probeReason.${k}`))
      expect(new Set(labels).size).toBe(labels.length)
    })
  }
})
