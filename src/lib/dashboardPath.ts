import type { TargetStatusRow } from '../api'

export type DashboardPathTone = 'good' | 'warn' | 'bad' | 'unknown' | 'muted'
export type DashboardPathStageID = 'host' | 'interface' | 'gateway' | 'nat' | 'internet' | 'dns' | 'http'
export type DashboardPathState = 'healthy' | 'degraded' | 'failed' | 'stale' | 'blocked' | 'offline' | 'no_data' | 'not_configured' | 'not_applicable'

export interface DashboardPathFaultTarget {
  id: string
  name: string
  target: string
}

export interface DashboardPathFeaturedTarget extends DashboardPathFaultTarget {
  latencyMs?: number
}

export interface DashboardPathStage {
  id: DashboardPathStageID
  tone: DashboardPathTone
  state: DashboardPathState
  healthy: number
  total: number
  affected: boolean
  faultTarget?: DashboardPathFaultTarget
  featuredTarget?: DashboardPathFeaturedTarget
}

export interface DashboardPathInput {
  agentId: string
  agentOnline: boolean
  freshnessTone: 'good' | 'warn' | 'bad' | 'unknown'
  networkInterface: { tone: DashboardPathTone; state: DashboardPathState }
  targets: TargetStatusRow[]
  latencyMsByTarget?: Readonly<Record<string, number>>
}

const stageKinds: ReadonlyArray<[DashboardPathStageID, string]> = [
  ['gateway', 'gateway'],
  ['nat', 'nat'],
  ['internet', 'icmp'],
  ['dns', 'dns'],
  ['http', 'http'],
]

function targetStage(id: DashboardPathStageID, kind: string, input: DashboardPathInput): DashboardPathStage {
  const pairs = input.targets
    .filter((target) => target.enabled && target.kind === kind)
    .map((target) => {
      const agent = target.agents.find((candidate) => candidate.agent_id === input.agentId)
      return agent ? { target, agent } : null
    })
    .filter((pair): pair is NonNullable<typeof pair> => pair != null)

  if (!pairs.length) return { id, tone: 'unknown', state: 'not_configured', healthy: 0, total: 0, affected: false }
  const healthy = pairs.filter(({ agent }) => agent.execution_state === 'collecting' && agent.probe_state === 'healthy').length
  const isFiniteLatency = (value: number | undefined): value is number => value != null && Number.isFinite(value)
  const targetSummary = (pair: typeof pairs[number]): DashboardPathFeaturedTarget => {
    const latencyMs = input.latencyMsByTarget?.[pair.target.target_id]
    return {
      id: pair.target.target_id,
      name: pair.target.name,
      target: pair.target.target,
      ...(isFiniteLatency(latencyMs) ? { latencyMs } : {}),
    }
  }
  const slowest = pairs
    .filter((pair) => isFiniteLatency(input.latencyMsByTarget?.[pair.target.target_id]))
    .sort((a, b) => (input.latencyMsByTarget?.[b.target.target_id] ?? 0) - (input.latencyMsByTarget?.[a.target.target_id] ?? 0))[0]
  const featuredTarget = targetSummary(slowest ?? pairs[0])
  const withFaultTarget = (pair: typeof pairs[number]) => ({
    faultTarget: targetSummary(pair),
    featuredTarget: targetSummary(pair),
  })
  const offline = pairs.find(({ agent }) => agent.execution_state === 'agent_offline')
  if (offline) {
    return { id, tone: 'bad', state: 'offline', healthy, total: pairs.length, affected: false, ...withFaultTarget(offline) }
  }
  const failed = pairs.find(({ agent }) => agent.execution_state === 'collecting' && agent.probe_state === 'failed')
  if (failed) {
    return { id, tone: 'bad', state: 'failed', healthy, total: pairs.length, affected: false, ...withFaultTarget(failed) }
  }
  const blocked = pairs.find(({ agent }) => agent.execution_state === 'permission_blocked' || agent.execution_state === 'target_blocked' || agent.execution_state === 'unsupported')
  if (blocked) {
    return { id, tone: 'warn', state: 'blocked', healthy, total: pairs.length, affected: false, ...withFaultTarget(blocked) }
  }
  const stale = pairs.find(({ agent }) => agent.probe_state === 'stale')
  if (stale) {
    return { id, tone: 'warn', state: 'stale', healthy, total: pairs.length, affected: false, ...withFaultTarget(stale) }
  }
  if (healthy === pairs.length) return { id, tone: 'good', state: 'healthy', healthy, total: pairs.length, affected: false, featuredTarget }
  return { id, tone: 'unknown', state: 'no_data', healthy, total: pairs.length, affected: false, featuredTarget }
}

export function buildDashboardPath(input: DashboardPathInput): { stages: DashboardPathStage[]; root: DashboardPathStage | null } {
  const host: DashboardPathStage = !input.agentOnline
    ? { id: 'host', tone: 'bad', state: 'offline', healthy: 0, total: 1, affected: false }
    : input.freshnessTone === 'bad'
      ? { id: 'host', tone: 'bad', state: 'stale', healthy: 0, total: 1, affected: false }
      : input.freshnessTone === 'warn'
        ? { id: 'host', tone: 'warn', state: 'stale', healthy: 0, total: 1, affected: false }
        : { id: 'host', tone: input.freshnessTone === 'good' ? 'good' : 'unknown', state: input.freshnessTone === 'good' ? 'healthy' : 'no_data', healthy: input.freshnessTone === 'good' ? 1 : 0, total: 1, affected: false }

  const networkInterface: DashboardPathStage = {
    id: 'interface',
    healthy: input.networkInterface.tone === 'good' ? 1 : 0,
    total: input.networkInterface.state === 'not_applicable' ? 0 : 1,
    affected: false,
    ...input.networkInterface,
  }
  const stages = [host, networkInterface, ...stageKinds.map(([id, kind]) => targetStage(id, kind, input))]
  const badIndex = stages.findIndex((stage) => stage.tone === 'bad')
  const rootIndex = badIndex >= 0 ? badIndex : stages.findIndex((stage) => stage.tone === 'warn')
  const root = rootIndex >= 0 ? stages[rootIndex] : null

  if (root) {
    // Only stages we actually observe as degraded can be collateral damage. A
    // `not_configured` / `no_data` hop tells us nothing, so leaving it alone
    // keeps the card from claiming an unmonitored hop is "affected".
    for (let index = rootIndex + 1; index < stages.length; index++) {
      const stage = stages[index]
      stage.affected = stage.tone === 'bad' || stage.tone === 'warn'
    }
  }
  return { stages, root }
}
