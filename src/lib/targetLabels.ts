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

// Readable subject label. A host anchor watches the whole machine of every Agent
// its group covers, so it has no subject to name — the families it watches are
// shown as chips instead. Gateway carries no user target (shows the chosen NIC).
export function targetLabel(t: ProbeTarget, tr: Tr): string {
  if (t.kind === 'host') return tr('monitoring.hostSystem')
  if (t.kind === 'gateway') return t.params?.interface || tr('monitoring.gatewayDefault')
  return t.target
}
