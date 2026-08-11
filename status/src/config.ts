// Where the public API lives, read once from the runtime config the shell loads.
//
// Empty means same origin, which is the default and the case when the NetTact
// server itself serves this app at /status/. A separately hosted copy sets it to
// the server's origin in config.js.
//
// The trailing slash is stripped so callers can concatenate an absolute path
// without producing '//api/v1/...' — which some reverse proxies will not route.
export const apiBase: string = (window.NETTACT_STATUS_CONFIG?.apiBase ?? '').replace(/\/+$/, '')

/**
 * Which page to show when the URL names none — i.e. at a bare '/', with no
 * '#/<slug>'.
 *
 * Empty (the default) keeps this app an address bar for every published page: a
 * hash-less URL renders "no page selected". A deployment that publishes exactly
 * one board and wants it to BE a domain's home page sets this in config.js.
 *
 * Runtime config is the only place this answer can come from. The slug lives in
 * the fragment, which browsers never put on the wire, so no reverse proxy or
 * static host can supply it — and building it in would defeat the point of a
 * dist that any deployment can drop in place unmodified.
 */
export const defaultSlug: string = (window.NETTACT_STATUS_CONFIG?.page ?? '').trim()

/**
 * Whether the NetTact console is reachable from wherever this page is being
 * served — i.e. whether offering a link to it would lead anywhere.
 *
 * Only the home page ever offers that link, but "is the home page" and "can a
 * reader get to the console" are different questions, and on one supported
 * topology they disagree. A status page published on its own domain deliberately
 * has the console, the admin API and the agent channel blocked at the reverse
 * proxy (see the "status page on its own domain" guide, which blocks /login by
 * name and verifies it stays blocked). Rendering a sign-in link there would hand
 * every visitor a dead end pointing at a door the operator bricked up on purpose.
 *
 * Defaults to true, so the ordinary same-origin deployment — where the console
 * is one path away — needs no configuration. The reverse-proxy config the console
 * generates sets it to false.
 */
export const consoleReachable: boolean = window.NETTACT_STATUS_CONFIG?.console !== false
