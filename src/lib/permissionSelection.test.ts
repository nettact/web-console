import { describe, expect, it } from 'vitest'

import type { PermissionCatalogEntry } from '../api'
import {
  deselectWithDependents,
  groupCatalog,
  orderedSelection,
  permissionGroup,
  platformSupport,
  privilegeCanEnable,
  sameSelection,
  selectWithDependencies,
} from './permissionSelection'

const CATALOG: PermissionCatalogEntry[] = [
  { id: 'probe.icmp', default: true },
  { id: 'probe.http', default: true },
  { id: 'probe.http.extended', default: false, requires: ['probe.http'], implies: ['probe.http'] },
  { id: 'network.interface.status.read', default: true },
  {
    id: 'network.wifi.status.read',
    default: true,
    requires: ['network.interface.status.read'],
    implies: ['network.interface.status.read'],
  },
  {
    id: 'network.wifi.ssid.read',
    default: false,
    requires: ['network.wifi.status.read'],
    implies: ['network.interface.status.read', 'network.wifi.status.read'],
  },
  { id: 'host.cpu.read', default: false },
  { id: 'host.process.basic.read', default: false },
  {
    id: 'host.process.owner.read',
    default: false,
    requires: ['host.process.basic.read'],
    implies: ['host.process.basic.read'],
  },
  { id: 'host.connection.summary.read', default: false },
  { id: 'diagnostic.traceroute.tcp', default: true },
]

const byId = (id: string) => CATALOG.find((e) => e.id === id)!

describe('selectWithDependencies', () => {
  it('adds the whole ancestry, not just the direct parent', () => {
    // A grandchild without its grandparent is a policy the Agent refuses at
    // startup, so the console must never be able to produce one.
    const got = selectWithDependencies(new Set(), byId('network.wifi.ssid.read'))
    expect([...got].sort()).toEqual([
      'network.interface.status.read',
      'network.wifi.ssid.read',
      'network.wifi.status.read',
    ])
  })

  it('leaves an unrelated selection untouched', () => {
    const got = selectWithDependencies(new Set(['host.cpu.read']), byId('probe.icmp'))
    expect([...got].sort()).toEqual(['host.cpu.read', 'probe.icmp'])
  })
})

describe('deselectWithDependents', () => {
  it('removes everything that required the permission being dropped', () => {
    const selected = new Set([
      'network.interface.status.read',
      'network.wifi.status.read',
      'network.wifi.ssid.read',
      'host.cpu.read',
    ])
    const got = deselectWithDependents(selected, 'network.wifi.status.read', CATALOG)
    expect([...got].sort()).toEqual(['host.cpu.read', 'network.interface.status.read'])
  })

  it('cascades through a whole chain when the root is dropped', () => {
    const selected = new Set([
      'network.interface.status.read',
      'network.wifi.status.read',
      'network.wifi.ssid.read',
    ])
    const got = deselectWithDependents(selected, 'network.interface.status.read', CATALOG)
    expect([...got]).toEqual([])
  })

  it('keeps siblings that did not depend on it', () => {
    const selected = new Set(['probe.icmp', 'probe.http', 'probe.http.extended'])
    const got = deselectWithDependents(selected, 'probe.icmp', CATALOG)
    expect([...got].sort()).toEqual(['probe.http', 'probe.http.extended'])
  })
})

describe('orderedSelection', () => {
  it('renders in catalog order so the same choice yields the same command', () => {
    const selected = new Set(['host.cpu.read', 'probe.icmp', 'network.interface.status.read'])
    expect(orderedSelection(selected, CATALOG)).toEqual([
      'probe.icmp',
      'network.interface.status.read',
      'host.cpu.read',
    ])
  })
})

describe('sameSelection', () => {
  it('ignores order but not membership', () => {
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameSelection(['a', 'b'], ['a'])).toBe(false)
    expect(sameSelection(['a', 'b'], ['a', 'c'])).toBe(false)
  })
})

