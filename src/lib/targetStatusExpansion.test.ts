import { describe, expect, it, vi } from 'vitest'
import {
  TARGET_STATUS_EXPANSION_KEY,
  loadTargetStatusExpansion,
  saveTargetStatusExpansion,
} from './targetStatusExpansion'

describe('target-status expansion persistence', () => {
  it('loads a valid value, removes duplicate groups, and preserves all-collapsed state', () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(JSON.stringify({
        expandedGroupIds: ['group-1', 'group-1'],
        expandedTargetId: '',
      })),
    }

    expect(loadTargetStatusExpansion(storage)).toEqual({
      expandedGroupIds: ['group-1'],
      expandedTargetId: '',
    })
    expect(storage.getItem).toHaveBeenCalledWith(TARGET_STATUS_EXPANSION_KEY)
  })

  it('ignores malformed storage and never lets storage errors break the page', () => {
    expect(loadTargetStatusExpansion({ getItem: () => '{bad json' })).toBeNull()
    expect(loadTargetStatusExpansion({ getItem: () => JSON.stringify({ expandedGroupIds: 'group-1' }) })).toBeNull()
    expect(() => saveTargetStatusExpansion(
      { expandedGroupIds: [], expandedTargetId: '' },
      { setItem: () => { throw new Error('blocked') } },
    )).not.toThrow()
  })
})
