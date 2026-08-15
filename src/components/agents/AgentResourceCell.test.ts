import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'

import zh from '../../locales/zh'
import en from '../../locales/en'
import type { AgentResources, DiskSample } from '../../api'
import AgentResourceCell from './AgentResourceCell.vue'

// A current server supplies both the released peak-mount fields and the new
// capacity-weighted aggregate. The cell leads with the aggregate and labels its
// summed capacity, but can still render truthfully while paired with an older
// server that only knows the peak.

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
  aggregate_pct: 0.4,
  used: 8404992,
  total: 2172448768,
  mount: '/boot',
  mounts: 2,
  ts: '2026-08-08T00:00:00Z',
  stale: false,
  ...over,
})

describe('AgentResourceCell disk', () => {
  it('shows aggregate usage and summed capacity when there is more than one disk', () => {
    const text = mountCell(sample()).text()
    expect(text).toContain('0.4%')
    expect(text).toContain('8.0 MB / 2.0 GB')
    expect(text).toContain('2 disks')
    expect(text).not.toContain('/boot')
    expect(text).not.toContain('6.5%')
  })

  it('labels the aggregate disk count in Chinese too', () => {
    const text = mountCell(sample(), 'zh').text()
    expect(text).toContain('0.4%')
    expect(text).toContain('共 2 盘')
  })

  it('falls back to the labeled peak when paired with an older server', () => {
    const text = mountCell(sample({ aggregate_pct: undefined })).text()
    expect(text).toContain('6.5%')
    expect(text).toContain('/boot')
    expect(text).toContain('peak')
  })

  it('keeps a present zero aggregate instead of falling back to the peak', () => {
    const text = mountCell(sample({ aggregate_pct: 0 })).text()
    expect(text).toContain('0%')
    expect(text).not.toContain('6.5%')
    expect(text).not.toContain('peak')
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
    expect(text).toContain('0.4%')
    expect(text).toContain('8.0 MB / 2.0 GB')
    expect(text).not.toContain('disks')
  })
})