describe('platformSupport', () => {
  it('reports the macOS capability gap', () => {
    // These are implemented in the Windows and Linux builds only.
    for (const id of ['probe.icmp', 'network.gateway.probe', 'network.neighbor.read', 'diagnostic.traceroute.icmp']) {
      expect(platformSupport(id, 'macos')).toBe('unsupported')
    }
    expect(platformSupport('probe.dns', 'macos')).toBe('ok')
    expect(platformSupport('host.cpu.read', 'macos')).toBe('ok')
  })

  it('only marks path diagnostics as privileged on Linux and in containers', () => {
    for (const platform of ['linux', 'docker'] as const) {
      expect(platformSupport('diagnostic.traceroute.icmp', platform)).toBe('privileged')
      expect(platformSupport('diagnostic.traceroute.tcp', platform)).toBe('privileged')
      // ICMP probing needs only to send an echo and read the reply, which an
      // unprivileged ping socket does under the usual ping_group_range —
      // measured for both an ordinary user and a plain non-root container.
      expect(platformSupport('probe.icmp', platform)).toBe('ok')
      expect(platformSupport('network.gateway.probe', platform)).toBe('ok')
      // Netlink neighbor reads need no privilege at all.
      expect(platformSupport('network.neighbor.read', platform)).toBe('ok')
      expect(platformSupport('host.cpu.read', platform)).toBe('ok')
    }
  })

  it('separates "expect it to work" from "privilege would fix it"', () => {
    // The two questions genuinely differ for ICMP probing on Linux: it normally
    // works unprivileged, so the picker must not warn about it — but an agent
    // that DOES report it unsupported is fixed by running privileged.
    expect(platformSupport('probe.icmp', 'linux')).toBe('ok')
    expect(privilegeCanEnable('probe.icmp', 'linux')).toBe(true)
    // On macOS nothing about privilege helps, because it is not implemented.
    expect(privilegeCanEnable('probe.icmp', 'macos')).toBe(false)
    expect(privilegeCanEnable('diagnostic.traceroute.tcp', 'macos')).toBe(false)
    // Windows needs elevation for TCP path diagnostics only.
    expect(privilegeCanEnable('diagnostic.traceroute.tcp', 'windows')).toBe(true)
    expect(privilegeCanEnable('probe.icmp', 'windows')).toBe(false)
    // Privilege has nothing to do with a plain metric read anywhere.
    expect(privilegeCanEnable('host.cpu.read', 'linux')).toBe(false)
  })

  it('only flags TCP path diagnostics as privileged on Windows', () => {
    expect(platformSupport('diagnostic.traceroute.tcp', 'windows')).toBe('privileged')
    // iphlpapi ICMP needs no elevation there.
    expect(platformSupport('probe.icmp', 'windows')).toBe('ok')
    expect(platformSupport('diagnostic.traceroute.icmp', 'windows')).toBe('ok')
  })
})

describe('permissionGroup', () => {
  it('keeps snapshot scopes out of the host-metrics bucket', () => {
    // host.process.* and host.connection.* read command lines, users and remote
    // addresses — a different privacy decision from CPU and memory numbers.
    expect(permissionGroup('host.cpu.read')).toBe('host')
    expect(permissionGroup('host.process.owner.read')).toBe('process')
    expect(permissionGroup('host.connection.summary.read')).toBe('connection')
    expect(permissionGroup('probe.http.extended')).toBe('probe')
    expect(permissionGroup('network.wifi.ssid.read')).toBe('network')
    expect(permissionGroup('diagnostic.traceroute.tcp')).toBe('diagnostic')
    expect(permissionGroup('future.thing')).toBe('other')
  })
})

describe('groupCatalog', () => {
  it('buckets in a stable order and skips empty groups', () => {
    const groups = groupCatalog(CATALOG)
    expect(groups.map((g) => g.group)).toEqual([
      'probe',
      'network',
      'host',
      'process',
      'connection',
      'diagnostic',
    ])
    expect(groups.flatMap((g) => g.entries)).toHaveLength(CATALOG.length)
  })
})
