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
  // Windows-only (component-backed) — the picker must flag it off Windows.
  { id: 'game.process.detect', default: false },
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
        { id: 'full', permissions: [...HOST_METRICS, 'network.wifi.ssid.read', 'game.process.detect'] },
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
    await wrapper.findAll('input[type="radio"]')[2].setValue() // full — includes game.process.detect

    // On Windows the game capture is component-backed, not a platform gap; on
    // macOS the build has no such component at all, so the hard warning shows.
    // (ICMP no longer serves as the trigger here — macOS implements it now.)
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

describe('EnrollExamples OpenWrt tab', () => {
  beforeEach(() => {
    seedCatalog()
    seedConsoleBase()
  })

  // The OpenWrt tab is last, so the indices every other test uses stay put.
  const openOpenwrt = async (w: ReturnType<typeof mountExamples>) => {
    await w.findAll('.tab')[4].trigger('click')
    return w
  }

  it('offers the router installer with the console address and token', async () => {
    const wrapper = await openOpenwrt(mountExamples())

    // wget, not curl: OpenWrt images carry uclient-fetch and usually no curl.
    // Downloaded then run, NOT piped: `sh -s` on empty stdin exits 0, so a
    // failed download would look exactly like a successful install.
    expect(code(wrapper)).toContain('wget -O /tmp/nettact-openwrt.sh https://d.nettact.org/agent/openwrt.sh &&')
    expect(code(wrapper)).toContain('sh /tmp/nettact-openwrt.sh')
    expect(code(wrapper)).not.toContain('| sh -s')
    expect(code(wrapper)).toContain(`--server-url 'https://net'"'"'tact.example:12450'`)
    expect(code(wrapper)).toContain(`--token 'to'"'"'ken'`)
  })

  it('carries no auto-update flag, because a router has no such mechanism', async () => {
    const wrapper = await openOpenwrt(mountExamples())
    expect(code(wrapper)).not.toContain('--auto-update')
    // The checkbox is hidden rather than left there doing nothing.
    expect(wrapper.find('.auto-update').exists()).toBe(false)
  })

  it('states every choice, including the defaults', async () => {
    // The installer only touches a setting the command names, so omitting a
    // default would leave a rerun on whatever the router already had while the
    // console displayed something else.
    const wrapper = await openOpenwrt(mountExamples())
    expect(code(wrapper)).toContain('--mode ram')
    expect(code(wrapper)).toContain(`--permissions 'default'`)

    const flash = wrapper.findAll<HTMLInputElement>('input[type="radio"]')[1]
    await flash.setValue()
    expect(code(wrapper)).toContain('--mode flash')
  })

  it('carries the chosen permission policy like the other unix platforms', async () => {
    const wrapper = mountExamples()
    await wrapper.findAll('input[type="radio"]')[1].setValue() // host_metrics
    await openOpenwrt(wrapper)
    expect(code(wrapper)).toContain(`--permissions '${HOST_METRICS.join(',')}'`)
  })

  it('shows the manual route on request, matching the one-command install', async () => {
    const wrapper = await openOpenwrt(mountExamples())

    // Collapsed by default — the one-command install is the primary path — but
    // the documentation link is not hidden behind the toggle.
    expect(wrapper.find('.manual-steps').exists()).toBe(false)
    expect(wrapper.find('.manual-head a').attributes('href')).toBe('https://nettact.org/en/openwrt')

    await wrapper.find('.manual .link-btn').trigger('click')
    const manual = wrapper.find('.manual-steps').text()
    expect(manual).toContain('opkg install https://d.nettact.org/agent/nettact-agent.ipk')
    expect(manual).toContain('opkg install https://d.nettact.org/agent/luci-app-nettact.ipk')
    expect(manual).toContain("uci set nettact.main.server_url='https://net'\"'\"'tact.example:12450'")
    expect(manual).toContain("uci set nettact.main.enabled='1'")
    expect(manual).toContain('/etc/init.d/nettact enable')
  })

  it('mirrors the installer on the three settings a rerun depends on', async () => {
    const wrapper = await openOpenwrt(mountExamples())
    await wrapper.find('.manual .link-btn').trigger('click')
    const manual = wrapper.find('.manual-steps').text()

    // A router previously set up for several servers reads its `config server`
    // sections and ignores the url/token written here unless mode is forced.
    expect(manual).toContain("uci set nettact.main.server_mode='single'")
    // `start` is a no-op on a running service, so the settings just written
    // would not take effect until something else restarted it.
    expect(manual).toContain('/etc/init.d/nettact restart')
    expect(manual).not.toContain('/etc/init.d/nettact start')
    // add_list appends, so a rerun would union with the previous grant.
    expect(manual).toContain('uci -q delete nettact.main.permissions')
  })

  it('renders a custom grant as the UCI mode plus list it actually needs', async () => {
    const wrapper = mountExamples()
    await wrapper.findAll('input[type="radio"]')[1].setValue() // host_metrics
    await openOpenwrt(wrapper)
    await wrapper.find('.manual .link-btn').trigger('click')

    // UCI models a grant as a mode plus an optional list; emitting only the ids
    // would leave permission_mode at 'default' and grant something else entirely.
    const manual = wrapper.find('.manual-steps').text()
    expect(manual).toContain("uci set nettact.main.permission_mode='custom'")
    for (const id of HOST_METRICS) {
      expect(manual).toContain(`uci add_list nettact.main.permissions='${id}'`)
    }
  })

  it('writes an explicit default mode at the default policy', async () => {
    const wrapper = await openOpenwrt(mountExamples())
    await wrapper.find('.manual .link-btn').trigger('click')
    // Emitting nothing here would leave an earlier `none`/`custom` grant in
    // place on a rerun, which is not what "recommended" was asked for.
    const manual = wrapper.find('.manual-steps').text()
    expect(manual).toContain("uci set nettact.main.permission_mode='default'")
    expect(manual).not.toContain('uci add_list')
  })

  it('installs a TLS transport, not just the CA store', async () => {
    // On a stripped image ca-bundle alone leaves opkg with no HTTPS transport,
    // so the very next line — fetching an .ipk over https — fails.
    const wrapper = await openOpenwrt(mountExamples())
    await wrapper.find('.manual .link-btn').trigger('click')
    const manual = wrapper.find('.manual-steps').text()
    expect(manual).toContain('opkg install ca-bundle')
    // …but only when the image has no provider: swapping a working openssl or
    // wolfssl backend for mbedtls is not this command's business.
    expect(manual).toContain("opkg list-installed | grep -q '^libustream-' || opkg install libustream-mbedtls")
  })
})

