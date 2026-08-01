import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import zh from '../../locales/zh'
import PermissionRemediationDialog from './PermissionRemediationDialog.vue'

// Chinese is the default locale, so a key that exists only in en renders as a
// raw path to most users. The English suite covers behaviour; this one covers
// the half of it that is only visible in the shipped language.

function render(props: { permId: string; category: 'component'; desktop?: boolean }) {
  const i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh } })
  return mount(PermissionRemediationDialog, {
    props: { open: true, ...props },
    global: { plugins: [i18n], stubs: { teleport: true } },
  })
}

describe('PermissionRemediationDialog (zh)', () => {
  it('renders the component guidance without any unresolved keys', () => {
    const w = render({ permId: 'game.performance.read', category: 'component', desktop: true })
    const text = w.text()

    // vue-i18n falls back to the key path itself when a message is missing, so
    // any dotted key surviving into the output is a missing translation.
    expect(text).not.toMatch(/permRemediation\.\w+/)
    expect(text).not.toMatch(/permission(Hint|Platforms)?\.\w+/)

    // The permission is named and explained in Chinese, not by its id.
    expect(text).toContain('游戏帧数据读取')
    expect(text).toContain('帧率与帧时间')
    // The action and the caveat both survive translation.
    expect(text).toContain('PresentMon')
    expect(text).toContain('sc.exe query PresentMonSharedService')
    expect(text).toContain('重启 Agent')
  })
})
