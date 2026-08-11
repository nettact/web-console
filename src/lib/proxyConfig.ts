// Reverse-proxy configuration for publishing ONE status page at a domain root.
//
// This is a generator, not a template the operator fills in: getting the
// allowlist wrong is a security bug, not a typo. The rules it emits are narrow on
// purpose —
//
//   - exactly four read-only endpoints, with the slug baked into the pattern, so
//     the domain cannot serve any OTHER status page even by guessing a slug;
//   - the app's static files, which live under /status/ upstream, remapped onto
//     the root;
//   - everything else — console, admin API, agent channel, enrollment, SSE —
//     answered 404 rather than proxied.
//
// The hash route is the reason config.js is emitted rather than proxied through:
// '#/<slug>' never reaches a server, so a bare '/' can only know which page to
// show from the app's runtime config. That is what `page` is for.
//
// Kept free of i18n and of Vue so it can be unit-tested as a pure string
// function; the human-readable comments arrive as a parameter.

/** Which proxy to write for. */
export type ProxyFlavor = 'nginx' | 'caddy'

/**
 * Where the static files come from.
 *
 * 'proxy' takes them from the NetTact server (nothing to copy, and front end and
 * back end can never drift apart). 'static' serves a local copy of dist/status
 * and forwards only the API, for deployments that want a narrower channel to the
 * server — at the cost of re-copying the files on every upgrade.
 */
export type ProxyMode = 'proxy' | 'static'

/** The comment lines, so the caller can localize them. */
export interface ProxyConfigComments {
  header: string
  api: string
  config: string
  app: string
  deny: string
  root: string
}

export interface ProxyConfigInput {
  flavor: ProxyFlavor
  mode: ProxyMode
  /** Public hostname this vhost answers on. */
  domain: string
  /** The single status page slug this domain publishes. */
  slug: string
  /** Origin of the NetTact server, e.g. 'http://127.0.0.1:12450'. */
  upstream: string
  /** Filesystem root holding a copy of dist/status; 'static' mode only. */
  root: string
  comments: ProxyConfigComments
}

/** A hostname the generated file can safely contain. */
export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

export const DEFAULT_UPSTREAM = 'http://127.0.0.1:12450'

/**
 * Whether a string is an origin this generator can actually target.
 *
 * Parsed rather than pattern-matched, because the renderer resolves the host and
 * port through `new URL` later: a value a regex accepts but the parser rejects
 * (`http://:12450`, `http://host:99999`) would silently fall back to the default
 * loopback target, and the operator would deploy a file pointing at a server
 * they never named. Same answer in both places, or no answer at all.
 */
