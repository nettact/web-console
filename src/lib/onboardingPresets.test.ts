import { describe, it, expect, vi } from 'vitest'
import {
  REGIONS,
  buildSelection,
  detectRegion,
  natPresetFor,
  presetExists,
  presetToTarget,
  isRegionID,
  type RegionID,
} from './onboardingPresets'
import type { ProbeTarget } from '../api'

const KINDS = new Set(['icmp', 'http', 'dns', 'gateway', 'nat'])

function mockTimeZone(tz: string): void {
  vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
    resolvedOptions: () => ({ timeZone: tz }),
  } as unknown as Intl.DateTimeFormat)
}

describe('catalog invariants', () => {
  it('has the nine expected regions', () => {
    expect(REGIONS.map((r) => r.id)).toEqual(['cn', 'hmt', 'apac', 'eu', 'na', 'sa', 'me', 'af', 'global'])
  })

  it('every preset uses a valid kind and non-empty target/nameKey', () => {
    for (const region of REGIONS) {
      for (const p of region.presets) {
        expect(KINDS.has(p.kind)).toBe(true)
        expect(p.target.length).toBeGreaterThan(0)
        expect(p.nameKey.startsWith('setup.')).toBe(true)
      }
    }
  })

  it('keys are unique within each region', () => {
    for (const region of REGIONS) {
      const keys = region.presets.map((p) => p.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('mainland China never recommends Google/Cloudflare-family targets', () => {
    const cn = REGIONS.find((r) => r.id === 'cn')!
    const blocked = ['1.1.1.1', '8.8.8.8', 'google', 'cloudflare']
    for (const p of cn.presets) {
      for (const bad of blocked) {
        expect(p.target.toLowerCase()).not.toContain(bad)
      }
      expect(p.params?.resolver_server ?? '').not.toContain('8.8.8.8')
    }
  })
})

describe('natPresetFor', () => {
  it('uses a mainland STUN server when cn is selected', () => {
    expect(natPresetFor(['cn', 'apac']).target).toBe('stun.miwifi.com')
  })
  it('uses a global STUN server otherwise', () => {
    expect(natPresetFor(['eu']).target).toBe('stun.hot-chilli.net')
    expect(natPresetFor([]).target).toBe('stun.hot-chilli.net')
  })
})

describe('buildSelection', () => {
  it('always includes the local gateway and nat presets first', () => {
    const sel = buildSelection([])
    expect(sel[0].kind).toBe('gateway')
    expect(sel[1].kind).toBe('nat')
  })

  it('de-duplicates shared anchors across regions', () => {
    const sel = buildSelection(['apac', 'eu'])
    const icmp1111 = sel.filter((p) => p.kind === 'icmp' && p.target === '1.1.1.1')
    expect(icmp1111.length).toBe(1)
  })

  it('keeps region-specific targets from each selected region', () => {
    const sel = buildSelection(['apac', 'eu'])
    const targets = sel.map((p) => p.target)
    expect(targets).toContain('https://www.yahoo.co.jp') // apac
    expect(targets).toContain('https://www.heise.de') // eu
  })

  it('includes only one gateway and one nat regardless of region count', () => {
    const sel = buildSelection(['cn', 'apac', 'eu', 'na'])
    expect(sel.filter((p) => p.kind === 'gateway').length).toBe(1)
    expect(sel.filter((p) => p.kind === 'nat').length).toBe(1)
  })
})

describe('presetExists', () => {
  const existing: ProbeTarget[] = [
    { group_id: 'g', kind: 'icmp', target: '1.1.1.1', enabled: true },
    { group_id: 'g', kind: 'gateway', target: 'gateway', enabled: true },
  ]

  it('matches on kind + trimmed target', () => {
    expect(presetExists(existing, { key: 'x', kind: 'icmp', target: ' 1.1.1.1 ', nameKey: 'setup.x', checked: true })).toBe(
      true,
    )
    expect(presetExists(existing, { key: 'x', kind: 'icmp', target: '9.9.9.9', nameKey: 'setup.x', checked: true })).toBe(
      false,
    )
  })

  it('matches gateway/nat on kind alone', () => {
    expect(
      presetExists(existing, { key: 'gw', kind: 'gateway', target: 'anything', nameKey: 'setup.x', checked: true }),
    ).toBe(true)
    expect(
      presetExists(existing, { key: 'nat', kind: 'nat', target: 'stun.example.com', nameKey: 'setup.x', checked: true }),
    ).toBe(false)
  })
})

describe('presetToTarget', () => {
  it('produces an enabled target in the given group with the resolved name', () => {
    const t = presetToTarget(
      { key: 'x', kind: 'dns', target: 'www.example.com', nameKey: 'setup.x', params: { resolver_server: '1.1.1.1' }, checked: true },
      'grp1',
      'My DNS',
    )
    expect(t).toEqual({
      group_id: 'grp1',
      kind: 'dns',
      name: 'My DNS',
      target: 'www.example.com',
      params: { resolver_server: '1.1.1.1' },
      enabled: true,
    })
  })

  it('defaults params to an empty object', () => {
    const t = presetToTarget({ key: 'g', kind: 'gateway', target: 'gateway', nameKey: 'setup.g', checked: true }, 'grp1', 'GW')
    expect(t.params).toEqual({})
  })
})

describe('isRegionID', () => {
  it('recognizes catalog ids and rejects others', () => {
    expect(isRegionID('cn')).toBe(true)
    expect(isRegionID('nope')).toBe(false)
  })
})

describe('detectRegion', () => {
  const cases: Array<[string, RegionID]> = [
    ['Asia/Shanghai', 'cn'],
    ['Asia/Hong_Kong', 'hmt'],
    ['Asia/Dubai', 'me'], // middle-east checked before generic Asia
    ['Asia/Tokyo', 'apac'],
    ['Europe/Berlin', 'eu'],
    ['Africa/Johannesburg', 'af'],
    ['America/Sao_Paulo', 'sa'], // south-america checked before generic America
    ['America/Manaus', 'sa'], // Brazil zone that isn't Sao_Paulo
    ['America/Recife', 'sa'],
    ['America/Bogota', 'sa'],
    ['America/Argentina/Buenos_Aires', 'sa'],
    ['America/New_York', 'na'],
    ['America/Chicago', 'na'],
    ['Pacific/Auckland', 'apac'],
  ]
  for (const [tz, expected] of cases) {
    it(`maps ${tz} → ${expected}`, () => {
      mockTimeZone(tz)
      expect(detectRegion()).toBe(expected)
    })
  }

  it('falls back to language when timezone is unknown', () => {
    mockTimeZone('')
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    expect(detectRegion()).toBe('cn')
    vi.stubGlobal('navigator', { language: 'en-US' })
    expect(detectRegion()).toBe('global')
  })
})
