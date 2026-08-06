import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../../locales/en'
import type { RemediationCategory } from '../../lib/agentPermissions'
import PermissionRemediationDialog from './PermissionRemediationDialog.vue'

type Props = {
  permId: string
  category: RemediationCategory
  unsupportedReason?: string
  permissionsEnv?: string
  requires?: string[]
  grantMissing?: boolean
  desktop?: boolean
}

// The official releases page. Nothing in the sensor-side or hardware causes may
// link here: every one of them is a problem installing PresentMon cannot touch.
const hasDownloadLink = (w: { findAll: (s: string) => Array<{ attributes: (a: string) => string | undefined }> }) =>
  w.findAll('a').some((a) => a.attributes('href')?.includes('GameTechDev/PresentMon'))

function render(props: Props) {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  return mount(PermissionRemediationDialog, {
    props: { open: true, ...props },
    // Render the teleported dialog in place so it is queryable from the wrapper.
    global: { plugins: [i18n], stubs: { teleport: true } },
  })
}

describe('PermissionRemediationDialog', () => {
  it('renders the full env line and per run-mode snippets for a permission_blocked permission', async () => {
    const env = 'NETTACT_AGENT_PERMISSIONS=host.process.basic.read,host.process.owner.read'
    const w = render({ permId: 'host.process.owner.read', category: 'permission_blocked', permissionsEnv: env })

    // The full server-computed line is shown verbatim (with copy).
    expect(w.text()).toContain(env)
    // Default PowerShell snippet uses the $env: form.
    expect(w.text()).toContain('$env:NETTACT_AGENT_PERMISSIONS = "host.process.basic.read,host.process.owner.read"')

    // systemd uses Environment=, docker compose uses environment:, YAML uses the
    // permissions list — switching tabs re-renders the snippet.
    const tabs = w.findAll('[role="tab"]')
    const byText = (text: string) => tabs.find((tab) => tab.text() === text)!
    await byText('systemd').trigger('click')
    expect(w.text()).toContain('Environment=NETTACT_AGENT_PERMISSIONS=host.process.basic.read,host.process.owner.read')
    await byText('Docker Compose').trigger('click')
    expect(w.text()).toContain('- NETTACT_AGENT_PERMISSIONS=host.process.basic.read,host.process.owner.read')
    await byText('YAML').trigger('click')
    expect(w.text()).toContain('permissions:')
    expect(w.text()).toContain('- host.process.basic.read')
    expect(w.text()).toContain('- host.process.owner.read')
  })

  it('shows a generic fallback and no code block when no env line is available', () => {
    const w = render({ permId: 'host.cpu.read', category: 'permission_blocked' })
    expect(w.text()).toContain('cannot be generated')
    expect(w.find('pre').exists()).toBe(false)
  })

  it('shows elevation steps and no env line for an elevation block', () => {
    const w = render({ permId: 'diagnostic.traceroute.tcp', category: 'elevation' })
    expect(w.text()).toContain('Administrator')
    expect(w.find('pre').exists()).toBe(false)
  })

  it('shows the platform note and no env line for an unsupported block', () => {
    const w = render({ permId: 'probe.icmp', category: 'unsupported' })
    expect(w.text()).toContain('Windows and Linux Agent builds')
    expect(w.find('pre').exists()).toBe(false)
  })

  it('deep links to the docs entry for this exact permission', () => {
    // The docs give each permission an explicit `{#id-with-hyphens}` anchor, so
    // the link must swap dots for hyphens or it lands on the page top.
    const w = render({ permId: 'host.process.owner.read', category: 'permission_blocked' })
    const href = w.find('a.prd-docs').attributes('href')
    expect(href).toBe('https://nettact.org/en/permissions#host-process-owner-read')
  })

  it('names the blocking parent for a dependency block and offers no policy line', () => {
    // The permission itself is granted and supported, so a policy edit is not the
    // fix — pointing at the parent is.
    const w = render({
      permId: 'network.wifi.ssid.read',
      category: 'dependency',
      requires: ['network.wifi.status.read'],
    })
    expect(w.text()).toContain('depends on')
    expect(w.text()).toContain('Wi-Fi status read')
    expect(w.find('pre').exists()).toBe(false)
  })

  it('adds the policy line to a capability block when the permission is not granted either', () => {
    // Elevating alone would leave it off, so both halves of the fix must show.
    const env = 'NETTACT_AGENT_PERMISSIONS=probe.icmp,diagnostic.traceroute.tcp'
    const w = render({
      permId: 'diagnostic.traceroute.tcp',
      category: 'elevation',
      permissionsEnv: env,
      grantMissing: true,
    })
    expect(w.text()).toContain('Administrator')
    expect(w.text()).toContain('not granted either')
    expect(w.text()).toContain(env)
  })

  it('suppresses environment/YAML guidance in desktop full-access mode', () => {
    const env = 'NETTACT_AGENT_PERMISSIONS=host.cpu.read'
    const w = render({ permId: 'host.cpu.read', category: 'permission_blocked', permissionsEnv: env, desktop: true })
    expect(w.find('pre').exists()).toBe(false)
    expect(w.text()).toContain('full-access')
  })

  // The component cause is the only capability gap the reader can close, so it
  // is the only one that has to end in an action rather than an explanation.
  it('offers a download, a check command and the restart caveat for a missing component', () => {
    const w = render({ permId: 'game.performance.read', category: 'component' })

    expect(w.text()).toContain('PresentMon')
    // Why it is needed at all — otherwise "install this" reads as arbitrary.
    expect(w.text()).toContain('trace session')

    // A real link to the official releases, opened safely.
    const link = w.findAll('a').find((a) => a.attributes('href')?.includes('GameTechDev/PresentMon'))
    expect(link).toBeDefined()
    expect(link!.attributes('target')).toBe('_blank')
    expect(link!.attributes('rel')).toContain('noopener')

    // The one question the steps cannot answer for the reader, copyable.
    expect(w.text()).toContain('sc.exe query PresentMonSharedService')
    // Already-installed-but-stopped is the likeliest second visit.
    expect(w.text()).toContain('STOPPED')
    // The capability is probed at startup, so nothing changes until a restart.
    expect(w.text()).toContain('Restart the Agent')
  })

  // Desktop grants every permission, so a missing component shows up there as
  // granted-but-unsupported: the install steps must appear without the policy
  // block that desktop mode has no use for.
  it('keeps the component steps in desktop mode and omits the policy block', () => {
    const w = render({ permId: 'game.performance.read', category: 'component', desktop: true })
    expect(w.text()).toContain('PresentMon')
    expect(w.find('pre').text()).toContain('sc.exe query PresentMonSharedService')
    expect(w.text()).not.toContain('NETTACT_AGENT_PERMISSIONS')
  })

  // A standalone agent has the component missing AND the permission ungranted.
  // Installing alone would leave it off, so both halves must show.
  it('adds the policy line to the component steps when the permission is not granted either', () => {
    const env = 'NETTACT_AGENT_PERMISSIONS=game.process.detect,game.performance.read'
    const w = render({
      permId: 'game.performance.read',
      category: 'component',
      permissionsEnv: env,
      grantMissing: true,
    })
    expect(w.text()).toContain('PresentMon')
    expect(w.text()).toContain('not granted either')
    expect(w.text()).toContain(env)
  })
})

