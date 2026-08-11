import { describe, it, expect } from 'vitest'
import {
  DEFAULT_UPSTREAM,
  DOMAIN_RE,
  defaultUpstream,
  endpointPattern,
  isValidUpstream,
  renderProxyConfig,
  runtimeConfigLine,
  type ProxyConfigInput,
} from './proxyConfig'

const BACKTICK = String.fromCharCode(96)

const comments = {
  header: 'one page only',
  api: 'public endpoints',
  config: 'runtime config',
  app: 'the app',
  deny: 'everything else',
  root: 'static copy',
}

function input(over: Partial<ProxyConfigInput> = {}): ProxyConfigInput {
  return {
    flavor: 'nginx',
    mode: 'proxy',
    domain: 'status.example.com',
    slug: 'home-lab',
    upstream: 'http://127.0.0.1:12450',
    root: '/var/www/nettact-status',
    comments,
    ...over,
  }
}

// The allowlist is the security property of the whole feature, so it is asserted
// against a real regex rather than by string comparison: the question is not
// "does the file contain the slug" but "what does this pattern let through".
describe('endpointPattern', () => {
  const re = new RegExp(endpointPattern('home-lab'))

  it('matches exactly the four endpoints of that page', () => {
    expect(re.test('/api/v1/public/pages/home-lab')).toBe(true)
    expect(re.test('/api/v1/public/pages/home-lab/agent-statuses')).toBe(true)
    expect(re.test('/api/v1/public/pages/home-lab/target-statuses')).toBe(true)
    expect(re.test('/api/v1/public/pages/home-lab/incidents')).toBe(true)
  })

  it('does not expose any other status page', () => {
    expect(re.test('/api/v1/public/pages/office')).toBe(false)
    // A slug this one is a prefix of: the anchored $ is what stops it.
    expect(re.test('/api/v1/public/pages/home-lab-2')).toBe(false)
    expect(re.test('/api/v1/public/pages/home-lab2/incidents')).toBe(false)
  })

  it('does not expose the console, the agent channel or enrollment', () => {
    for (const p of [
      '/api/v1/sites',
      '/api/v1/auth/login',
      '/api/v1/agents',
      '/api/v1/agent/ws',
      '/api/v1/enroll',
      '/api/v1/events',
      '/api/v1/public/pages/home-lab/../../sites',
    ]) {
      expect(re.test(p), p).toBe(false)
    }
  })
})

describe('runtimeConfigLine', () => {
  it('names the page and keeps the API same-origin', () => {
    expect(runtimeConfigLine('home-lab')).toBe(
      'window.NETTACT_STATUS_CONFIG = { apiBase: "", page: "home-lab" };',
    )
  })
})

describe('defaultUpstream', () => {
  it('keeps a real origin the proxy could actually dial', () => {
    expect(defaultUpstream('https://nettact.example.com')).toBe('https://nettact.example.com')
    expect(defaultUpstream('http://10.0.0.5:12450/')).toBe('http://10.0.0.5:12450')
  })

  // A loopback console says nothing about how a separate proxy host reaches the
  // server, so the documented default is the more useful pre-fill.
  it('falls back for a loopback console or a broken URL', () => {
    expect(defaultUpstream('http://localhost:12450')).toBe(DEFAULT_UPSTREAM)
    expect(defaultUpstream('http://127.0.0.1:12450')).toBe(DEFAULT_UPSTREAM)
    expect(defaultUpstream('not a url')).toBe(DEFAULT_UPSTREAM)
  })
})

describe('input validation', () => {
  it('accepts hostnames and rejects anything that could restructure the file', () => {
    expect(DOMAIN_RE.test('status.example.com')).toBe(true)
    expect(DOMAIN_RE.test('nettact.org')).toBe(true)
    expect(DOMAIN_RE.test('status')).toBe(false)
    expect(DOMAIN_RE.test('status.example.com { }')).toBe(false)
    expect(DOMAIN_RE.test('a.com\nevil.com')).toBe(false)
    expect(DOMAIN_RE.test('https://status.example.com')).toBe(false)
  })

  it('accepts origins and rejects paths or junk', () => {
    expect(isValidUpstream('http://127.0.0.1:12450')).toBe(true)
    expect(isValidUpstream('https://nettact.example.com')).toBe(true)
    expect(isValidUpstream('http://[::1]:12450')).toBe(true)
    expect(isValidUpstream('http://127.0.0.1:12450/status')).toBe(false)
    expect(isValidUpstream('127.0.0.1:12450')).toBe(false)
    expect(isValidUpstream('ftp://host')).toBe(false)
  })

  // These are the values a regex over the raw string waves through but `new URL`
  // rejects — the renderer would then fall back to its default loopback target
  // and hand the operator a file aimed at a server they never named.
  it('rejects anything the renderer could not resolve', () => {
    expect(isValidUpstream('http://:12450')).toBe(false)
    expect(isValidUpstream('http://host:99999')).toBe(false)
    expect(isValidUpstream('http://user:pw@host')).toBe(false)
    expect(isValidUpstream('http://host?q=1')).toBe(false)
    expect(isValidUpstream('')).toBe(false)
  })
})

