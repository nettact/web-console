import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it } from 'vitest'

import en from '../locales/en'
import EnrollExamples from './EnrollExamples.vue'
import { consoleBase, setConsoleBase } from '../consoleBaseUrl'
import { permissionCatalog } from '../permissionCatalog'

// A miniature catalog with a real dependency chain, so the picker's behaviour is
// exercised without a server: wifi.ssid → wifi.status → interface.status.
const CATALOG = [
  { id: 'probe.icmp', default: true },
  { id: 'probe.dns', default: true },
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
]
const RECOMMENDED = ['probe.icmp', 'probe.dns', 'network.interface.status.read', 'network.wifi.status.read']
const HOST_METRICS = [...RECOMMENDED, 'host.cpu.read']

function seedCatalog(loaded = true) {
  permissionCatalog.loaded = loaded
  permissionCatalog.permissions = loaded ? CATALOG : []
  permissionCatalog.bundles = loaded
    ? [
        { id: 'recommended', permissions: RECOMMENDED },
        { id: 'host_metrics', permissions: HOST_METRICS },
        { id: 'full', permissions: [...HOST_METRICS, 'network.wifi.ssid.read'] },
      ]
    : []
}

// The install commands must carry the configured console address, so seed it as
// loaded — that also keeps the component from reaching for the settings API.
function seedConsoleBase(url = "https://net'tact.example:12450") {
  setConsoleBase(url)
}

function mountExamples() {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  return mount(EnrollExamples, {
    props: { token: "to'ken" },
    global: { plugins: [i18n] },
  })
}

const code = (w: ReturnType<typeof mountExamples>) => w.find('pre').text()
const policyIn = (w: ReturnType<typeof mountExamples>) =>
  (code(w).match(/-Permissions '([^']+)'/)?.[1] || '').split(',').filter(Boolean)

describe('EnrollExamples', () => {
  beforeEach(() => {
    seedCatalog()
    seedConsoleBase()
  })

  it('renders one-command installers for all four platforms', async () => {
    const wrapper = mountExamples()

    expect(code(wrapper)).toContain('https://d.nettact.org/agent/install.ps1')
    expect(code(wrapper)).toContain("-ServerUrl 'https://net''tact.example:12450'")
    expect(code(wrapper)).toContain('-AutoUpdate')

    await wrapper.findAll('.tab')[1].trigger('click')
    expect(code(wrapper)).toContain('install.sh | sudo bash')
    expect(code(wrapper)).toContain(`--token 'to'"'"'ken' --auto-update`)

    await wrapper.findAll('.tab')[2].trigger('click')
    expect(code(wrapper)).toContain('install.sh | sudo bash')

    await wrapper.findAll('.tab')[3].trigger('click')
    expect(code(wrapper)).toContain('https://d.nettact.org/agent/install.sh')
    expect(code(wrapper)).toContain('--docker')
  })

  it('removes the automatic-update flag when the option is disabled', async () => {
    const wrapper = mountExamples()
    await wrapper.find<HTMLInputElement>('.auto-update input').setValue(false)
    expect(code(wrapper)).not.toContain('-AutoUpdate')

    await wrapper.findAll('.tab')[3].trigger('click')
    expect(code(wrapper)).not.toContain('--auto-update')
  })

  it('points every platform at the configured console address, not this origin', async () => {
    // The browser origin is frequently unreachable from the machine being
    // enrolled (localhost, a tunnel, the desktop build's ephemeral port), so the
    // command must follow the console-URL setting — trailing slash stripped, or
    // the Agent would build "//api/..." request paths.
    seedConsoleBase('https://nettact.lan:12450/')
    const wrapper = mountExamples()

    expect(code(wrapper)).toContain("-ServerUrl 'https://nettact.lan:12450'")
    expect(code(wrapper)).not.toContain(window.location.origin)

    await wrapper.findAll('.tab')[2].trigger('click')
    expect(code(wrapper)).toContain("--server-url 'https://nettact.lan:12450'")
  })

  it('falls back to this origin when no console address is configured', () => {
    setConsoleBase('')
    expect(consoleBase.url).toBe(window.location.origin)
    expect(code(mountExamples())).toContain(`-ServerUrl '${window.location.origin}'`)
  })
})

