export type DashboardCardSize = 'compact' | 'medium' | 'wide'

export interface DashboardCardDefinition {
  id: string
  titleKey: string
  sizes: readonly DashboardCardSize[]
  defaultSize: DashboardCardSize
  defaultVisible: boolean
}

export interface DashboardCardLayout {
  id: string
  visible: boolean
  size: DashboardCardSize
}

export interface DashboardLayoutPayload {
  version: number
  cards: DashboardCardLayout[]
}

export const DASHBOARD_LAYOUT_VERSION = 1

// This ordered list is the DASH-001 default information architecture. A saved
// layout is reconciled against it on every load: removed IDs disappear and new
// cards are appended with their current defaults. Pre-release IDs are never
// aliased or migrated.
export const DASHBOARD_CARD_DEFINITIONS: readonly DashboardCardDefinition[] = [
  { id: 'overall', titleKey: 'dashboard.cardOverall', sizes: ['wide'], defaultSize: 'wide', defaultVisible: true },
  { id: 'availability', titleKey: 'dashboard.cardAvailability', sizes: ['compact', 'medium'], defaultSize: 'compact', defaultVisible: true },
  { id: 'latency', titleKey: 'dashboard.cardLatency', sizes: ['compact', 'medium'], defaultSize: 'compact', defaultVisible: true },
  { id: 'failures', titleKey: 'dashboard.cardFailures', sizes: ['compact', 'medium'], defaultSize: 'compact', defaultVisible: true },
  { id: 'agent-status', titleKey: 'dashboard.cardAgentStatus', sizes: ['compact', 'medium'], defaultSize: 'compact', defaultVisible: true },
  { id: 'important-targets', titleKey: 'dashboard.cardImportantTargets', sizes: ['wide'], defaultSize: 'wide', defaultVisible: true },
  { id: 'nat-summary', titleKey: 'dashboard.natType', sizes: ['compact', 'medium'], defaultSize: 'compact', defaultVisible: true },
  { id: 'lan-summary', titleKey: 'dashboard.lanDevices', sizes: ['compact', 'medium'], defaultSize: 'compact', defaultVisible: true },
  { id: 'system-status', titleKey: 'dashboard.cardSystemStatus', sizes: ['medium', 'wide'], defaultSize: 'wide', defaultVisible: true },
  { id: 'lan-devices', titleKey: 'dashboard.cardLanDevices', sizes: ['medium', 'wide'], defaultSize: 'medium', defaultVisible: true },
  { id: 'interfaces', titleKey: 'dashboard.cardInterfaces', sizes: ['medium', 'wide'], defaultSize: 'medium', defaultVisible: true },
  { id: 'disks', titleKey: 'dashboard.cardDisks', sizes: ['medium', 'wide'], defaultSize: 'medium', defaultVisible: true },
  { id: 'activity', titleKey: 'dashboard.cardActivity', sizes: ['medium', 'wide'], defaultSize: 'medium', defaultVisible: true },
]

export function defaultDashboardLayout(): DashboardCardLayout[] {
  return DASHBOARD_CARD_DEFINITIONS.map((card) => ({
    id: card.id,
    visible: card.defaultVisible,
    size: card.defaultSize,
  }))
}

export function cloneDashboardLayout(layout: readonly DashboardCardLayout[]): DashboardCardLayout[] {
  return layout.map((card) => ({ ...card }))
}

export function normalizeDashboardLayout(value: unknown): DashboardCardLayout[] {
  if (!value || typeof value !== 'object') return defaultDashboardLayout()
  const stored = value as Partial<DashboardLayoutPayload>
  if (stored.version !== DASHBOARD_LAYOUT_VERSION || !Array.isArray(stored.cards)) return defaultDashboardLayout()

  const definitions = new Map(DASHBOARD_CARD_DEFINITIONS.map((card) => [card.id, card]))
  const seen = new Set<string>()
  const normalized: DashboardCardLayout[] = []

  for (const candidate of stored.cards) {
    if (!candidate || typeof candidate.id !== 'string' || seen.has(candidate.id)) continue
    const definition = definitions.get(candidate.id)
    if (!definition) continue
    normalized.push({
      id: definition.id,
      visible: typeof candidate.visible === 'boolean' ? candidate.visible : definition.defaultVisible,
      size: definition.sizes.includes(candidate.size) ? candidate.size : definition.defaultSize,
    })
    seen.add(candidate.id)
  }

  for (const definition of DASHBOARD_CARD_DEFINITIONS) {
    if (seen.has(definition.id)) continue
    normalized.push({ id: definition.id, visible: definition.defaultVisible, size: definition.defaultSize })
  }
  return normalized
}

export function dashboardLayoutPayload(layout: readonly DashboardCardLayout[]): DashboardLayoutPayload {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    cards: normalizeDashboardLayout({ version: DASHBOARD_LAYOUT_VERSION, cards: layout }),
  }
}

