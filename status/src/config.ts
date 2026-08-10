// Where the public API lives, read once from the runtime config the shell loads.
//
// Empty means same origin, which is the default and the case when the NetTact
// server itself serves this app at /status/. A separately hosted copy sets it to
// the server's origin in config.js.
//
// The trailing slash is stripped so callers can concatenate an absolute path
// without producing '//api/v1/...' — which some reverse proxies will not route.
export const apiBase: string = (window.NETTACT_STATUS_CONFIG?.apiBase ?? '').replace(/\/+$/, '')