describe('EnrollExamples OpenWrt reinstall', () => {
  beforeEach(() => {
    seedCatalog()
    seedConsoleBase()
  })

  const mountReinstall = () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    return mount(EnrollExamples, {
      props: { token: 'bound-token', reinstall: true },
      global: { plugins: [i18n] },
    })
  }

  // The reinstall dialog promises the install "wipes the machine's local
  // identity and queued telemetry". Every other platform's installer does; the
  // router deliberately keeps /etc/nettact, so it has to be told.
  it('clears the saved credential so the bound token is actually used', async () => {
    const wrapper = mountReinstall()
    await wrapper.findAll('.tab')[4].trigger('click')

    expect(wrapper.find('pre').text()).toContain('--reinstall')

    await wrapper.find('.manual .link-btn').trigger('click')
    const manual = wrapper.find('.manual-steps').text()
    expect(manual).toContain('rm -f /etc/nettact/data/agent.json')
    expect(manual).toContain('rm -rf /etc/nettact/data/wal')
    // The wipe comes after the config is committed, so a typo aborts with the
    // working credential still in place — the order the installer uses.
    expect(manual.indexOf('uci commit nettact')).toBeLessThan(manual.indexOf('rm -f /etc/nettact/data/agent.json'))
  })

  it('does not promise the identity is kept while reinstalling', async () => {
    const wrapper = mountReinstall()
    await wrapper.findAll('.tab')[4].trigger('click')
    // The ordinary callout says a reinstall never means enrolling again, which
    // is the opposite of what this dialog just did.
    expect(wrapper.text()).not.toContain('never means enrolling again')
    expect(wrapper.text()).toContain('discards')
  })

  it('leaves the other platforms untouched', async () => {
    const wrapper = mountReinstall()
    expect(wrapper.find('pre').text()).not.toContain('--reinstall')
  })
})
