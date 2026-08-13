import { describe, expect, it } from 'vitest'
import workspaceSource from './AgentStatusWorkspace.vue?raw'

describe('Agent status desktop list layout', () => {
  it('keeps the Agent rows in the document scroll instead of capping the list height', () => {
    const desktopStart = workspaceSource.indexOf('@media (min-width: 72rem)')
    const desktopEnd = workspaceSource.indexOf('@media (min-width: 90rem)')
    const desktopStyles = workspaceSource.slice(desktopStart, desktopEnd)

    expect(desktopStart).toBeGreaterThanOrEqual(0)
    expect(desktopEnd).toBeGreaterThan(desktopStart)
    expect(desktopStyles).not.toMatch(/\.agent-list\s*\{[^}]*max-height/s)
    expect(desktopStyles).not.toMatch(/\.agent-list\s*\{[^}]*overflow-y/s)
  })
})
