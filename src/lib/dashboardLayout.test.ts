import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_CARD_DEFINITIONS,
  dashboardLayoutPayload,
  dashboardLayoutPreset,
  cloneDashboardLayout,
  defaultDashboardLayout,
  identifyDashboardLayoutPreset,
  normalizeDashboardLayout,
} from './dashboardLayout'

const simpleVisible = [
  ['overall', 'wide'],
  ['availability', 'compact'],
  ['nat-summary', 'compact'],
  ['wifi-summary', 'compact'],
  ['lan-summary', 'compact'],
  ['active-alerts', 'medium'],
  ['monitor-health', 'medium'],
  ['network-quality', 'tall'],
  ['traffic-trend', 'tall'],
  ['lan-devices', 'wide'],
]

const professionalOrder = [
  'overall', 'availability', 'latency', 'failures', 'agent-status', 'active-alerts', 'monitor-health',
  'network-quality', 'data-freshness', 'wifi-summary', 'nat-summary', 'lan-summary', 'traffic-trend',
  'incident-summary', 'important-targets', 'system-status', 'lan-devices', 'interfaces', 'disks', 'activity',
]

describe('dashboard layout', () => {
  it('uses the simple preset as the default layout', () => {
    const layout = defaultDashboardLayout()
    expect(layout.filter((card) => card.visible).map((card) => [card.id, card.size])).toEqual(simpleVisible)
    expect(layout).toHaveLength(DASHBOARD_CARD_DEFINITIONS.length)
    expect(identifyDashboardLayoutPreset(layout)).toBe('simple')
  })

  it('builds the complete professional diagnostic layout', () => {
    const layout = dashboardLayoutPreset('professional')
    expect(layout.map((card) => card.id)).toEqual(professionalOrder)
    expect(layout.every((card) => card.visible)).toBe(true)
    expect(identifyDashboardLayoutPreset(layout)).toBe('professional')
    expect(DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === 'system-status')?.sizes).toEqual(['medium', 'wide'])
    expect(DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === 'nat-summary')?.sizes).toEqual(['compact', 'medium'])
    // Only the two chart cards expose the 2×2 tall slot.
    expect(DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === 'network-quality')?.sizes).toEqual(['medium', 'wide', 'tall'])
    expect(DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === 'traffic-trend')?.sizes).toEqual(['medium', 'wide', 'tall'])
    expect(DASHBOARD_CARD_DEFINITIONS.filter((card) => card.sizes.includes('tall')).map((card) => card.id)).toEqual([
      'network-quality', 'traffic-trend',
    ])
  })

  it('returns independent preset copies and recognizes only exact presets', () => {
    const first = dashboardLayoutPreset('simple')
    const second = dashboardLayoutPreset('simple')
    first[0].visible = false
    first.reverse()

    expect(second).toEqual(defaultDashboardLayout())
    expect(identifyDashboardLayoutPreset(first)).toBeNull()
    expect(identifyDashboardLayoutPreset(second)).toBe('simple')
  })

  it('drops removed cards, de-duplicates IDs, fixes sizes, and appends simple defaults', () => {
    const layout = normalizeDashboardLayout({
      version: 1,
      cards: [
        { id: 'latency', visible: false, size: 'wide' },
        { id: 'removed-card', visible: true, size: 'compact' },
        { id: 'latency', visible: true, size: 'compact' },
      ],
    })

    expect(layout[0]).toEqual({ id: 'latency', visible: false, size: 'compact' })
    expect(layout.some((card) => card.id === 'removed-card')).toBe(false)
    expect(layout).toHaveLength(DASHBOARD_CARD_DEFINITIONS.length)
    expect(layout[1]).toEqual({ id: 'overall', visible: true, size: 'wide' })
    expect(layout.find((card) => card.id === 'failures')?.visible).toBe(false)
  })

  it('builds a normalized server payload with hidden cards and custom order', () => {
    const layout = cloneDashboardLayout(defaultDashboardLayout())
    const latency = layout.splice(2, 1)[0]
    latency.visible = false
    layout.unshift(latency)

    const payload = dashboardLayoutPayload(layout)

    expect(payload.version).toBe(1)
    expect(payload.cards).toEqual(layout)
    expect(normalizeDashboardLayout(payload)).toEqual(layout)
    expect(identifyDashboardLayoutPreset(payload.cards)).toBeNull()
  })

  it('falls back to the simple preset for absent or different-version data', () => {
    expect(normalizeDashboardLayout(null)).toEqual(defaultDashboardLayout())
    expect(normalizeDashboardLayout({ version: 2, cards: [] })).toEqual(defaultDashboardLayout())
  })
})
