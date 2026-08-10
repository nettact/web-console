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
window.NETTACT_STATUS_CONFIG = { apiBase: '' }
