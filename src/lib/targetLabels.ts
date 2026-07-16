// Shared display helpers for monitoring targets, so the group-centric Monitoring
// list, the monitor-group form's member table and any future consumer render a
// target's type and subject identically. `tr` is the vue-i18n translator, passed
// in so this stays a pure (framework-free) module.

import type { ProbeTarget } from '../api'

type Tr = (key: string) => string

// Human label for a target's protocol kind.
export function typeLabel(t: ProbeTarget, tr: Tr): string {
  switch (t.kind) {
    case 'icmp':
      return tr('mform.typeIcmp')
    case 'tcp':
      return tr('mform.typeTcp')
    case 'dns':
      return tr('mform.typeDns')
    case 'nat':
      return tr('mform.typeNat')
    case 'gateway':
      return tr('mform.typeGateway')
    case 'host':
      return tr('mform.typeHost')
    case 'http':
      return tr('mform.typeHttp')
    default:
      return t.kind.toUpperCase()
  }
}

// Readable subject label. Host anchors carry a metric-series string as their
// target ("host" for the whole machine, "*" for all wireless adapters, a mount
// point for disk); gateway carries no user target (shows the chosen NIC).
export function targetLabel(t: ProbeTarget, tr: Tr): string {
  if (t.kind === 'host' && t.target === 'host') return tr('monitoring.hostWhole')
  if (t.kind === 'host' && t.target === '*') return tr('monitoring.hostWifi')
  if (t.kind === 'gateway') return t.params?.interface || tr('monitoring.gatewayDefault')
  return t.target
}
