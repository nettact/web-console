export interface TargetStatusExpansion {
  expandedGroupIds: string[]
  expandedTargetId: string
}

export const TARGET_STATUS_EXPANSION_KEY = 'nettact.target-status.expansion.v1.site_default'

export function loadTargetStatusExpansion(storage?: Pick<Storage, 'getItem'>): TargetStatusExpansion | null {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(TARGET_STATUS_EXPANSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<TargetStatusExpansion>
    if (!Array.isArray(value.expandedGroupIds) || !value.expandedGroupIds.every((id) => typeof id === 'string')) return null
    if (typeof value.expandedTargetId !== 'string') return null
    return {
      expandedGroupIds: [...new Set(value.expandedGroupIds)],
      expandedTargetId: value.expandedTargetId,
    }
  } catch {
    // Storage can be unavailable in private/locked-down browser contexts.
    return null
  }
}

export function saveTargetStatusExpansion(
  value: TargetStatusExpansion,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    ;(storage ?? globalThis.localStorage).setItem(TARGET_STATUS_EXPANSION_KEY, JSON.stringify(value))
  } catch {
    // Expansion memory is optional; the status page must remain usable without it.
  }
}
