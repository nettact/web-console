// Agent local-permission helpers, shared by the Processes and Agents pages. Pure
// logic only (scope families, dependency closure); i18n display names live in
// composables/usePermissionMeta.ts. The snapshot POST asks for a set of scopes —
// these are the process / connection permission IDs the agent still needs to
// actually collect the corresponding columns.

export const PROCESS_SCOPES = [
  'host.process.basic.read',
  'host.process.owner.read',
  'host.process.resource.read',
  'host.process.io.read',
] as const
export const CONNECTION_SCOPES = [
  'host.connection.summary.read',
  'host.connection.local.read',
  'host.connection.remote.read',
  'host.connection.owner.read',
] as const

// A dependent scope is useless without its base scope, so requesting one implies
// the other. The server enforces this too. The Processes page requests the full
// desired scope set up-front (so denied scopes and their remediation always
// surface), which inherently includes every base.

const PROCESS_SET = new Set<string>(PROCESS_SCOPES)
const CONNECTION_SET = new Set<string>(CONNECTION_SCOPES)

export const hasProcessScopes = (effective: string[]) => effective.some((s) => PROCESS_SET.has(s))
export const hasConnectionScopes = (effective: string[]) => effective.some((s) => CONNECTION_SET.has(s))

// Whether a given snapshot scope was actually collected — drives dynamic columns.
export function collected(scopes: { scope: string; status: string }[], scope: string): boolean {
  return scopes.some((s) => s.scope === scope && s.status === 'collected')
}