// Once the agent says WHY, the dialog must stop offering the one remedy it used
// to offer for everything. These cover the codes where "install Intel PresentMon"
// is wrong, plus the ones where it is still right.
describe('PermissionRemediationDialog unsupported reasons', () => {
  it('tells a stale-sensor agent to update the Agent, never to install PresentMon', () => {
    // The reported bug: PresentMon installed and running perfectly, console said
    // it was not installed. The finding must name the build mismatch, the remedy
    // must name the Agent, and there must be no installer link to follow.
    const w = render({
      permId: 'game.performance.read',
      category: 'agent_sensor',
      unsupportedReason: 'proto_mismatch',
    })
    const text = w.text()
    expect(text).toContain('different builds')
    expect(text).toContain('reinstall the Agent')
    expect(text).toContain('will not help')
    // No install steps, no download, and no service check — none of it applies.
    expect(hasDownloadLink(w)).toBe(false)
    expect(text).not.toContain('sc.exe query')
    // And none of the hedging that belongs to the guessing path.
    expect(text).not.toContain('most common cause')
  })

  it('tells a build without the sensor to change build, and clears PresentMon by name', () => {
    const w = render({
      permId: 'game.performance.read',
      category: 'agent_sensor',
      unsupportedReason: 'sensor_missing',
    })
    expect(w.text()).toContain('ships no sensor component')
    expect(w.text()).toContain('Windows desktop build')
    expect(w.text()).toContain('Nothing is wrong with this machine')
    expect(hasDownloadLink(w)).toBe(false)
  })

  it('sends the runtime failures to the log rather than to a download', () => {
    for (const reason of ['probe_failed', 'sensor_exited', 'internal_error']) {
      const w = render({ permId: 'game.performance.read', category: 'agent_sensor', unsupportedReason: reason })
      expect(w.text()).toContain('Agent log')
      expect(w.text()).toContain('will not fix this')
      expect(hasDownloadLink(w)).toBe(false)
    }
  })

  it('calls a lost capture session transient instead of a fault to fix', () => {
    const w = render({ permId: 'game.performance.read', category: 'agent_sensor', unsupportedReason: 'session_lost' })
    expect(w.text()).toContain('transient')
    expect(hasDownloadLink(w)).toBe(false)
  })

  // The service is installed, so the download is busywork — but the check command
  // is exactly what answers "is it running?", so that half stays.
  it('offers the service check but not the installer when the service is unreachable', () => {
    const w = render({
      permId: 'game.performance.read',
      category: 'component',
      unsupportedReason: 'service_unavailable',
    })
    expect(w.text()).toContain('could not be reached')
    expect(w.text()).toContain('Start or repair')
    expect(w.text()).toContain('sc.exe query PresentMonSharedService')
    expect(hasDownloadLink(w)).toBe(false)
    // The closing caveat must not contradict the fix that just said there is
    // nothing to download: no "restart after installing" on this path.
    expect(w.text()).not.toContain('after installing')
    expect(w.text()).toContain('Once the service is running, restart the Agent')
  })

  it('keeps the install-flavoured restart caveat where installing is the fix', () => {
    for (const reason of ['presentmon_missing', 'version_mismatch', undefined]) {
      const w = render({ permId: 'game.performance.read', category: 'component', unsupportedReason: reason })
      expect(w.text()).toContain('Restart the Agent after installing')
      expect(w.text()).not.toContain('Once the service is running')
    }
  })

  it('keeps the download for the two causes an installer really fixes', () => {
    for (const reason of ['presentmon_missing', 'version_mismatch']) {
      const w = render({ permId: 'game.performance.read', category: 'component', unsupportedReason: reason })
      expect(hasDownloadLink(w)).toBe(true)
      expect(w.text()).toContain('sc.exe query PresentMonSharedService')
      // A known cause never hedges: the alternatives paragraph is for guesses.
      expect(w.text()).not.toContain('most common cause')
    }
    expect(
      render({ permId: 'game.performance.read', category: 'component', unsupportedReason: 'version_mismatch' }).text(),
    ).toContain('not compatible')
  })

  it('says there is nothing to install for an OS or hardware gap', () => {
    const os = render({ permId: 'game.performance.read', category: 'unsupported', unsupportedReason: 'unsupported_os' })
    expect(os.text()).toContain('cannot supply the data')
    expect(hasDownloadLink(os)).toBe(false)

    const gpu = render({ permId: 'game.gpu.read', category: 'unsupported', unsupportedReason: 'gpu_telemetry_unavailable' })
    expect(gpu.text()).toContain('Capture itself is working')
    expect(gpu.text()).toContain('nothing to install')
    expect(hasDownloadLink(gpu)).toBe(false)
    // The per-permission platform note is written for the guessing path and ends
    // in "install the component"; the reason's own remedy replaces it.
    expect(gpu.text()).not.toContain('see the fix')
  })

  // The machine has a working sensor; it just answers to a different server. The
  // remedy is to look somewhere else, so this cause must not put an installer in
  // front of someone whose PresentMon is healthy and busy.
  it('points at the owning server instead of an installer when the sensor belongs elsewhere', () => {
    const w = render({
      permId: 'game.performance.read',
      category: 'unsupported',
      unsupportedReason: 'owned_by_another_server',
    })
    expect(w.text()).toContain('reports to a different NetTact server')
    expect(w.text()).toContain('nothing to install')
    expect(hasDownloadLink(w)).toBe(false)
    expect(w.text()).not.toMatch(/permUnsupportedReason\.|permRemediation\.\w/)
  })

  // A newer agent's code, and an agent that never probed at all, must both land
  // on the old guess WITH its hedge rather than on a blank or invented cause —
  // but they are three different states and each gets its own wording.
  it('hedges on all three no-answer states and never renders a raw i18n path', () => {
    for (const reason of [undefined, 'a_code_from_a_newer_agent']) {
      for (const grantMissing of [true, false]) {
        const w = render({
          permId: 'game.performance.read',
          category: 'component',
          unsupportedReason: reason,
          grantMissing,
          // An env line only so the grant block has something to render; it is
          // not what this test is about.
          permissionsEnv: grantMissing ? 'NETTACT_AGENT_PERMISSIONS=game.performance.read' : undefined,
        })
        expect(w.text()).toContain('no usable service was found')
        expect(w.text()).toContain('most common cause')
        expect(hasDownloadLink(w)).toBe(true)
        expect(w.text()).not.toMatch(/permUnsupportedReason\.|permRemediation\.\w/)
      }
    }
  })

  it('tells an ungranted permission with no reported cause to grant it and restart', () => {
    // The agent does not probe what nothing granted, so granting really is how
    // the reader gets a real cause out of it.
    const w = render({
      permId: 'game.performance.read',
      category: 'component',
      grantMissing: true,
      permissionsEnv: 'NETTACT_AGENT_PERMISSIONS=game.performance.read',
    })
    expect(w.text()).toContain('does not probe a capability nothing granted it')
    expect(w.text()).toContain('Grant the permission and restart the Agent')
  })

  it('does not tell an already-granted permission to grant itself when no cause was reported', () => {
    // Same silence, opposite state: the grant is done, so repeating that advice
    // sends the reader to change a setting that is already correct.
    const w = render({ permId: 'game.performance.read', category: 'component', grantMissing: false })
    expect(w.text()).not.toContain('Grant the permission and restart the Agent')
    expect(w.text()).not.toContain('does not probe a capability nothing granted it')
    expect(w.text()).toContain('reported no cause')
    expect(w.text()).toContain('Update the Agent')
    expect(w.text()).toContain('Agent log')
  })

  it('says an unrecognised code was reported, and shows the code', () => {
    // The agent DID answer. Claiming it reported nothing is false, and the raw
    // code is the one identifier worth putting in front of the reader: it is
    // what they search for or quote when reporting this.
    const w = render({
      permId: 'game.performance.read',
      category: 'component',
      unsupportedReason: 'a_code_from_a_newer_agent',
      grantMissing: false,
    })
    expect(w.text()).toContain('does not recognise')
    expect(w.text()).toContain('a_code_from_a_newer_agent')
    expect(w.text()).toContain('Updating the console')
    // Neither of the "nothing was reported" stories applies here.
    expect(w.text()).not.toContain('attached no cause')
    expect(w.text()).not.toContain('reported no cause')
    expect(w.text()).not.toContain('Grant the permission and restart the Agent')
  })

  it('surfaces an unrecognised code on the platform-gap route instead of swallowing it', () => {
    // Off Windows the fallback guess sends an unknown code here, where the body
    // otherwise asserts a build gap the agent may not have been talking about.
    const w = render({
      permId: 'game.performance.read',
      category: 'unsupported',
      unsupportedReason: 'a_code_from_a_newer_agent',
    })
    expect(w.text()).toContain('a_code_from_a_newer_agent')
    expect(w.text()).toContain('does not recognise')
  })

  it('still adds the policy block on top of a reason-driven cause', () => {
    // Knowing why the capability is missing changes nothing about the grant: both
    // halves have to be fixed, so both halves have to show.
    const env = 'NETTACT_AGENT_PERMISSIONS=game.process.detect,game.performance.read'
    const w = render({
      permId: 'game.performance.read',
      category: 'agent_sensor',
      unsupportedReason: 'proto_mismatch',
      permissionsEnv: env,
      grantMissing: true,
    })
    expect(w.text()).toContain('different builds')
    expect(w.text()).toContain('not granted either')
    expect(w.text()).toContain(env)
  })
})
