// `tall` is a half-row-wide, double-row-high (2×2) slot for chart cards only.
export type DashboardCardSize = 'compact' | 'medium' | 'wide' | 'tall'

export type DashboardLayoutPresetID = 'simple' | 'professional'

export interface DashboardCardDefinition {
  id: string
  titleKey: string
  sizes: readonly DashboardCardSize[]
  defaultSize: DashboardCardSize
}

export interface DashboardCardLayout {
  id: string
  type: string
  visible: boolean
  size: DashboardCardSize
  target_id?: string
}

export interface DashboardLayoutPayload {
  version: number
  cards: DashboardCardLayout[]
}

export const DASHBOARD_LAYOUT_VERSION = 2

// Mirrors server-core's maxDashboardLayoutCards; the PUT is rejected above it.
export const MAX_DASHBOARD_CARDS = 64

// Target cards are instanced: many cards share this type, each with its own id
// and target_id, so they live outside DASHBOARD_CARD_DEFINITIONS.
export const MONITOR_TARGET_CARD_TYPE = 'monitor-target'
export const MONITOR_TARGET_CARD_DEFINITION: DashboardCardDefinition = {
  id: MONITOR_TARGET_CARD_TYPE,
  titleKey: 'dashboard.cardMonitorTarget',
  sizes: ['compact', 'medium'],
  defaultSize: 'medium',
}

// The catalog follows the professional diagnostic flow. Presets own visibility
// and order; definitions only describe each widget's sizing constraints.
export const DASHBOARD_CARD_DEFINITIONS: readonly DashboardCardDefinition[] = [
  { id: 'overall', titleKey: 'dashboard.cardOverall', sizes: ['wide'], defaultSize: 'wide' },
  { id: 'path-status', titleKey: 'dashboard.cardPathStatus', sizes: ['wide'], defaultSize: 'wide' },
  { id: 'availability', titleKey: 'dashboard.cardAvailability', sizes: ['compact', 'medium'], defaultSize: 'compact' },
  { id: 'latency', titleKey: 'dashboard.cardLatency', sizes: ['compact', 'medium'], defaultSize: 'compact' },
  { id: 'failures', titleKey: 'dashboard.cardFailures', sizes: ['compact', 'medium'], defaultSize: 'compact' },
  { id: 'agent-status', titleKey: 'dashboard.cardAgentStatus', sizes: ['compact', 'medium'], defaultSize: 'compact' },
  { id: 'active-alerts', titleKey: 'dashboard.cardActiveAlerts', sizes: ['medium', 'wide'], defaultSize: 'medium' },
  { id: 'monitor-health', titleKey: 'dashboard.cardMonitorHealth', sizes: ['medium', 'wide'], defaultSize: 'medium' },
  { id: 'network-quality', titleKey: 'dashboard.cardNetworkQuality', sizes: ['medium', 'wide', 'tall'], defaultSize: 'wide' },
  { id: 'data-freshness', titleKey: 'dashboard.cardDataFreshness', sizes: ['compact', 'medium'], defaultSize: 'compact' },
  { id: 'wifi-summary', titleKey: 'dashboard.cardWifiSummary', sizes: ['compact', 'medium'], defaultSize: 'compact' },
  { id: 'nat-summary', titleKey: 'dashboard.natType', sizes: ['compact', 'medium'], defaultSize: 'compact' },
  { id: 'lan-summary', titleKey: 'dashboard.lanDevices', sizes: ['compact', 'medium'], defaultSize: 'compact' },
  { id: 'traffic-trend', titleKey: 'dashboard.cardTrafficTrend', sizes: ['medium', 'wide', 'tall'], defaultSize: 'medium' },
  { id: 'incident-summary', titleKey: 'dashboard.cardIncidentSummary', sizes: ['medium', 'wide'], defaultSize: 'medium' },
  { id: 'important-targets', titleKey: 'dashboard.cardImportantTargets', sizes: ['wide'], defaultSize: 'wide' },
  { id: 'system-status', titleKey: 'dashboard.cardSystemStatus', sizes: ['medium', 'wide'], defaultSize: 'wide' },
  { id: 'lan-devices', titleKey: 'dashboard.cardLanDevices', sizes: ['medium', 'wide'], defaultSize: 'medium' },
  { id: 'interfaces', titleKey: 'dashboard.cardInterfaces', sizes: ['medium', 'wide'], defaultSize: 'medium' },
  { id: 'disks', titleKey: 'dashboard.cardDisks', sizes: ['medium', 'wide'], defaultSize: 'medium' },
  { id: 'activity', titleKey: 'dashboard.cardActivity', sizes: ['medium', 'wide'], defaultSize: 'medium' },
]

