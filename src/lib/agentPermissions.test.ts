import { describe, expect, it } from 'vitest'

import type { AgentPermission } from '../api'
import { agentPlatform, bucketAgentPermissions, categoryFor } from './agentPermissions'

const perm = (id: string, granted: boolean, supported: boolean, effective: boolean): AgentPermission => ({
  id,
  granted,
  supported,
  effective,
})

describe('bucketAgentPermissions', () => {
  it('splits the catalog by cause, never dropping a non-effective permission', () => {
    const b = bucketAgentPermissions([
      perm('probe.dns', true, true, true), // working
      perm('host.cpu.read', false, true, false), // policy edit turns it on
      perm('probe.icmp', true, false, false), // granted, platform can't
      perm('host.disk.read', false, false, false), // neither granted nor possible
      perm('network.wifi.ssid.read', true, true, false), // parent isn't effective
    ])
    expect(b.effective).toEqual(['probe.dns'])
    expect(b.notGranted).toEqual(['host.cpu.read'])
    expect(b.blocked).toEqual(['probe.icmp', 'network.wifi.ssid.read'])
    expect(b.unsupported).toEqual(['host.disk.read'])
  })

  it('accounts for every entry exactly once', () => {
    const perms = [
      perm('a', true, true, true),
      perm('b', false, true, false),
      perm('c', true, false, false),
      perm('d', false, false, false),
    ]
    const b = bucketAgentPermissions(perms)
    const all = [...b.effective, ...b.notGranted, ...b.blocked, ...b.unsupported]
    expect(all.sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('agentPlatform', () => {
  it('maps the reported platform, treating any distribution id as Linux', () => {
    // The agent sends runtime.GOOS on Windows/macOS but a distribution id on
    // Linux, so the Linux bucket has to be the default rather than a match.
    expect(agentPlatform('windows')).toBe('windows')
    expect(agentPlatform('darwin')).toBe('macos')
    expect(agentPlatform('ubuntu')).toBe('linux')
    expect(agentPlatform('alpine')).toBe('linux')
    expect(agentPlatform('linux')).toBe('linux')
    expect(agentPlatform('')).toBe('linux')
  })
})

describe('categoryFor', () => {
  it('sends an ungranted but supported permission down the policy flow', () => {
    expect(categoryFor(perm('host.cpu.read', false, true, false), 'linux')).toBe('permission_blocked')
  })

  it('calls a granted-and-supported failure a dependency problem', () => {
    // Granting is done and the platform can do it, so the only way it is still
    // not effective is a required parent that isn't.
    expect(categoryFor(perm('network.wifi.ssid.read', true, true, false), 'linux')).toBe('dependency')
  })

  it('calls a Linux raw-socket gap an elevation problem, not a platform gap', () => {
    // Running the agent as root or adding CAP_NET_RAW enables all of these, so
    // telling the operator the platform cannot do it would be false.
    for (const id of ['probe.icmp', 'network.gateway.probe', 'diagnostic.traceroute.icmp', 'diagnostic.traceroute.tcp']) {
      expect(categoryFor(perm(id, true, false, false), 'linux')).toBe('elevation')
    }
  })

  it('calls the same permissions a hard platform gap on macOS', () => {
    // The macOS build does not implement them; elevation changes nothing.
    for (const id of ['probe.icmp', 'network.gateway.probe', 'diagnostic.traceroute.icmp', 'diagnostic.traceroute.tcp']) {
      expect(categoryFor(perm(id, true, false, false), 'macos')).toBe('unsupported')
    }
  })

  it('only treats TCP path diagnostics as an elevation problem on Windows', () => {
    expect(categoryFor(perm('diagnostic.traceroute.tcp', true, false, false), 'windows')).toBe('elevation')
    // ICMP needs no elevation on Windows, so an unsupported report there is not
    // something a privileged re-run would fix.
    expect(categoryFor(perm('probe.icmp', true, false, false), 'windows')).toBe('unsupported')
    // Temperature is deliberately unimplemented on Windows because ACPI WMI
    // thermal zones are not trustworthy hardware readings.
    expect(categoryFor(perm('host.temperature.read', true, false, false), 'windows')).toBe('unsupported')
  })

  it('leads with the capability gap when a permission is neither granted nor supported', () => {
    // A policy line alone would not make these work, so the dialog must not open
    // on the "just set this variable" flow.
    expect(categoryFor(perm('probe.icmp', false, false, false), 'macos')).toBe('unsupported')
    expect(categoryFor(perm('probe.icmp', false, false, false), 'linux')).toBe('elevation')
  })

  // Frame data is the one capability gap an ordinary user can close themselves,
  // by installing the PresentMon service. Reporting it as a hard platform gap
  // would tell a Windows user to change platform for something a download fixes.
  it('offers the install path for game permissions on Windows', () => {
    for (const id of ['game.process.detect', 'game.performance.read']) {
      expect(categoryFor(perm(id, true, false, false), 'windows')).toBe('component')
      // Ungranted as well: the cause is still the missing component, and the
      // dialog adds the policy block on top via grantMissing.
      expect(categoryFor(perm(id, false, false, false), 'windows')).toBe('component')
      // Elsewhere there is no component to install — the build has no sensor at
      // all — so offering a download would be a dead end.
      for (const platform of ['macos', 'linux'] as const) {
        expect(categoryFor(perm(id, true, false, false), platform)).toBe('unsupported')
      }
    }
  })

  // Once the service is there the permission behaves like any other: still
  // subject to policy and to its dependency.
  it('keeps the ordinary causes for game permissions once supported', () => {
    expect(categoryFor(perm('game.performance.read', false, true, false), 'windows')).toBe('permission_blocked')
    expect(categoryFor(perm('game.performance.read', true, true, false), 'windows')).toBe('dependency')
  })
})
