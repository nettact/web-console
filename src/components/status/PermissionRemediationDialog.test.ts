import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../../locales/en'
import PermissionRemediationDialog from './PermissionRemediationDialog.vue'

type Props = {
  permId: string
  category: 'permission_blocked' | 'elevation' | 'component' | 'unsupported' | 'dependency'
  permissionsEnv?: string
  requires?: string[]
  grantMissing?: boolean
  desktop?: boolean
}

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
