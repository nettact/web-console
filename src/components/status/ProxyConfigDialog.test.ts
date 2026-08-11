import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../../locales/en'
import type { StatusPage } from '../../api'
import ProxyConfigDialog from './ProxyConfigDialog.vue'

// The dialog's job is to turn one page's slug into a config nobody has to think
// about. What is worth asserting is therefore the same thing a reviewer would
// look for in the pasted file: that the allowlist names this page and nothing
// else, and that an operator cannot copy a file built from a bad domain.

const page: StatusPage = {
  id: 'spg_1',
  site_id: 'site_default',
  slug: 'home-lab',
  title: 'Home lab status',
  description: '',
  enabled: true,
  show_target_address: false,
  show_agent_view: true,
  show_target_view: true,
  show_incidents: true,
  agent_metrics: 'basic',
  is_home: false,
  agent_group_ids: [],
  target_ids: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function render() {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  return mount(ProxyConfigDialog, {
    props: { open: true, page },
    // Render the teleported dialog in place so it is queryable from the wrapper.
    global: { plugins: [i18n], stubs: { teleport: true } },
  })
}

const code = (w: ReturnType<typeof render>) => w.find('pre').text()
const tabs = (w: ReturnType<typeof render>) => w.findAll('.segmented button')

describe('ProxyConfigDialog', () => {
  it('generates an nginx vhost scoped to this page alone', () => {
    const out = code(render())

    expect(out).toContain('server_name status.example.com;')
    expect(out).toContain('^/api/v1/public/pages/home-lab(/(agent-statuses|target-statuses|incidents))?$')
    expect(out).toContain('window.NETTACT_STATUS_CONFIG = { apiBase: "", page: "home-lab", console: false };')
    // The root serves the status app, not the console.
    expect(out).toContain('proxy_pass http://nettact_home_lab/status/;')
    // Deny by default, and no blanket API forward.
    expect(out).toContain('location / { return 404; }')
    expect(out).not.toMatch(/proxy_pass[^\n]*\/api\//)
  })

  // The selected segment has to be visibly and semantically on: with no marked
  // state the two groups read as four unrelated buttons, and nothing says which
  // dialect the block below is written in.
  it('marks the active choice in each group', async () => {
    const w = render()
    const [nginx, caddy, fromServer, localCopy] = tabs(w)

    expect(nginx.classes()).toContain('active')
    expect(nginx.attributes('aria-pressed')).toBe('true')
    expect(caddy.classes()).not.toContain('active')
    expect(caddy.attributes('aria-pressed')).toBe('false')
    expect(fromServer.classes()).toContain('active')
    expect(localCopy.classes()).not.toContain('active')

    await caddy.trigger('click')
    expect(caddy.classes()).toContain('active')
    expect(nginx.classes()).not.toContain('active')
    // Choosing a dialect must not disturb the other group.
    expect(fromServer.classes()).toContain('active')
  })

  it('switches dialect and file source from the tabs', async () => {
    const w = render()
    const [nginx, caddy, fromServer, localCopy] = tabs(w)
    expect(nginx.text()).toBe('nginx')

    await caddy.trigger('click')
    expect(code(w)).toContain('handle @public')
    expect(code(w)).toContain('rewrite * /status/')

    await localCopy.trigger('click')
    expect(code(w)).toContain('root * /var/www/nettact-status')
    expect(code(w)).toContain('file_server')
    // A local copy is served from disk, so nothing is remapped onto /status/.
    expect(code(w)).not.toContain('rewrite')

    await fromServer.trigger('click')
    await nginx.trigger('click')
    expect(code(w)).toContain('upstream nettact_home_lab {')
  })

  it('asks for the static directory only when the files are local', async () => {
    const w = render()
    expect(w.findAll('input')).toHaveLength(2)

    await tabs(w)[3].trigger('click')
    const inputs = w.findAll('input')
    expect(inputs).toHaveLength(3)
    await inputs[2].setValue('/srv/status')
    expect(code(w)).toContain('root /srv/status;')
  })

  // A domain lands in the file verbatim, and a Caddyfile is brace-structured —
  // so a rejected value must block the copy, not merely look wrong.
  it('refuses to generate from a domain that is not a host name', async () => {
    const w = render()
    await w.findAll('input')[0].setValue('status.example.com { }')

    expect(w.find('pre').text()).toContain('Fill in the fields above')
    expect(w.find('button.copy').attributes('disabled')).toBeDefined()
  })

  it('rejects a server address that is not an origin', async () => {
    const w = render()
    await w.findAll('input')[1].setValue('127.0.0.1:12450')

    expect(w.find('button.copy').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Enter an origin')
  })

  it('adapts the generated config to an https server address', async () => {
    const w = render()
    await w.findAll('input')[1].setValue('https://nettact.internal:12450')

    expect(code(w)).toContain('proxy_ssl_server_name on;')
    expect(code(w)).toContain('proxy_pass https://nettact_home_lab;')
  })
})
