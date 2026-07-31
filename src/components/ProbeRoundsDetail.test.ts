import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'

import zh from '../locales/zh'
import en from '../locales/en'
import type { ProbeRound } from '../api'
import ProbeRoundsDetail from './ProbeRoundsDetail.vue'

// Every round in this list failed. That makes the probe's own 0/1 success flag a
// trap: four of the five primary metrics are flags whose labels are affirmative
// ("请求成功", "解析成功", "连接成功"), so rendering "<label> <value>" turned a
// failed HTTP round into "请求成功 0" — a reader scanning the breakdown for a cause
// sees the word "成功" next to the failure they are investigating. These pin the
// rule that a success flag is never shown, while a real magnitude still is.

function mountRounds(rounds: ProbeRound[], locale: 'zh' | 'en' = 'zh') {
  return mount(ProbeRoundsDetail, {
    props: { rounds },
    global: {
      plugins: [createI18n({ legacy: false, locale, fallbackLocale: 'zh', messages: { zh, en } })],
    },
  })
}

const round = (over: Partial<ProbeRound> = {}): ProbeRound => ({
  ts: 1_770_000_000,
  metric_kind: 'probe.http.ok',
  value: 0,
  reason_code: 1, // timeout
  reason_detail: 'Get "https://example.test": context deadline exceeded',
  ...over,
})

describe('ProbeRoundsDetail', () => {
  it('never labels a failed round as a success', () => {
    for (const kind of ['probe.http.ok', 'probe.dns.ok', 'probe.tcp.ok', 'probe.nat.ok']) {
      const text = mountRounds([round({ metric_kind: kind })]).text()
      expect(text, `${kind} must not render an affirmative label`).not.toContain('成功')
      // The cause and the raw error are what the row is for, and both survive.
      expect(text).toContain('超时无响应')
      expect(text).toContain('context deadline exceeded')
    }
  })

  it('keeps a magnitude, because 100% loss and 60% loss are different findings', () => {
    const text = mountRounds([
      round({ metric_kind: 'probe.icmp.loss_pct', value: 60, reason_code: 3 }),
    ]).text()
    expect(text).toContain('丢包率')
    expect(text).toContain('60%') // unit included, so the number is not bare
    expect(text).toContain('网络不可达')
  })

  it('still says the round failed when no reason code was reported', () => {
    // Suppressing the flag must not leave a bare timestamp behind.
    const text = mountRounds([
      round({ reason_code: 0, reason_detail: '' }),
    ]).text()
    expect(text).toContain('探测失败')
    expect(text).not.toContain('成功')
  })

  it('lists every round in order, so a changing cause is visible', () => {
    const text = mountRounds([
      round({ ts: 1_770_000_000, reason_code: 1 }), // timeout
      round({ ts: 1_770_000_030, reason_code: 2 }), // refused
    ]).text()
    expect(text).toContain('超时无响应')
    expect(text).toContain('请求被拒绝')
    expect(text.indexOf('超时无响应')).toBeLessThan(text.indexOf('请求被拒绝'))
  })

  it('applies the same rule in English', () => {
    // The English labels read "Request OK" / "Resolve OK" / "Connect OK", so that is
    // the affirmative token to guard against — not the word "succeeded".
    const text = mountRounds([round()], 'en').text()
    expect(text).not.toContain('Request OK')
    expect(text).toContain('Timed out')
    expect(mountRounds([round({ metric_kind: 'probe.dns.ok' })], 'en').text()).not.toContain('Resolve OK')
    expect(mountRounds([round({ metric_kind: 'probe.tcp.ok' })], 'en').text()).not.toContain('Connect OK')
  })
})