describe('renderProxyConfig', () => {
  const all: Array<[string, ProxyConfigInput]> = [
    ['nginx/proxy', input()],
    ['nginx/static', input({ mode: 'static' })],
    ['caddy/proxy', input({ flavor: 'caddy' })],
    ['caddy/static', input({ flavor: 'caddy', mode: 'static' })],
  ]

  it.each(all)('%s closes everything it does not name', (_name, inp) => {
    const out = renderProxyConfig(inp)
    expect(out).toContain(endpointPattern('home-lab'))
    expect(out).toContain(runtimeConfigLine('home-lab'))
    expect(out).toContain('status.example.com')
    // The deny-by-default rule, in whichever dialect.
    expect(out).toMatch(/location \/ \{ return 404; \}|respond 404/)
    // No rule may forward the API wholesale.
    expect(out).not.toMatch(/proxy_pass[^\n]*\/api\//)
    expect(out).not.toContain('path /api/*')
  })

  it('nginx proxy mode remaps the root onto the upstream /status/', () => {
    const out = renderProxyConfig(input())
    expect(out).toContain('location = / {')
    expect(out).toContain('proxy_pass http://nettact_home_lab/status/;')
    expect(out).toContain('proxy_pass http://nettact_home_lab/status/assets/;')
    expect(out).toContain('server 127.0.0.1:12450;')
    // Port 80 exists only to send people to 443.
    expect(out).toContain('return 301 https://$host$request_uri;')
  })

  // upstream blocks are global to nginx's http scope, so two generated vhosts
  // would collide on a fixed name and nginx would refuse to start.
  it('names the nginx upstream after the page', () => {
    expect(renderProxyConfig(input())).toContain('upstream nettact_home_lab {')
    expect(renderProxyConfig(input({ slug: 'office' }))).toContain('upstream nettact_office {')
    expect(renderProxyConfig(input())).not.toContain('upstream nettact {')
  })

  // Whichever mode the operator picks, the bare domain has to know its page: a
  // freshly copied dist/status ships page: '' and would render the empty state.
  it.each(all)('%s serves the runtime config from the proxy', (_name, inp) => {
    const out = renderProxyConfig(inp)
    const line = runtimeConfigLine('home-lab')
    if (inp.flavor === 'nginx') {
      expect(out).toContain("return 200 '" + line + "';")
    } else {
      expect(out).toContain('respond ' + BACKTICK + line + BACKTICK + ' 200')
    }
    // Never as a comment the operator has to remember to act on.
    expect(out).not.toContain('#   ' + line)
  })

  it('caddy proxy mode rewrites into /status and ends with the catch-all', () => {
    const out = renderProxyConfig(input({ flavor: 'caddy' }))
    expect(out).toContain('rewrite * /status{uri}')
    expect(out).toContain('rewrite * /status/')
    // handle blocks match in written order, so the 404 must be last.
    expect(out.indexOf('respond 404')).toBeGreaterThan(out.indexOf('handle @public'))
    expect(out.trimEnd().endsWith('}')).toBe(true)
    const braces = [...out].reduce((n, ch) => n + (ch === '{' ? 1 : ch === '}' ? -1 : 0), 0)
    expect(braces).toBe(0)
  })

  it('static mode serves local files and proxies only the API', () => {
    const nginx = renderProxyConfig(input({ mode: 'static' }))
    expect(nginx).toContain('root /var/www/nettact-status;')
    expect(nginx).toContain('try_files /index.html =404;')
    expect(nginx).not.toContain('/status/')

    const caddy = renderProxyConfig(input({ flavor: 'caddy', mode: 'static' }))
    expect(caddy).toContain('root * /var/www/nettact-status')
    expect(caddy).toContain('file_server')
    expect(caddy).not.toContain('rewrite')
  })

  // A TLS upstream presents a certificate for its own name, so Host and SNI have
  // to follow it rather than the public domain.
  it('adapts to an https upstream', () => {
    const nginx = renderProxyConfig(input({ upstream: 'https://nettact.internal:12450' }))
    expect(nginx).toContain('proxy_ssl_server_name on;')
    // SNI does not follow the Host header, and left alone it would be the
    // upstream BLOCK's name rather than a host that exists anywhere.
    expect(nginx).toContain('proxy_ssl_name nettact.internal;')
    expect(nginx).toContain('proxy_set_header Host              nettact.internal;')
    expect(nginx).toContain('proxy_pass https://nettact_home_lab;')
  })

  // header_up is a reverse_proxy subdirective: as a sibling line Caddy rejects
  // the whole file rather than ignoring it.
  it('puts the Caddy host override inside the reverse_proxy block', () => {
    const caddy = renderProxyConfig(input({ flavor: 'caddy', upstream: 'https://nettact.internal:12450' }))
    expect(caddy).toContain('reverse_proxy https://nettact.internal:12450 {')
    expect(caddy).toMatch(/reverse_proxy [^\n]*\{\n\t+header_up Host nettact\.internal\n\t+\}/)
    expect(caddy).not.toMatch(/reverse_proxy [^\n{]*\n\s*header_up/)

    // A plain http upstream needs no override, and so gets no block.
    const plain = renderProxyConfig(input({ flavor: 'caddy' }))
    expect(plain).toContain('reverse_proxy http://127.0.0.1:12450\n')
    expect(plain).not.toContain('header_up')

    // The extra block must not leave the file unbalanced.
    const braces = [...caddy].reduce((n, ch) => n + (ch === '{' ? 1 : ch === '}' ? -1 : 0), 0)
    expect(braces).toBe(0)
  })

  // An IPv6 literal keeps its brackets: splitting host:port on ':' truncates it.
  it('keeps an IPv6 upstream intact', () => {
    const out = renderProxyConfig(input({ upstream: 'https://[2001:db8::1]:12450' }))
    expect(out).toContain('server [2001:db8::1]:12450;')
    expect(out).toContain('proxy_ssl_name [2001:db8::1];')
  })

  it('carries the caller-supplied comments', () => {
    const out = renderProxyConfig(input())
    expect(out).toContain('# one page only')
    expect(out).toContain('# public endpoints')
    expect(out).toContain('# everything else')
  })
})
