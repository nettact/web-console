import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './api'
import { ensurePermissionCatalog, permissionCatalog } from './permissionCatalog'

vi.mock('./api', () => ({ api: { permissionCatalog: vi.fn() } }))

const fetchCatalog = vi.mocked(api.permissionCatalog)

beforeEach(() => {
  permissionCatalog.loaded = false
  permissionCatalog.permissions = []
  permissionCatalog.bundles = []
})

describe('ensurePermissionCatalog', () => {
  it('drops game permissions from entries and from every bundle', async () => {
    fetchCatalog.mockResolvedValue({
      permissions: [
        { id: 'probe.icmp', default: true },
        { id: 'game.process.detect', default: false },
        { id: 'game.performance.read', default: false, requires: ['game.process.detect'] },
        { id: 'host.cpu.read', default: false },
      ],
      bundles: [
        { id: 'recommended', permissions: ['probe.icmp'] },
        { id: 'full', permissions: ['probe.icmp', 'host.cpu.read', 'game.process.detect', 'game.gpu.read'] },
      ],
    })

    await ensurePermissionCatalog()

    expect(permissionCatalog.permissions.map((p) => p.id)).toEqual(['probe.icmp', 'host.cpu.read'])
    expect(permissionCatalog.bundles).toEqual([
      { id: 'recommended', permissions: ['probe.icmp'] },
      { id: 'full', permissions: ['probe.icmp', 'host.cpu.read'] },
    ])
  })
})