const PROFESSIONAL_LAYOUT: readonly DashboardCardLayout[] = DASHBOARD_CARD_DEFINITIONS.map((card) => ({
  id: card.id,
  type: card.id,
  visible: true,
  size: card.defaultSize,
}))

const SIMPLE_VISIBLE_LAYOUT: readonly DashboardCardLayout[] = [
  { id: 'overall', type: 'overall', visible: true, size: 'wide' },
  { id: 'path-status', type: 'path-status', visible: true, size: 'wide' },
  { id: 'active-alerts', type: 'active-alerts', visible: true, size: 'medium' },
  { id: 'monitor-health', type: 'monitor-health', visible: true, size: 'medium' },
  // Network quality + traffic trend sit side by side as 2×1 half-row charts.
  { id: 'network-quality', type: 'network-quality', visible: true, size: 'medium' },
  { id: 'traffic-trend', type: 'traffic-trend', visible: true, size: 'medium' },
  { id: 'lan-devices', type: 'lan-devices', visible: true, size: 'wide' },
]

const simpleVisibleIDs = new Set(SIMPLE_VISIBLE_LAYOUT.map((card) => card.id))
const SIMPLE_LAYOUT: readonly DashboardCardLayout[] = [
  ...SIMPLE_VISIBLE_LAYOUT,
  ...PROFESSIONAL_LAYOUT
    .filter((card) => !simpleVisibleIDs.has(card.id))
    .map((card) => ({ ...card, visible: false })),
]

const DASHBOARD_LAYOUT_PRESETS: Readonly<Record<DashboardLayoutPresetID, readonly DashboardCardLayout[]>> = {
  simple: SIMPLE_LAYOUT,
  professional: PROFESSIONAL_LAYOUT,
}

export function dashboardLayoutPreset(id: DashboardLayoutPresetID): DashboardCardLayout[] {
  return cloneDashboardLayout(DASHBOARD_LAYOUT_PRESETS[id])
}

export function identifyDashboardLayoutPreset(layout: readonly DashboardCardLayout[]): DashboardLayoutPresetID | null {
  for (const id of ['simple', 'professional'] as const) {
    if (JSON.stringify(layout) === JSON.stringify(DASHBOARD_LAYOUT_PRESETS[id])) return id
  }
  return null
}

export function defaultDashboardLayout(): DashboardCardLayout[] {
  return dashboardLayoutPreset('simple')
}

export function cloneDashboardLayout(layout: readonly DashboardCardLayout[]): DashboardCardLayout[] {
  return layout.map((card) => ({ ...card }))
}

export function normalizeDashboardLayout(value: unknown): DashboardCardLayout[] {
  if (!value || typeof value !== 'object') return defaultDashboardLayout()
  const stored = value as Partial<DashboardLayoutPayload>
  if (stored.version !== DASHBOARD_LAYOUT_VERSION || !Array.isArray(stored.cards)) return defaultDashboardLayout()

  const definitions = new Map(DASHBOARD_CARD_DEFINITIONS.map((card) => [card.id, card]))
  const defaults = defaultDashboardLayout()
  const defaultCards = new Map(defaults.map((card) => [card.id, card]))
  const seen = new Set<string>()
  const normalized: DashboardCardLayout[] = []

  for (const candidate of stored.cards) {
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.type !== 'string' || seen.has(candidate.id)) continue
    const isTargetCard = candidate.type === MONITOR_TARGET_CARD_TYPE
    const definition = isTargetCard ? MONITOR_TARGET_CARD_DEFINITION : definitions.get(candidate.type)
    if (!definition) continue
    if (!isTargetCard && candidate.id !== candidate.type) continue
    if (isTargetCard && (typeof candidate.target_id !== 'string' || !candidate.target_id)) continue
    const fallback = defaultCards.get(definition.id)
    normalized.push({
      id: candidate.id,
      type: candidate.type,
      visible: typeof candidate.visible === 'boolean' ? candidate.visible : fallback?.visible ?? true,
      size: definition.sizes.includes(candidate.size) ? candidate.size : fallback?.size ?? definition.defaultSize,
      ...(isTargetCard ? { target_id: candidate.target_id } : {}),
    })
    seen.add(candidate.id)
  }

  for (const fallback of defaults) {
    if (seen.has(fallback.id)) continue
    normalized.push({ ...fallback })
  }
  return normalized
}

export function dashboardLayoutPayload(layout: readonly DashboardCardLayout[]): DashboardLayoutPayload {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    cards: normalizeDashboardLayout({ version: DASHBOARD_LAYOUT_VERSION, cards: layout }),
  }
}
