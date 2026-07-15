import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_CARD_DEFINITIONS,
  dashboardLayoutPayload,
  cloneDashboardLayout,
  defaultDashboardLayout,
  normalizeDashboardLayout,
} from './dashboardLayout'

describe('dashboard layout', () => {
  it('uses the documented default order and keeps the required cards visible', () => {
    const layout = defaultDashboardLayout()
    expect(layout.map((card) => card.id).slice(0, 6)).toEqual([
      'overall', 'availability', 'latency', 'failures', 'agent-status', 'important-targets',
    ])
    expect(layout.every((card) => card.visible)).toBe(true)
    const systemStatus = DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === 'system-status')!
    expect(systemStatus.sizes).toEqual(['medium', 'wide'])
    expect(DASHBOARD_CARD_DEFINITIONS.some((card) => card.id === 'network-summary')).toBe(false)
    expect(DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === 'nat-summary')?.sizes).toEqual(['compact', 'medium'])
    expect(DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === 'lan-summary')?.sizes).toEqual(['compact', 'medium'])


  })

  it('drops removed cards, de-duplicates IDs, fixes sizes, and appends new cards', () => {
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
    expect(layout[1].id).toBe('overall')
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
  })

  it('falls back to defaults for malformed or different-version data', () => {
    expect(normalizeDashboardLayout(null)).toEqual(defaultDashboardLayout())
    expect(normalizeDashboardLayout({ version: 2, cards: [] })).toEqual(defaultDashboardLayout())
  })
})
