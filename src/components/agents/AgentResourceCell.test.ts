import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'

import zh from '../../locales/zh'
import en from '../../locales/en'
import type { AgentResources, DiskSample } from '../../api'
import AgentResourceCell from './AgentResourceCell.vue'

// A host with several mounts shows the WORST one as its headline percentage, and
// which mount that is decides whether the number means anything. The case that
// prompted this: an OpenWrt router displayed "peak 100% · 4 disks" while 0.9% of
// its writable space was used — the 100% was a read-only squashfs image, and
// nothing on screen said so. The agent no longer reports read-only mounts, but
// naming the mount is what stops the next unexplained peak from being a mystery.

function mountCell(disk: DiskSample, locale: 'zh' | 'en' = 'en') {
  const resources: AgentResources = { disk } as AgentResources
  return mount(AgentResourceCell, {
    props: { kind: 'disk', resources, now: Date.parse('2026-08-08T00:00:00Z') },
    global: {
      plugins: [createI18n({ legacy: false, locale, fallbackLocale: 'zh', messages: { zh, en } })],
    },
  })
}

const sample = (over: Partial<DiskSample> = {}): DiskSample => ({
  pct: 6.5,
  used: 8404992,
  total: 2172448768,
  mount: '/boot',
  mounts: 2,
  ts: '2026-08-08T00:00:00Z',
  stale: false,
  ...over,
})

describe('AgentResourceCell disk', () => {
  it('names the mount the peak belongs to when there is more than one', () => {
    const text = mountCell(sample()).text()
    expect(text).toContain('6.5%')
    expect(text).toContain('/boot')
    expect(text).toContain('2 disks')
  })

  it('names the mount in Chinese too', () => {
    const text = mountCell(sample(), 'zh').text()
    expect(text).toContain('/boot')
    expect(text).toContain('共 2 盘')
  })

  // A placeholder reaching the DOM means the component stopped passing an
  // interpolation the catalog asks for — which renders as literal braces rather
  // than failing anywhere.
  it('leaves no unresolved interpolation', () => {
    for (const locale of ['en', 'zh'] as const) {
      expect(mountCell(sample(), locale).text()).not.toContain('{')
    }
  })

  // With a single mount the cell shows capacity instead, which is more useful
  // than repeating a mountpoint that is already unambiguous.
  it('shows capacity when there is only one mount', () => {
    const text = mountCell(sample({ mounts: 1, mount: '/' })).text()
    expect(text).toContain('6.5%')
    expect(text).not.toContain('disks')
  })
})