export function isValidUpstream(value: string): boolean {
  let u: URL
  try {
    u = new URL(value.trim())
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (!u.hostname) return false
  // An origin only: a path, query, fragment or credentials would land in
  // proxy_pass/reverse_proxy and change what gets requested.
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return false
  if (u.port) {
    const port = Number(u.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false
  }
  return true
}

/**
 * The server origin to pre-fill, derived from the address this console is
 * reached at.
 *
 * A console served from localhost tells us nothing about how the proxy will
 * reach the server (they are usually different machines), so that case falls
 * back to the documented default rather than emitting a loopback address the
 * operator would have to notice and fix.
 */
export function defaultUpstream(consoleUrl: string): string {
  try {
    const u = new URL(consoleUrl)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') {
      return DEFAULT_UPSTREAM
    }
    return u.port ? `${u.protocol}//${u.hostname}:${u.port}` : `${u.protocol}//${u.hostname}`
  } catch {
    return DEFAULT_UPSTREAM
  }
}

/** host:port of an origin, for nginx's upstream block. */
function hostPort(upstream: string): string {
  try {
    const u = new URL(upstream)
    if (u.port) return `${u.hostname}:${u.port}`
    return `${u.hostname}:${u.protocol === 'https:' ? 443 : 80}`
  } catch {
    return '127.0.0.1:12450'
  }
}

/** Host name alone — what a TLS upstream expects in Host and SNI. */
function upstreamHost(upstream: string): string {
  try {
    return new URL(upstream).hostname
  } catch {
    return '127.0.0.1'
  }
}

function isTLS(upstream: string): boolean {
  return upstream.trim().toLowerCase().startsWith('https:')
}

/**
 * The nginx upstream block's name, derived from the slug.
 *
 * Upstream blocks live in the global `http` scope, not in the server block — so
 * two vhosts generated from this dialog for two different pages would both
 * declare `upstream nettact` and nginx would refuse to start on the duplicate.
 * Naming it after the page keeps the files independent, which is exactly how an
 * operator publishing several boards will use them.
 */
function upstreamName(slug: string): string {
  return `nettact_${slug.replace(/-/g, '_')}`
}

/** The four public endpoints of one page, and nothing adjacent to them. */
export function endpointPattern(slug: string): string {
  return `^/api/v1/public/pages/${slug}(/(agent-statuses|target-statuses|incidents))?$`
}

/**
 * The line config.js must contain for '/' to render this page.
 *
 * `console: false` is not optional decoration on this topology. The generated
 * proxy config blocks the console, the admin API and /login by design, so the
 * board must not offer a sign-in link back to them — it would point at a door
 * this very config bricks up. It matters most precisely when the published page
 * is also the server's home page, since that is the only case where the link
 * would otherwise render.
 */
export function runtimeConfigLine(slug: string): string {
  return `window.NETTACT_STATUS_CONFIG = { apiBase: "", page: "${slug}", console: false };`
}

/** The /config.js location — identical in both modes, so neither can forget it. */
function nginxConfigLocation(slug: string): string {
  return `    location = /config.js {
        default_type application/javascript;
        add_header Cache-Control "no-store" always;
        return 200 '${runtimeConfigLine(slug)}';
    }`
}

/** The Caddy /config.js handler, matching nginxConfigLocation. */
function caddyConfigHandler(slug: string): string {
  return `\thandle /config.js {
\t\theader Content-Type "application/javascript"
\t\theader Cache-Control "no-store"
\t\trespond \`${runtimeConfigLine(slug)}\` 200
\t}`
}

/**
 * A Caddy reverse_proxy line, with the TLS host override in a block.
 *
 * `header_up` is a reverse_proxy subdirective: emitted as a sibling line it is
 * not "ignored", it makes Caddy reject the whole file — so the block form is the
 * only correct shape whenever an override is needed at all.
 */
function caddyProxy(upstream: string, tabs: number): string {
  const up = upstream.trim().replace(/\/+$/, '')
  if (!isTLS(upstream)) return `reverse_proxy ${up}`
  const pad = '\t'.repeat(tabs)
  return `reverse_proxy ${up} {\n${pad}\theader_up Host ${upstreamHost(upstream)}\n${pad}}`
}

function nginxProxyHeaders(upstream: string, indent = '        '): string {
  const i = indent
  const lines = [
    `${i}proxy_http_version 1.1;`,
    `${i}proxy_set_header Connection "";`,
    // With a TLS upstream the certificate is presented for the SERVER's name, so
    // Host has to be the upstream's — and SNI has to be sent, which nginx does
    // not do by default. proxy_ssl_name is separate from the Host header and
    // does not follow it: left alone it defaults to the proxy_pass target, which
    // for an upstream block is the block's NAME, not a host that exists.
    isTLS(upstream) ? `${i}proxy_ssl_server_name on;` : '',
    isTLS(upstream) ? `${i}proxy_ssl_name ${upstreamHost(upstream)};` : '',
    `${i}proxy_set_header Host              ${isTLS(upstream) ? upstreamHost(upstream) : '$host'};`,
    `${i}proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;`,
    `${i}proxy_set_header X-Forwarded-Proto $scheme;`,
  ]
  return lines.filter(Boolean).join('\n')
}

function nginxTLS(domain: string): string {
  return `    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;`
}

function nginxRedirect(domain: string): string {
  return `
server {
    listen 80;
    server_name ${domain};
    return 301 https://$host$request_uri;
}`
}

function nginxProxyMode(inp: ProxyConfigInput): string {
  const { domain, slug, upstream, comments: c } = inp
  const scheme = isTLS(upstream) ? 'https' : 'http'
  const up = upstreamName(slug)
  return `# /etc/nginx/conf.d/${domain}.conf
#
# ${c.header}

upstream ${up} {
    server ${hostPort(upstream)};
    keepalive 16;
}

server {
    listen 443 ssl;
    http2 on;
    server_name ${domain};

${nginxTLS(domain)}

    # ${c.config}
${nginxConfigLocation(slug)}

    # ${c.api}
    location ~ ${endpointPattern(slug)} {
        limit_except GET HEAD { deny all; }
        proxy_pass ${scheme}://${up};
${nginxProxyHeaders(upstream)}
    }

    # ${c.app}
    location = / {
        proxy_pass ${scheme}://${up}/status/;
${nginxProxyHeaders(upstream)}
    }

    location ^~ /assets/ {
        proxy_pass ${scheme}://${up}/status/assets/;
${nginxProxyHeaders(upstream)}
    }

    # ${c.deny}
    location / { return 404; }
}
${nginxRedirect(domain)}
`
}

function nginxStaticMode(inp: ProxyConfigInput): string {
  const { domain, slug, upstream, root, comments: c } = inp
  const scheme = isTLS(upstream) ? 'https' : 'http'
  return `# /etc/nginx/conf.d/${domain}.conf
#
# ${c.header}

server {
    listen 443 ssl;
    http2 on;
    server_name ${domain};

${nginxTLS(domain)}

    # ${c.root}
    root ${root};

    # ${c.config}
${nginxConfigLocation(slug)}

    # ${c.app}
    location = / {
        try_files /index.html =404;
        add_header Cache-Control "no-store" always;
    }
    location ^~ /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # ${c.api}
    location ~ ${endpointPattern(slug)} {
        limit_except GET HEAD { deny all; }
        proxy_pass ${scheme}://${hostPort(upstream)};
${nginxProxyHeaders(upstream)}
    }

    # ${c.deny}
    location / { return 404; }
}
${nginxRedirect(domain)}
`
}

function caddyProxyMode(inp: ProxyConfigInput): string {
  const { domain, slug, upstream, comments: c } = inp
  const proxy = caddyProxy(upstream, 2)
  return `# /etc/caddy/Caddyfile
#
# ${c.header}

${domain} {
\tencode zstd gzip

\t# ${c.api}
\t@public {
\t\tmethod GET HEAD
\t\tpath_regexp ${endpointPattern(slug)}
\t}
\thandle @public {
\t\t${proxy}
\t}

\t# ${c.config}
${caddyConfigHandler(slug)}

\t# ${c.app}
\thandle /assets/* {
\t\trewrite * /status{uri}
\t\t${proxy}
\t}
\thandle / {
\t\trewrite * /status/
\t\t${proxy}
\t}

\t# ${c.deny}
\thandle {
\t\trespond 404
\t}
}
`
}

function caddyStaticMode(inp: ProxyConfigInput): string {
  const { domain, slug, upstream, root, comments: c } = inp
  return `# /etc/caddy/Caddyfile
#
# ${c.header}

${domain} {
\tencode zstd gzip

\t# ${c.root}
\troot * ${root}

\t# ${c.api}
\t@public {
\t\tmethod GET HEAD
\t\tpath_regexp ${endpointPattern(slug)}
\t}
\thandle @public {
\t\t${caddyProxy(upstream, 2)}
\t}

\t# ${c.config}
${caddyConfigHandler(slug)}

\t# ${c.app}
\thandle /assets/* {
\t\theader Cache-Control "public, max-age=31536000, immutable"
\t\tfile_server
\t}
\thandle / {
\t\theader Cache-Control "no-store"
\t\tfile_server
\t}

\t# ${c.deny}
\thandle {
\t\trespond 404
\t}
}
`
}

/**
 * Renders a complete, paste-ready vhost.
 *
 * Callers must validate `domain` against DOMAIN_RE and `upstream` with
 * isValidUpstream first: both land in the file verbatim, and a Caddyfile in
 * particular is brace-structured, so an unchecked value could restructure the
 * config rather than merely misconfigure it. `slug` needs no such check — it
 * comes from the server, which accepts only [a-z0-9-].
 */
export function renderProxyConfig(inp: ProxyConfigInput): string {
  if (inp.flavor === 'caddy') {
    return inp.mode === 'proxy' ? caddyProxyMode(inp) : caddyStaticMode(inp)
  }
  return inp.mode === 'proxy' ? nginxProxyMode(inp) : nginxStaticMode(inp)
}
