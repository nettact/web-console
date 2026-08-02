// @ts-expect-error The production tsconfig intentionally omits Node globals; Vitest runs this file in Node.
import { readFileSync } from 'node:fs'
// Aliased on purpose: Vite rewrites the literal `new URL(..., import.meta.url)` pattern into an asset
// URL (http://localhost/...), which readFileSync rejects. A different identifier keeps it a plain URL.
// @ts-expect-error The production tsconfig intentionally omits Node globals; Vitest runs this file in Node.
import { URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import appSource from './App.vue?raw'
import channelAddSource from './components/ChannelAddForm.vue?raw'
import comboInputSource from './components/ComboInput.vue?raw'
import dataCleanupSource from './components/DataCleanup.vue?raw'
import faultSignalsSource from './components/FaultSignalsTable.vue?raw'
import fluctuationsSource from './components/FluctuationsTable.vue?raw'
import infoTipSource from './components/InfoTip.vue?raw'
import langSwitchSource from './components/LangSwitch.vue?raw'
import snapshotSource from './components/incident/SnapshotSection.vue?raw'
import traceSource from './components/incident/TraceCard.vue?raw'
import agentWorkspaceSource from './components/status/AgentStatusWorkspace.vue?raw'
import monitorStateSource from './components/status/MonitorStateBadge.vue?raw'
import permissionChipsSource from './components/status/PermissionChips.vue?raw'
import targetStatusGroupSource from './components/status/TargetStatusGroup.vue?raw'
import agentsSource from './views/Agents.vue?raw'
import dashboardSource from './views/Dashboard.vue?raw'

type Oklch = { l: number; c: number; h: number }
type LinearRgb = [number, number, number]

const css = readFileSync(new NodeURL('../tokens.css', import.meta.url), 'utf8')

function tokenBlock(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`Missing token block: ${selector}`)

  return new Map(
    [...match[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((entry) => [entry[1], entry[2].trim()]),
  )
}

function parseOklch(value: string): Oklch {
  const match = value.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!match) throw new Error(`Expected opaque OKLCH token, received: ${value}`)
  return { l: Number(match[1]) / 100, c: Number(match[2]), h: Number(match[3]) }
}

function linearSrgb({ l, c, h }: Oklch): LinearRgb {
  const angle = h * Math.PI / 180
  const a = c * Math.cos(angle)
  const b = c * Math.sin(angle)
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b
  const long = lPrime ** 3
  const medium = mPrime ** 3
  const short = sPrime ** 3

  const channels = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((channel) => Math.max(0, Math.min(1, channel)))
  return [channels[0], channels[1], channels[2]]
}

function luminanceRgb([red, green, blue]: LinearRgb) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRgb(foreground: LinearRgb, background: LinearRgb) {
  const lighter = Math.max(luminanceRgb(foreground), luminanceRgb(background))
  const darker = Math.min(luminanceRgb(foreground), luminanceRgb(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function contrast(foreground: string, background: string) {
  return contrastRgb(linearSrgb(parseOklch(foreground)), linearSrgb(parseOklch(background)))
}

function encodeSrgb(channel: number) {
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055
}

function decodeSrgb(channel: number) {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function composite(foreground: string, background: string, alpha: number): LinearRgb {
  const foregroundRgb = linearSrgb(parseOklch(foreground)).map(encodeSrgb)
  const backgroundRgb = linearSrgb(parseOklch(background)).map(encodeSrgb)
  return foregroundRgb.map((channel, index) => decodeSrgb(
    channel * alpha + backgroundRgb[index] * (1 - alpha),
  )) as LinearRgb
}

const textTokens = [
  '--color-accent-text',
  '--color-success-text',
  '--color-warning-text',
  '--color-danger-text',
  '--color-info-text',
  '--color-chart-title',
  '--color-chart-label',
]

const surfaces = ['--color-paper', '--color-paper-2', '--color-paper-3']

describe.each([
  ['dark', ':root'],
  ['light', ':root[data-theme="light"]'],
])('%s theme contrast tokens', (_theme, selector) => {
  const tokens = tokenBlock(selector)
  const value = (name: string) => {
    const result = tokens.get(name)
    if (!result) throw new Error(`Missing token ${name} in ${selector}`)
    return result
  }

  it.each(textTokens)('%s remains readable on application surfaces', (foreground) => {
    for (const background of surfaces) {
      expect(
        contrast(value(foreground), value(background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['--color-primary-action-text', '--color-primary-action-bg'],
    ['--color-primary-action-text', '--color-primary-action-hover-bg'],
    ['--color-danger-action-text', '--color-danger-action-bg'],
    ['--color-danger-action-text', '--color-danger-action-hover-bg'],
  ])('%s remains readable on %s', (foreground, background) => {
    expect(contrast(value(foreground), value(background))).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['--color-accent-text', '--color-accent', 0.16],
    ['--color-success-text', '--color-success', 0.14],
    ['--color-warning-text', '--color-warning', 0.14],
    ['--color-danger-text', '--color-danger', 0.14],
    ['--color-info-text', '--color-info', 0.14],
  ])('%s remains readable on its translucent %s surface', (foreground, solid, alpha) => {
    for (const surface of surfaces) {
      expect(
        contrastRgb(
          linearSrgb(parseOklch(value(foreground))),
          composite(value(solid), value(surface), alpha),
        ),
        `${foreground} on ${solid} ${alpha * 100}% over ${surface}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    '--color-accent',
    '--color-success',
    '--color-warning',
    '--color-info',
  ])('--color-status-solid-text remains readable on %s', (background) => {
    expect(contrast(value('--color-status-solid-text'), value(background))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('hard-coded status foregrounds', () => {
  it('does not reintroduce dark-theme pastel text in component CSS', () => {
    const forbidden = ['#fcd34d', '#fca5a5', '#6ee7b7', '#fbbf24', '#22d3ee', '#7dd3fc']
    const sourceFiles = new Map([
      ['src/components/FluctuationsTable.vue', fluctuationsSource],
      ['src/components/FaultSignalsTable.vue', faultSignalsSource],
      ['src/components/status/MonitorStateBadge.vue', monitorStateSource],
      ['src/components/status/PermissionChips.vue', permissionChipsSource],
      ['src/components/status/TargetStatusGroup.vue', targetStatusGroupSource],
    ])

    for (const [sourceFile, contents] of sourceFiles) {
      const source = contents.toLowerCase()
      for (const color of forbidden) expect(source, `${sourceFile}: ${color}`).not.toContain(`color: ${color}`)
    }
  })

  it('does not pair accent ink with the lower-contrast decorative accent fill', () => {
    const sourceFiles = new Map([
      ['src/App.vue', appSource],
      ['src/components/LangSwitch.vue', langSwitchSource],
      ['src/components/status/AgentStatusWorkspace.vue', agentWorkspaceSource],
      ['src/views/Agents.vue', agentsSource],
    ])

    for (const [sourceFile, source] of sourceFiles) {
      expect(source, sourceFile).not.toMatch(
        /color:\s*var\(--color-accent-ink\)[^}]*background:\s*var\(--color-accent\)/s,
      )
    }
  })

  it('uses explicit readable foregrounds for Dashboard solid status marks', () => {
    expect(dashboardSource).not.toContain('color: var(--color-accent-ink)')
    expect(dashboardSource).toContain('color: var(--color-status-solid-text)')
    expect(dashboardSource).toContain('color: var(--color-danger-action-text)')
  })

  it('does not use legacy solid aliases as text in shared components', () => {
    const sourceFiles = new Map([
      ['src/components/ChannelAddForm.vue', channelAddSource],
      ['src/components/ComboInput.vue', comboInputSource],
      ['src/components/DataCleanup.vue', dataCleanupSource],
      ['src/components/InfoTip.vue', infoTipSource],
      ['src/components/incident/SnapshotSection.vue', snapshotSource],
      ['src/components/incident/TraceCard.vue', traceSource],
    ])

    for (const [sourceFile, source] of sourceFiles) {
      expect(source, sourceFile).not.toMatch(/(?:^|[;{])\s*color:\s*var\(--(?:primary|danger|warning)\)/m)
      expect(source, sourceFile).not.toContain('var(--warn')
    }
  })

  it('preserves readable action colors when active workspace tabs are hovered', () => {
    expect(agentWorkspaceSource).toMatch(
      /\.agent-tabs button\.active:hover,[^}]*background:\s*var\(--color-primary-action-hover-bg\)/s,
    )
    expect(agentWorkspaceSource).toContain('.agent-tabs button:not(.active):hover')
    expect(agentWorkspaceSource).toContain('.history-mode-switch button:not(.active):hover')
  })
})