describe('EnrollExamples permission picker', () => {
  beforeEach(() => {
    seedCatalog()
    seedConsoleBase()
  })

  it('omits the permission argument for the recommended preset', () => {
    // The recommended bundle IS the Agent's default policy, so spelling it out
    // would lengthen the command without changing the install.
    const wrapper = mountExamples()
    expect(code(wrapper)).not.toContain('-Permissions')
    expect(wrapper.text()).toContain('built-in default set')
  })

  it('adds the chosen preset to every platform command', async () => {
    const wrapper = mountExamples()
    await wrapper.findAll('input[type="radio"]')[1].setValue() // host_metrics

    expect(code(wrapper)).toContain(`-Permissions '${HOST_METRICS.join(',')}'`)

    await wrapper.findAll('.tab')[2].trigger('click')
    expect(code(wrapper)).toContain(`--permissions '${HOST_METRICS.join(',')}'`)

    await wrapper.findAll('.tab')[3].trigger('click')
    expect(code(wrapper)).toContain(`--permissions '${HOST_METRICS.join(',')}'`)
  })

  it('pulls in required parents when a child permission is ticked', async () => {
    const wrapper = mountExamples()
    const radios = wrapper.findAll('input[type="radio"]')
    await radios[radios.length - 1].setValue() // custom, seeded from recommended
    // Clear the seed so only the explicit tick and its dependencies remain.
    for (const box of wrapper.findAll<HTMLInputElement>('.perm-item input')) {
      if (box.element.checked) await box.trigger('change')
    }
    const ssid = wrapper.findAll('.perm-item').find((l) => l.text().includes('Wi-Fi SSID read'))!
    await ssid.find('input').trigger('change')

    // Selecting the grandchild must carry its whole ancestry, or the Agent
    // rejects the policy at startup.
    const value = policyIn(wrapper)
    expect(value).toContain('network.wifi.ssid.read')
    expect(value).toContain('network.wifi.status.read')
    expect(value).toContain('network.interface.status.read')
    expect(value).not.toContain('host.cpu.read')
  })

  it('drops dependents when a required parent is unticked', async () => {
    const wrapper = mountExamples()
    const radios = wrapper.findAll('input[type="radio"]')
    await radios[radios.length - 1].setValue() // custom, seeded from recommended
    const ssid = wrapper.findAll('.perm-item').find((l) => l.text().includes('Wi-Fi SSID read'))!
    await ssid.find('input').trigger('change')

    const status = wrapper.findAll('.perm-item').find((l) => l.text().includes('Wi-Fi status read'))!
    await status.find('input').trigger('change')

    const value = policyIn(wrapper)
    expect(value).not.toContain('network.wifi.status.read')
    // Leaving the child behind would produce a policy the Agent refuses to start on.
    expect(value).not.toContain('network.wifi.ssid.read')
  })

  it('flags permissions the selected platform cannot run', async () => {
    const wrapper = mountExamples()
    await wrapper.findAll('input[type="radio"]')[2].setValue() // full — includes probe.icmp

    // Windows runs everything in this catalog; macOS has no ICMP implementation.
    expect(wrapper.text()).not.toContain('cannot be enabled on this platform')
    await wrapper.findAll('.tab')[1].trigger('click') // macOS
    expect(wrapper.text()).toContain('cannot be enabled on this platform')
  })

  it('hides the picker entirely when the catalog could not be loaded', () => {
    // Losing an optional chooser must not block enrollment: the command still
    // installs an Agent on its built-in default policy.
    seedCatalog(false)
    const wrapper = mountExamples()
    expect(wrapper.find('.perm-picker').exists()).toBe(false)
    expect(code(wrapper)).toContain('install.ps1')
    expect(code(wrapper)).not.toContain('-Permissions')
  })
})
