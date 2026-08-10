export default {
  brand: 'NetTact',
  loading: 'Loading…',
  retry: 'Retry',

  notFound: {
    title: 'Page not found',
    body: 'This status page may have been removed or unpublished. Check the address with whoever shared it.',
  },
  noSlug: {
    title: 'No status page selected',
    body: 'Use the full link, which looks like /status/#/your-page.',
  },
  error: {
    title: 'Temporarily unavailable',
    body: 'Could not reach the server. Retrying shortly.',
  },

  updated: {
    justNow: 'updated just now',
    secondsAgo: 'updated {n}s ago',
    minutesAgo: 'updated {n}m ago',
    hoursAgo: 'updated {n}h ago',
  },
  stale: 'This data may be out of date; retrying',

  agents: {
    title: 'Nodes',
    empty: 'This page publishes no nodes.',
    unnamed: 'Node {n}',
    online: 'Online',
    offline: 'Offline',
    since: 'since {time}',
    summary: '{online} of {total} online',
  },

  targets: {
    title: 'Monitors',
    empty: 'This page publishes no monitoring targets.',
    unnamed: '{kind} target {n}',
    availability: '24h availability',
    availabilityUnknown: 'no data yet',
    summary: '{up} of {total} up',
    status: {
      up: 'Up',
      down: 'Down',
      degraded: 'Unstable',
      unknown: 'Unknown',
    },
  },

  kind: {
    icmp: 'Ping',
    http: 'HTTP(s)',
    tcp: 'TCP',
    dns: 'DNS',
    nat: 'NAT',
    gateway: 'Gateway',
    host: 'Host',
  },

  theme: {
    toDark: 'Switch to dark',
    toLight: 'Switch to light',
  },
  lang: {
    toggle: '中文',
  },
  poweredBy: 'Powered by NetTact',
}
