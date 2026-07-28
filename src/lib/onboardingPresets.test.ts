import { describe, it, expect, vi } from 'vitest'
import {
  REGIONS,
  STUN_SERVERS,
  buildSelection,
  defaultStunServer,
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
  it('has the eight expected regions (global is a bucket, not a region)', () => {
    expect(REGIONS.map((r) => r.id)).toEqual(['cn', 'hmt', 'apac', 'eu', 'na', 'sa', 'me', 'af'])
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

  it('no region carries the shared anycast anchors (they live in the global bucket)', () => {
    for (const region of REGIONS) {
      for (const p of region.presets) {
        expect(p.target).not.toBe('1.1.1.1')
        expect(p.target).not.toBe('8.8.8.8')
      }
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

  it('the HK/Macau/Taiwan DNS probe resolves a real domain (not www.hinet.net)', () => {
    const hmt = REGIONS.find((r) => r.id === 'hmt')!
    const dns = hmt.presets.find((p) => p.kind === 'dns')!
    expect(dns.target).not.toBe('www.hinet.net')
    expect(dns.target).toBe('www.pchome.com.tw')
  })
})

describe('NAT STUN server selection', () => {
  it('uses a mainland STUN server only when cn is selected', () => {
    expect(defaultStunServer(['cn', 'apac'])).toBe('stun.miwifi.com')
    expect(natPresetFor(['cn']).target).toBe('stun.miwifi.com')
  })
  it('uses a global STUN server otherwise (miwifi is mainland-only)', () => {
    expect(defaultStunServer(['eu'])).toBe('stun.hot-chilli.net')
    expect(defaultStunServer([])).toBe('stun.hot-chilli.net')
  })
  it('offers both defaults among the selectable servers', () => {
    expect(STUN_SERVERS).toContain('stun.miwifi.com')
    expect(STUN_SERVERS).toContain('stun.hot-chilli.net')
  })
})

describe('buildSelection', () => {
  it('always leads with the local then global buckets', () => {
    const sel = buildSelection([])
    expect(sel.map((g) => g.key)).toEqual(['local', 'global'])
    expect(sel[0].presets.map((p) => p.kind)).toEqual(['gateway', 'nat'])
    const globalTargets = sel[1].presets.map((p) => p.target)
    expect(globalTargets).toContain('1.1.1.1')
    expect(globalTargets).toContain('8.8.8.8')
  })

  it('adds one bucket per selected region, in catalog order', () => {
    const sel = buildSelection(['eu', 'cn'])
    expect(sel.map((g) => g.key)).toEqual(['local', 'global', 'cn', 'eu'])
  })

  it('puts region-specific targets in their own bucket', () => {
    const sel = buildSelection(['apac', 'eu'])
    const apac = sel.find((g) => g.key === 'apac')!
    const eu = sel.find((g) => g.key === 'eu')!
    expect(apac.presets.map((p) => p.target)).toContain('https://derp3e.tailscale.com/generate_204') // Singapore
    expect(eu.presets.map((p) => p.target)).toContain('https://derp4f.tailscale.com/generate_204') // Frankfurt
  })

  it('offers each DERP city as a checked primary plus an unchecked backup', () => {
    const apac = buildSelection(['apac']).find((g) => g.key === 'apac')!
    const primary = apac.presets.find((p) => p.key === 'derp_tokyo')!
    const backup = apac.presets.find((p) => p.key === 'derp_tokyo_b')!
    expect(primary.checked).toBe(true)
    expect(primary.backup).toBeFalsy()
    expect(primary.target).toBe('https://derp7e.tailscale.com/generate_204')
    expect(backup.checked).toBe(false)
    expect(backup.backup).toBe(true)
    expect(backup.target).toBe('https://derp7f.tailscale.com/generate_204')
  })

  it('never repeats the anycast anchors across region buckets', () => {
    const sel = buildSelection(['cn', 'apac', 'eu', 'na'])
    const anchorCount = sel
      .flatMap((g) => g.presets)
      .filter((p) => p.target === '1.1.1.1' || p.target === '8.8.8.8').length
    expect(anchorCount).toBe(2) // both live once, in the global bucket
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
  it('recognizes catalog ids and rejects others (including the removed global)', () => {
    expect(isRegionID('cn')).toBe(true)
    expect(isRegionID('global')).toBe(false)
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

  it('returns null for an unknown zone and non-zh language', () => {
    mockTimeZone('')
    vi.stubGlobal('navigator', { language: 'en-US' })
    expect(detectRegion()).toBeNull()
  })

  it('falls back to cn for zh language when timezone is unknown', () => {
    mockTimeZone('')
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    expect(detectRegion()).toBe('cn')
  })
})
