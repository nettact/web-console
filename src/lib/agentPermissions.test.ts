import { describe, expect, it } from 'vitest'

import type { AgentPermission } from '../api'
import {
  agentPlatform,
  bucketAgentPermissions,
  categoryFor,
  isKnownUnsupportedReason,
  reasonCategory,
  unsupportedReasonState,
} from './agentPermissions'

const perm = (
  id: string,
  granted: boolean,
  supported: boolean,
  effective: boolean,
  unsupported_reason?: string,
): AgentPermission => ({
  id,
  granted,
  supported,
  effective,
  ...(unsupported_reason ? { unsupported_reason } : {}),
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

  it('splits macOS capability gaps by what root would actually fix', () => {
    // Path diagnostics needs a raw ICMP socket on macOS, so root enables it —
    // an elevation problem, same as Linux.
    for (const id of ['diagnostic.traceroute.icmp', 'diagnostic.traceroute.tcp']) {
      expect(categoryFor(perm(id, true, false, false), 'macos')).toBe('elevation')
    }
    // ICMP and gateway probing run unprivileged for every macOS user, so an
    // agent still reporting them unsupported is broken in a way no elevation
    // fixes — prescribing root there would be false advice.
    for (const id of ['probe.icmp', 'network.gateway.probe']) {
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
    // on the "just set this variable" flow. On macOS unsupported ICMP probing is
    // not privilege-fixable (it already runs unprivileged for everyone), so the
    // fallback guess stays a hard gap; on Linux privilege is the likely fix.
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

describe('categoryFor with a reported reason', () => {
  // The bug this whole field exists for: a user whose PresentMon was installed
  // and running was told to install PresentMon, because the console guessed the
  // one cause it knew about. proto_mismatch is fixed by updating the AGENT.
  it('stops sending a stale-sensor agent down the PresentMon install flow', () => {
    expect(categoryFor(perm('game.performance.read', true, false, false, 'proto_mismatch'), 'windows')).toBe(
      'agent_sensor',
    )
  })

  it('keeps the PresentMon flow for the three causes PresentMon actually explains', () => {
    for (const reason of ['presentmon_missing', 'service_unavailable', 'version_mismatch']) {
      expect(categoryFor(perm('game.performance.read', true, false, false, reason), 'windows')).toBe('component')
    }
  })

  it('routes every sensor-side and runtime failure away from anything installable', () => {
    for (const reason of ['proto_mismatch', 'sensor_missing', 'probe_failed', 'sensor_exited', 'internal_error', 'session_lost']) {
      expect(categoryFor(perm('game.performance.read', true, false, false, reason), 'windows')).toBe('agent_sensor')
    }
  })

  it('calls the OS and hardware gaps unsupported', () => {
    // Neither has a remedy the reader can act on: no Windows build, no adapter
    // telemetry. Offering a download for either would be a dead end.
    expect(categoryFor(perm('game.performance.read', true, false, false, 'unsupported_os'), 'windows')).toBe(
      'unsupported',
    )
    expect(categoryFor(perm('game.gpu.read', true, false, false, 'gpu_telemetry_unavailable'), 'windows')).toBe(
      'unsupported',
    )
  })

  // An agent may report to several servers at once, and exactly one of them owns
  // the sensor. The others are told this instead of a bare "unsupported"
  // precisely so their consoles stop guessing, and the guess they would fall
  // back to on Windows is `component` — "install Intel PresentMon" — aimed at a
  // machine whose PresentMon is installed, running and busy. That is the wrong
  // remedy this code was added to prevent, so it must never route there.
  it('does not send a machine whose sensor belongs to another server to the installer', () => {
    for (const id of ['game.process.detect', 'game.performance.read', 'game.gpu.read']) {
      expect(categoryFor(perm(id, true, false, false, 'owned_by_another_server'), 'windows')).toBe('unsupported')
      // Ungranted as well: the policy line still renders on top via grantMissing,
      // but the cause underneath it is not something to install.
      expect(categoryFor(perm(id, false, false, false, 'owned_by_another_server'), 'windows')).toBe('unsupported')
    }
    expect(reasonCategory('owned_by_another_server')).toBe('unsupported')
    expect(isKnownUnsupportedReason('owned_by_another_server')).toBe(true)
  })

  // Not a gap at all, so it must not be confused with the two codes that really
  // do mean "the sensor cannot run here".
  it('keeps the sensor-side codes distinct from the ownership one', () => {
    expect(categoryFor(perm('game.performance.read', true, false, false, 'sensor_missing'), 'windows')).toBe(
      'agent_sensor',
    )
    expect(categoryFor(perm('game.performance.read', true, false, false, 'owned_by_another_server'), 'windows')).toBe(
      'unsupported',
    )
  })

  // The reason comes from the machine itself, so it beats the platform tables
  // rather than being filtered by them. A Linux agent reporting sensor_missing
  // is telling the truth about its own build.
  it('believes the agent over the platform guess, on any platform', () => {
    expect(categoryFor(perm('game.performance.read', true, false, false, 'sensor_missing'), 'linux')).toBe(
      'agent_sensor',
    )
    expect(categoryFor(perm('game.performance.read', true, false, false, 'presentmon_missing'), 'macos')).toBe(
      'component',
    )
  })

  // Absent is a real answer — the agent does not probe a capability nothing
  // granted — and an unknown code is one from a newer agent. Both keep the old
  // guess, which is the only path still allowed to hedge in the dialog.
  it('falls back to the platform guess for an absent or unknown reason', () => {
    expect(categoryFor(perm('game.performance.read', false, false, false), 'windows')).toBe('component')
    expect(categoryFor(perm('game.performance.read', false, false, false, 'brand_new_code'), 'windows')).toBe(
      'component',
    )
    expect(categoryFor(perm('probe.icmp', true, false, false, 'brand_new_code'), 'linux')).toBe('elevation')
  })

  // A reason arriving on a supported permission (the server says it never should)
  // must not hijack the dependency/policy causes, which are about something else
  // entirely and have working remedies.
  it('never lets a reason override a supported permission’s cause', () => {
    expect(categoryFor(perm('game.performance.read', true, true, false, 'proto_mismatch'), 'windows')).toBe(
      'dependency',
    )
    expect(categoryFor(perm('game.performance.read', false, true, false, 'proto_mismatch'), 'windows')).toBe(
      'permission_blocked',
    )
  })
})

describe('reasonCategory', () => {
  it('reports unknown for codes it does not carry text for', () => {
    expect(reasonCategory(undefined)).toBeUndefined()
    expect(reasonCategory('')).toBeUndefined()
    expect(reasonCategory('something_new')).toBeUndefined()
    expect(isKnownUnsupportedReason('presentmon_missing')).toBe(true)
    expect(isKnownUnsupportedReason('something_new')).toBe(false)
  })

  it('does not mistake an Object.prototype key for a known code', () => {
    // A plain object literal lookup answers `constructor` with a function, which
    // is truthy — enough to route a permission into a flow whose text does not
    // exist and render raw i18n paths at the user.
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(reasonCategory(key)).toBeUndefined()
      expect(isKnownUnsupportedReason(key)).toBe(false)
    }
  })
})

describe('unsupportedReasonState', () => {
  // Routing collapses the last two states; wording must not. "The agent reported
  // no cause" is false about an agent that reported one this build cannot read,
  // and the advice that follows it ("grant it to get a real answer") is wrong for
  // a permission that is already granted.
  it('separates explained, reported-but-unreadable, and never-reported', () => {
    expect(unsupportedReasonState('proto_mismatch')).toBe('known')
    expect(unsupportedReasonState('a_code_from_a_newer_agent')).toBe('unknown_code')
    expect(unsupportedReasonState(undefined)).toBe('not_reported')
    expect(unsupportedReasonState('')).toBe('not_reported')
  })

  it('agrees with the routing on which states cannot pick a flow', () => {
    // Both non-known states must fall through categoryFor to the platform guess,
    // so the dialog's hedged wording and the flow it opens always match.
    for (const reason of [undefined, '', 'a_code_from_a_newer_agent', 'constructor']) {
      expect(reasonCategory(reason)).toBeUndefined()
      expect(unsupportedReasonState(reason)).not.toBe('known')
      expect(categoryFor(perm('game.performance.read', true, false, false, reason), 'windows')).toBe('component')
    }
  })
})
