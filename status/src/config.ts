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
