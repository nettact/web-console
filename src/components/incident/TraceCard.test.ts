import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'

import zh from '../../locales/zh'
import en from '../../locales/en'
import type { TraceReportView } from '../../api'
import TraceCard from './TraceCard.vue'

// An in-tunnel report is PINNED to the tunnel whether or not anything was ever
// measured over it: it can be denied by permission, or refuse outright because
// the tunnel was re-keyed. The path note therefore has to describe the plan, and
// the "how to read these hops" guidance has to wait for hops — otherwise a
// refusal renders "this ran hop by hop inside the tunnel" directly above a reason
// saying no probe was ever sent.

function mountCard(report: TraceReportView, locale: 'zh' | 'en' = 'zh') {
  return mount(TraceCard, {
    props: { report },
    global: {
      plugins: [createI18n({ legacy: false, locale, fallbackLocale: 'zh', messages: { zh, en } })],
    },
  })
}

const report = (over: Partial<TraceReportView> = {}): TraceReportView => ({
  report_id: 'trace-1',
  agent_id: 'agent-1',
  agent_name: 'agent-1',
  mode: 'icmp',
  dest_host: '10.9.0.10',
  status: 'succeeded',
  reached: true,
  active_refs: 1,
  started_at: '2026-08-01T12:00:01Z',
  completed_at: '2026-08-01T12:00:04Z',
  received_at: '2026-08-01T12:05:00Z',
  trigger_reason: 'consecutive_failures',
  trigger_streak: 3,
  first_failed_at: '2026-08-01T11:59:30Z',
  subject_kind: 'target',
  path_scope: 'wireguard_inner',
  egress_id: 'prx_wg',
  egress_config_serial: 4,
  hops: [{ ttl: 1, attempts: [{ attempt: 0, addr: '10.9.0.1', rtt_ms: 1.2, timeout: false }] }],
  ...over,
})

describe('TraceCard path scope', () => {
  it('explains how to read the hops only once there are hops', () => {
    const measured = mountCard(report()).text()
    expect(measured).toContain('固定在该 WireGuard 隧道内部执行')
    expect(measured).toContain('最后一个有响应的跳')
    // The inherent AllowedIPs caveat belongs with the hops it explains.
    expect(measured).toContain('AllowedIPs')
  })

  for (const [name, over] of [
    ['refused on a rotated tunnel', { status: 'failed', reason: 'egress_generation_mismatch' }],
    ['refused because the tunnel is gone', { status: 'failed', reason: 'egress_not_available' }],
    ['rejected for a bad attestation', { status: 'failed', reason: 'attestation_mismatch' }],
    ['denied by permission', { status: 'unsupported', reason: 'permission_denied' }],
  ] as const) {
    it(`never claims a path was measured when ${name}`, () => {
      const text = mountCard(report({ ...over, reached: false, hops: [] })).text()
      // The pin is still worth stating — it is what the report is about.
      expect(text).toContain('固定在该 WireGuard 隧道内部执行')
      // ...but nothing may describe hops that do not exist.
      expect(text).not.toContain('最后一个有响应的跳')
      expect(text).not.toContain('AllowedIPs')
    })
  }

  it('says nothing about paths for an ordinary host-stack trace', () => {
    const text = mountCard(report({ path_scope: 'direct', egress_id: undefined })).text()
    expect(text).not.toContain('隧道')
  })

  // The report explains itself or it explains nothing: nobody asked for it, so
  // the trigger is the only record of why it ran.
  it('states why the Agent ran it', () => {
    const zhText = mountCard(report()).text()
    expect(zhText).toContain('连续 3 次失败')
    const enText = mountCard(report(), 'en').text()
    expect(enText).toContain('3 consecutive failures')
  })

  it('keeps the split in English', () => {
    const measured = mountCard(report(), 'en').text()
    expect(measured).toContain('pinned to run inside the WireGuard tunnel')
    expect(measured).toContain('last hop that responded')

    const refused = mountCard(
      report({ status: 'failed', reason: 'egress_generation_mismatch', reached: false, hops: [] }),
      'en',
    ).text()
    expect(refused).toContain('pinned to run inside the WireGuard tunnel')
    expect(refused).not.toContain('last hop that responded')
  })
})
