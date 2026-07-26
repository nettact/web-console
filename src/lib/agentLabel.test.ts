import { describe, expect, it } from 'vitest'

import { agentLabel } from './agentLabel'

describe('agentLabel', () => {
  it('prefers the operator display name', () => {
    expect(agentLabel({ id: 'agent-1', display_name: 'Taipei NAS', hostname: 'random-7f2a' }))
      .toBe('Taipei NAS')
  })

  it('falls back to the reported hostname', () => {
    expect(agentLabel({ id: 'agent-1', display_name: '', hostname: 'nas.local' }))
      .toBe('nas.local')
  })

  it('falls back to the Agent ID when both names are blank', () => {
    expect(agentLabel({ id: 'agent-1', display_name: '   ', hostname: '\t' }))
      .toBe('agent-1')
  })

  it('trims names before displaying them', () => {
    expect(agentLabel({ id: 'agent-1', display_name: '  Taipei NAS  ', hostname: 'nas.local' }))
      .toBe('Taipei NAS')
  })
})
