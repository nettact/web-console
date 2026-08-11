// NetTact public status page — runtime configuration.
//
// This file is NOT bundled: edit it directly in the deployed output, no rebuild
// needed.
//
// apiBase is the origin of the NetTact server whose public API this page reads.
// Leave it empty when the page is served by that same server (the default: the
// server hosts this app at /status/). Set it to the server's origin when you
// host this directory somewhere else — a static bucket, a CDN, another domain:
//
//   window.NETTACT_STATUS_CONFIG = { apiBase: 'https://nettact.example.com' }
//
// The server answers /api/v1/public/* with Access-Control-Allow-Origin: *, so a
// cross-origin page works with no further configuration. No credentials are ever
// sent, and only public status pages are readable this way.
//
// page is the slug to show when the URL carries no '#/<slug>'. Leave it empty to
// keep the multi-page behaviour (a bare URL shows "no status page selected").
// Set it to publish one board AT a domain's root, with nothing after the slash:
//
//   window.NETTACT_STATUS_CONFIG = { apiBase: '', page: 'home-lab' }
//
// Only a default, never a lock: '#/other-page' still opens another page, so a
// deployment that must expose exactly one board restricts the API at the reverse
// proxy (see the "status page on its own domain" guide) rather than here.
//
// console controls one thing: whether the board offers a sign-in link back to
// the NetTact console. It only ever appears on the page marked as the server's
// home page, and only when this is true (the default). Set it to false on a
// deployment where the console is not reachable from this address — which is
// exactly what the own-domain topology does, since it blocks /login on purpose.
window.NETTACT_STATUS_CONFIG = { apiBase: '', page: '', console: true }
