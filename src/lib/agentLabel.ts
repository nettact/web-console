export interface AgentIdentity {
  id: string
  display_name?: string | null
  hostname?: string | null
}

function nonBlank(value: string | null | undefined): string {
  return value?.trim() || ''
}

// Canonical label for a current Agent everywhere in the console. Hostnames that
// belong to monitored targets, neighbors, or trace hops are not AgentIdentity
// values and must not pass through this helper.
export function agentLabel(agent: AgentIdentity): string {
  return nonBlank(agent.display_name) || nonBlank(agent.hostname) || agent.id
}
