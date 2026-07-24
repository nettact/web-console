import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../../locales/en'
import PermissionRemediationDialog from './PermissionRemediationDialog.vue'

type Props = {
  permId: string
  category: 'permission_blocked' | 'elevation' | 'unsupported'
  permissionsEnv?: string
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
    expect(w.text()).toContain('Windows Agent build')
    expect(w.find('pre').exists()).toBe(false)
  })

  it('suppresses environment/YAML guidance in desktop full-access mode', () => {
    const env = 'NETTACT_AGENT_PERMISSIONS=host.cpu.read'
    const w = render({ permId: 'host.cpu.read', category: 'permission_blocked', permissionsEnv: env, desktop: true })
    expect(w.find('pre').exists()).toBe(false)
    expect(w.text()).toContain('full-access')
  })
})
