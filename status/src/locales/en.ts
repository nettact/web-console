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

  tabs: {
    label: 'Published status categories',
  },

  current: {
    title: 'Current status',
    healthy: {
      label: 'Operational',
      summary: 'No current faults were found in the published resources.',
    },
    fault: {
      label: 'Fault detected',
      summary: 'At least one published resource currently has a fault; review the status below.',
    },
    unknown: {
      label: 'Status incomplete',
      summary: 'Some published monitors have no current verdict, so fault status is not fully known.',
    },
  },

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
    availabilityUnknown: 'no data yet',
    summary: '{up} of {total} up',
    // The server owns the window list; a token missing here renders raw ("6h").
    window: {
      '24h': '24h',
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days',
      '1y': '1 year',
    },
    rounds: '{n} probe rounds',
    barTitle: 'Daily availability',
    barStart: '{n} days ago',
    barEnd: 'today',
    barDay: '{date}: {status}; {availability}; {probes}',
    barDayEmpty: '{date}: no data',
    dayAvailability: 'Availability',
    dayProbes: 'Probe results',
    dayProbeCount: '{ok} of {total} succeeded',
    dayNoProbes: 'No conclusive probes',
    dayStatus: {
      none: 'No verdict',
      up: 'Operational all day',
      minor: 'Minor disruption',
      major: 'Partial outage',
      down: 'Major outage',
    },
    status: {
      up: 'Up',
      down: 'Down',
      degraded: 'Unstable',
      unknown: 'Unknown',
    },
  },

  incidents: {
    title: 'Incidents',
    summary: '{n} records',
    empty: 'No incidents were recorded for the published resources in this period.',
    unknownSubject: 'Published service',
    multipleSubjects: '{name} and {n} more',
    window: 'Shows the last {n} days and any older incidents still in progress.',
    truncated: 'Showing the most recent {n} incidents.',
    started: 'Started {time} · ongoing for {duration}',
    resolved: 'Started {time} · lasted {duration}',
    state: {
      open: 'In progress',
      resolved: 'Resolved',
    },
    impact: {
      degraded: 'Degraded',
      outage: 'Interruption',
    },
    duration: {
      seconds: '{n}s',
      minutes: '{n}m',
      hours: '{n}h',
      days: '{n}d',
    },
  },

  res: {
    cpu: 'CPU',
    load: 'Load',
    memory: 'Memory',
    disk: 'Disk',
    network: 'Network',
    uptime: 'Uptime',
    ofTotal: '{used} / {total}',
    mounts: '{n} mounts',
    stale: 'This node has stopped reporting.',
    uptimeDH: '{d}d {h}h',
    uptimeHM: '{h}h {m}m',
    uptimeM: '{m}m',
    uptimeS: '{s}s',
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
