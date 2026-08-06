import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import LocalAgentServers from './LocalAgentServers.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { api, type LocalAgentServer } from '../api'
import { permissionCatalog } from '../permissionCatalog'

vi.mock('../api', () => ({
  api: {
    localAgentServers: vi.fn(),
    addLocalAgentServer: vi.fn(),
    removeLocalAgentServer: vi.fn(),
    setLocalAgentServerPermissions: vi.fn(),
    // permissionCatalog.ts reaches for this on mount; the tests seed the shared
    // catalog directly instead, so it must merely exist.
    permissionCatalog: vi.fn().mockResolvedValue({ permissions: [], bundles: [] }),
  },
}))

const listServers = vi.mocked(api.localAgentServers)
const addServer = vi.mocked(api.addLocalAgentServer)
const removeServer = vi.mocked(api.removeLocalAgentServer)
const setPermissions = vi.mocked(api.setLocalAgentServerPermissions)

// Same miniature catalog shape the enrollment picker's tests use: a real
// dependency chain so the reused selection helpers are actually exercised.
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
      ]
    : []
}

function server(over: Partial<LocalAgentServer> = {}): LocalAgentServer {
  return {
    name: 'home',
    url: 'https://home.example:12450',
    tls_insecure: false,
    permissions: RECOMMENDED,
    enrolled: true,
    status: { state: 'connected', agent_id: 'agt_1', since: '2026-08-06T10:00:00Z' },
    ...over,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

// The panel polls for as long as it is mounted, so a page left standing after a
// test keeps a live timer that fires into the next one. Unmounting everything
// between tests is what keeps the call counts below meaningful.
enableAutoUnmount(afterEach)

async function render(rows: LocalAgentServer[] = []) {
  listServers.mockResolvedValue(rows)
  const page = mount(LocalAgentServers, {
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  await flush()
  return page
}

type Page = Awaited<ReturnType<typeof render>>

const addBtn = (p: Page) => p.get('.las-form .btn-primary')
const presetInputs = (p: Page) => p.findAll('.las-preset input')

beforeEach(() => {
  vi.clearAllMocks()
  addServer.mockResolvedValue(server())
  removeServer.mockResolvedValue(undefined)
  setPermissions.mockResolvedValue(undefined)
  seedCatalog()
})

describe('LocalAgentServers list', () => {
  it('explains the feature when nothing is configured', async () => {
    const page = await render([])
    expect(page.find('.las-empty').exists()).toBe(true)
    expect(page.text()).toContain('report to another NetTact server')
    expect(page.findAll('.las-row')).toHaveLength(0)
  })

  it('renders each configured server with its state, address and permissions', async () => {
    const page = await render([
      server(),
      server({
        name: 'work',
        url: 'https://work.example',
        tls_insecure: true,
        permissions: ['probe.icmp'],
        status: { state: 'connecting' },
      }),
    ])

    const rows = page.findAll('.las-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('home')
    expect(rows[0].text()).toContain('https://home.example:12450')
    expect(rows[0].find('.badge').text()).toBe('Connected')
    // Permission summaries are names, never raw ids.
    expect(rows[0].text()).toContain('ICMP probe')
    expect(rows[0].text()).not.toContain('probe.icmp')
    expect(rows[1].find('.badge').text()).toBe('Connecting')
    expect(rows[1].text()).toContain('Certificate not checked')
  })

  it('renders every connection state, and its error, with a distinct badge tone', async () => {
    const page = await render([
      server({ name: 'a', status: { state: 'enroll_failed', last_error: 'token already used' } }),
      server({ name: 'b', status: { state: 'superseded' } }),
      server({ name: 'c', status: { state: 'revoked' } }),
      server({ name: 'd', status: { state: 'stopped' } }),
    ])

    const rows = page.findAll('.las-row')
    expect(rows[0].find('.badge').classes()).toContain('bad')
    expect(rows[1].find('.badge').classes()).toContain('warn')
    expect(rows[2].find('.badge').classes()).toContain('bad')
    expect(rows[3].find('.badge').classes()).toContain('neutral')

    // The server's raw error is surfaced verbatim…
    expect(rows[0].find('.las-last-error').text()).toContain('token already used')
    // …and a failed sign-up gets the only advice that actually works: the token
    // was one-time and is gone, so mint a new one rather than retry this row.
    const fix = rows[0].find('.las-fix').text()
    expect(fix).toContain('used once')
    expect(fix).toContain('24 hours')
    expect(rows[1].find('.las-fix').exists()).toBe(false)
  })

  // The app serving this console is versioned separately from the console, and
  // the API contract says readers MUST tolerate a state they do not know. A bare
  // t() renders a missing message as its own key path, which would put
  // "settings.localAgent.state.quarantined" in a status badge.
  it('labels a state from a newer host generically instead of leaking the i18n key', async () => {
    const page = await render([server({ status: { state: 'quarantined' } })])

    const badge = page.get('.las-row .badge')
    expect(badge.text()).not.toContain('settings.localAgent')
    expect(badge.text()).toContain('Unknown state')
    // The raw code stays visible: it is what a user would quote asking for help.
    expect(badge.text()).toContain('quarantined')
    // An unrecognised state is not an error state.
    expect(badge.classes()).toContain('neutral')
  })

  // "Added, nothing has happened yet" is the ordinary state of a fresh entry, and
  // Go's zero time is a perfectly parseable RFC 3339 string — so a host that lets
  // one through would have this panel announce the year 1.
  it('renders no timestamp for an absent, zero or unparseable one', async () => {
    const page = await render([
      server({ name: 'a', status: { state: 'connecting' } }),
      server({ name: 'b', status: { state: 'connecting', since: '0001-01-01T00:00:00Z' } }),
      server({ name: 'c', status: { state: 'connecting', since: 'not a date' } }),
      server({ name: 'd', status: { state: 'connected', since: '2026-08-06T10:00:00Z' } }),
    ])

    const rows = page.findAll('.las-row')
    for (const row of rows.slice(0, 3)) {
      expect(row.text()).not.toContain('since')
      expect(row.text()).not.toContain('1/1/1')
      expect(row.text()).not.toContain('Invalid Date')
    }
    expect(rows[3].text()).toContain('since')
  })

  // Nothing here is pushed: the desktop defers its agent restart, enrollment
  // lands seconds later still, and a refused token only shows up once it has been
  // tried. Without a poll a working server sits at "Connecting" until the page is
  // remounted, and enroll_failed is invisible for just as long.
  it('re-reads the list on a timer while mounted, and stops on unmount', async () => {
    vi.useFakeTimers()
    try {
      listServers.mockResolvedValue([server({ status: { state: 'connecting' } })])
      const page = mount(LocalAgentServers, {
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
      })
      await flushPromises()
      expect(listServers).toHaveBeenCalledTimes(1)
      expect(page.get('.las-row .badge').text()).toBe('Connecting')

      listServers.mockResolvedValue([server({ status: { state: 'connected' } })])
      await vi.advanceTimersByTimeAsync(5000)
      expect(listServers).toHaveBeenCalledTimes(2)
      expect(page.get('.las-row .badge').text()).toBe('Connected')

      page.unmount()
      await vi.advanceTimersByTimeAsync(30000)
      expect(listServers).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  // A poll the user did not ask for must not replace the panel with an error or
  // throw away the rows already on screen.
  it('keeps the last good list when a poll fails', async () => {
    vi.useFakeTimers()
    try {
      listServers.mockResolvedValue([server()])
      const page = mount(LocalAgentServers, {
        global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
      })
      await flushPromises()

      listServers.mockRejectedValue(new Error('desktop is restarting'))
      await vi.advanceTimersByTimeAsync(5000)

      expect(page.findAll('.las-row')).toHaveLength(1)
      expect(page.text()).not.toContain('desktop is restarting')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('LocalAgentServers add flow', () => {
  it('sends the pasted address, token and chosen permissions, then refreshes', async () => {
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example:12450')
    await page.get('.las-token').setValue('tok_abc123')
    await presetInputs(page)[1].setValue() // host_metrics
    await addBtn(page).trigger('click')
    await flush()

    expect(addServer).toHaveBeenCalledTimes(1)
    expect(addServer.mock.calls[0][0]).toEqual({
      url: 'https://work.example:12450',
      enroll_token: 'tok_abc123',
      permissions: HOST_METRICS,
    })
    // Refreshed after the mutation: the new row's live state only exists server-side.
    expect(listServers).toHaveBeenCalledTimes(2)
  })

  it('never renders the enrollment token back after saving it', async () => {
    // The token is write-only — the server does not return it and the console
    // must not keep a copy on screen where a screenshot or a shoulder catches it.
    listServers.mockResolvedValue([])
    const page = mount(LocalAgentServers, {
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
    })
    await flush()
    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example:12450')
    await page.get('.las-token').setValue('tok_secret_value')

    listServers.mockResolvedValue([server({ name: 'work', url: 'https://work.example:12450' })])
    await addBtn(page).trigger('click')
    await flush()

    expect(page.html()).not.toContain('tok_secret_value')
    expect((page.get('.las-token').element as HTMLInputElement).value).toBe('')
  })

  it('carries the optional name and certificate switch only when they are set', async () => {
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example')
    await page.get('.las-token').setValue('tok')
    await page.get('.las-field:nth-of-type(3) input').setValue('work-server')
    await page.get('.las-check input').setValue(true)
    await addBtn(page).trigger('click')
    await flush()

    expect(addServer.mock.calls[0][0]).toMatchObject({ name: 'work-server', tls_insecure: true })
  })

  // The API's name charset is narrow (it is a URL path segment on every other
  // route), so the friendly label a "name" field invites — capitals, a space —
  // is a 400 rather than a label. Normalize to the grammar the server derives a
  // name with, instead of bouncing the user off an error they cannot see coming.
  it('normalizes a typed name into the charset the API accepts', async () => {
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example')
    await page.get('.las-token').setValue('tok')
    await page.get('.las-field:nth-of-type(3) input').setValue('  Work Server (HQ) ')
    await addBtn(page).trigger('click')
    await flush()

    expect(addServer.mock.calls[0][0].name).toBe('work-server--hq-')
  })

  it('refuses the reserved name and a name with nothing usable in it', async () => {
    for (const typed of ['local', '!!!', '---']) {
      vi.clearAllMocks()
      const page = await render([])
      await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example')
      await page.get('.las-token').setValue('tok')
      await page.get('.las-field:nth-of-type(3) input').setValue(typed)
      await addBtn(page).trigger('click')
      await flush()

      expect(addServer, typed).not.toHaveBeenCalled()
      expect(page.get('.las-form .err').text()).not.toContain('settings.localAgent')
    }
  })

  it('omits permissions on the recommended preset so the Agent applies its default', async () => {
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example')
    await page.get('.las-token').setValue('tok')
    await addBtn(page).trigger('click')
    await flush()

    expect(addServer.mock.calls[0][0]).not.toHaveProperty('permissions')
  })

  // The other half of that rule, and the one that used to be a security bug: an
  // operator who unticks every box on the screen whose whole purpose is
  // withholding must not have the recommended set granted back to them. Omitting
  // the key means "you choose"; sending [] means "grant nothing", and the two are
  // different requests.
  it('sends an explicitly empty grant rather than omitting the field', async () => {
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example')
    await page.get('.las-token').setValue('tok')
    await presetInputs(page)[2].setValue() // custom, seeded from recommended
    for (const box of page.findAll<HTMLInputElement>('.las-perm-item input')) {
      if (box.element.checked) await box.trigger('change')
    }
    await addBtn(page).trigger('click')
    await flush()

    expect(addServer.mock.calls[0][0]).toHaveProperty('permissions')
    expect(addServer.mock.calls[0][0].permissions).toEqual([])
  })

  it('pulls in required parents when a child permission is ticked', async () => {
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example')
    await page.get('.las-token').setValue('tok')
    await presetInputs(page)[2].setValue() // custom, seeded from recommended
    // Clear the seed, then tick only the child.
    for (const box of page.findAll<HTMLInputElement>('.las-perm-item input')) {
      if (box.element.checked) await box.trigger('change')
    }
    const wifi = page.findAll('.las-perm-item').find((l) => l.text().includes('Wi-Fi status read'))!
    await wifi.find('input').trigger('change')
    await addBtn(page).trigger('click')
    await flush()

    // A child without its parent is a policy the Agent refuses to start on.
    expect(addServer.mock.calls[0][0].permissions).toEqual([
      'network.interface.status.read',
      'network.wifi.status.read',
    ])
  })

  it('normalizes a trailing slash and a shouty scheme', async () => {
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('HTTPS://work.example:12450/')
    await page.get('.las-token').setValue('tok')
    await addBtn(page).trigger('click')
    await flush()

    expect(addServer.mock.calls[0][0].url).toBe('https://work.example:12450')
  })

  it('rejects a non-http address without calling the API', async () => {
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('work.example')
    await page.get('.las-token').setValue('tok')
    await addBtn(page).trigger('click')
    await flush()

    expect(addServer).not.toHaveBeenCalled()
    expect(page.get('.las-form .err').text()).toContain('http://')
  })

  it('surfaces the server error and keeps the pasted values on failure', async () => {
    addServer.mockRejectedValue(new Error('enrollment token expired'))
    const page = await render([])
    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example')
    await page.get('.las-token').setValue('tok')
    await addBtn(page).trigger('click')
    await flush()

    expect(page.get('.las-form .err').text()).toContain('enrollment token expired')
    expect((page.get('.las-token').element as HTMLInputElement).value).toBe('tok')
  })
})

describe('LocalAgentServers permission editing', () => {
  it('seeds the editor from the row and PUTs the new set', async () => {
    const page = await render([server({ permissions: RECOMMENDED })])
    await page.get('.las-edit').trigger('click')

    // The grant still equals a named preset, so show that rather than a
    // hand-ticked list that happens to match it.
    expect(page.text()).toContain('What home may collect')
    expect((presetInputs(page)[0].element as HTMLInputElement).checked).toBe(true)
    // Address and token fields belong to adding, not re-permissioning.
    expect(page.find('.las-token').exists()).toBe(false)

    await presetInputs(page)[1].setValue() // host_metrics
    await page.get('.las-form .btn-primary').trigger('click')
    await flush()

    expect(setPermissions).toHaveBeenCalledWith('home', HOST_METRICS)
    expect(addServer).not.toHaveBeenCalled()
    expect(listServers).toHaveBeenCalledTimes(2)
    // Back to the add form once saved.
    expect(page.find('.las-token').exists()).toBe(true)
  })

  it('opens on a custom selection when the grant matches no preset', async () => {
    const page = await render([server({ permissions: ['probe.icmp', 'host.cpu.read'] })])
    await page.get('.las-edit').trigger('click')

    const inputs = presetInputs(page)
    expect((inputs[inputs.length - 1].element as HTMLInputElement).checked).toBe(true)
    const ticked = page
      .findAll<HTMLInputElement>('.las-perm-item input')
      .filter((b) => b.element.checked)
    expect(ticked).toHaveLength(2)
  })

  // Revoking has to reach the server as a revocation. The API reads [] literally
  // and only an absent field means "use your recommended default", so a console
  // that sent nothing here would re-grant everything the operator just cleared.
  it('PUTs an empty array when every permission is cleared', async () => {
    const page = await render([server({ permissions: RECOMMENDED })])
    await page.get('.las-edit').trigger('click')
    await presetInputs(page)[2].setValue() // custom, seeded from the row
    for (const box of page.findAll<HTMLInputElement>('.las-perm-item input')) {
      if (box.element.checked) await box.trigger('change')
    }
    await page.get('.las-form .btn-primary').trigger('click')
    await flush()

    expect(setPermissions).toHaveBeenCalledWith('home', [])
  })

  // A stored grant of nothing is a real answer coming back out, not "unspecified".
  it('says a server collects nothing when its stored grant is empty', async () => {
    const page = await render([server({ permissions: [] })])
    expect(page.get('.las-row').text()).toContain('Collects nothing')
  })

  it('abandons the edit on cancel', async () => {
    const page = await render([server()])
    await page.get('.las-edit').trigger('click')
    const buttons = page.findAll('.las-form .btn')
    await buttons[buttons.length - 1].trigger('click')

    expect(setPermissions).not.toHaveBeenCalled()
    expect(page.find('.las-token').exists()).toBe(true)
  })
})

describe('LocalAgentServers removal', () => {
  it('confirms before removing, then refreshes the list', async () => {
    const page = await render([server()])
    const dialog = page.findComponent(ConfirmDialog)
    expect(dialog.props('open')).toBe(false)

    await page.get('.las-remove').trigger('click')
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('message')[0]).toContain('home')

    dialog.vm.$emit('confirm')
    await flush()

    expect(removeServer).toHaveBeenCalledWith('home')
    expect(listServers).toHaveBeenCalledTimes(2)
    expect(dialog.props('open')).toBe(false)
  })

  it('removes nothing when the confirmation is cancelled', async () => {
    const page = await render([server()])
    await page.get('.las-remove').trigger('click')
    page.findComponent(ConfirmDialog).vm.$emit('cancel')
    await flush()

    expect(removeServer).not.toHaveBeenCalled()
    expect(page.findComponent(ConfirmDialog).props('open')).toBe(false)
  })
})

describe('LocalAgentServers without a catalog', () => {
  it('still allows adding, on the Agent default policy, and hides the editor', async () => {
    // Losing an optional chooser must not block the feature — but it must also
    // not offer an "edit permissions" action that could only ever PUT an empty set.
    seedCatalog(false)
    const page = await render([server()])
    expect(page.find('.las-perms').exists()).toBe(false)
    expect(page.find('.las-edit').exists()).toBe(false)

    await page.get('.las-field:nth-of-type(1) input').setValue('https://work.example')
    await page.get('.las-token').setValue('tok')
    await addBtn(page).trigger('click')
    await flush()

    expect(addServer.mock.calls[0][0]).toEqual({
      url: 'https://work.example',
      enroll_token: 'tok',
    })
  })
})
