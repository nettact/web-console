import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import zh from '../../locales/zh'
import PermissionRemediationDialog from './PermissionRemediationDialog.vue'

// Chinese is the default locale, so a key that exists only in en renders as a
// raw path to most users. The English suite covers behaviour; this one covers
// the half of it that is only visible in the shipped language.

function render(props: {
  permId: string
  category: 'component' | 'agent_sensor' | 'unsupported'
  unsupportedReason?: string
  grantMissing?: boolean
  desktop?: boolean
}) {
  const i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh } })
  return mount(PermissionRemediationDialog, {
    props: { open: true, ...props },
    global: { plugins: [i18n], stubs: { teleport: true } },
  })
}

// Every reason code the server can send, so a missing zh translation shows up
// here rather than as a raw dotted key in front of the only audience that reads
// the default locale.
const REASON_CODES = [
  'presentmon_missing',
  'service_unavailable',
  'version_mismatch',
  'proto_mismatch',
  'sensor_missing',
  'probe_failed',
  'sensor_exited',
  'internal_error',
  'session_lost',
  'unsupported_os',
  'gpu_telemetry_unavailable',
]

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

  it('renders every reason code in Chinese, with no unresolved keys', () => {
    for (const reason of REASON_CODES) {
      // The category does not change which reason text renders, so one branch is
      // enough to prove the strings exist; the English suite covers the routing.
      const category = reason === 'unsupported_os' || reason === 'gpu_telemetry_unavailable' ? 'unsupported' : 'agent_sensor'
      const text = render({ permId: 'game.performance.read', category, unsupportedReason: reason, desktop: true }).text()
      expect(text, reason).not.toMatch(/permUnsupportedReason\./)
      expect(text, reason).not.toMatch(/permRemediation\.\w+/)
      expect(text, reason).not.toContain(reason)
    }
  })

  // The bug in the shipped language: PresentMon installed and healthy, console
  // telling the user in Chinese to go install it.
  it('names the build mismatch and clears PresentMon by name for proto_mismatch', () => {
    const text = render({
      permId: 'game.performance.read',
      category: 'agent_sensor',
      unsupportedReason: 'proto_mismatch',
      desktop: true,
    }).text()

    expect(text).toContain('来自不同的构建')
    expect(text).toContain('更新或重新安装 Agent')
    expect(text).toContain('没有任何帮助')
    // No install steps and no service check survive into this cause.
    expect(text).not.toContain('前往下载页')
    expect(text).not.toContain('sc.exe query')
  })

  // The three states the console can be in when it has no explanation. Each is a
  // different sentence in the default language, and none may tell a reader to
  // grant a permission that is already granted.
  it('words each no-answer state distinctly, with no unresolved keys', () => {
    const ungranted = render({
      permId: 'game.performance.read',
      category: 'component',
      grantMissing: true,
      desktop: true,
    }).text()
    expect(ungranted).toContain('不会去探测任何未被授予的能力')
    expect(ungranted).toContain('先授予该权限并重启 Agent')

    const granted = render({
      permId: 'game.performance.read',
      category: 'component',
      grantMissing: false,
      desktop: true,
    }).text()
    expect(granted).toContain('已经授予')
    expect(granted).toContain('升级 Agent')
    expect(granted).not.toContain('先授予该权限并重启 Agent')

    const unknown = render({
      permId: 'game.performance.read',
      category: 'component',
      unsupportedReason: 'a_code_from_a_newer_agent',
      grantMissing: false,
      desktop: true,
    }).text()
    expect(unknown).toContain('无法识别的原因码')
    expect(unknown).toContain('a_code_from_a_newer_agent')
    expect(unknown).not.toContain('没有上报原因')

    for (const text of [ungranted, granted, unknown]) {
      // All three still hedge, and none renders a raw key.
      expect(text).toContain('并非确定结论')
      expect(text).not.toMatch(/permRemediation\.\w+/)
    }
  })

  it('drops the install wording from the service-unavailable caveat', () => {
    const text = render({
      permId: 'game.performance.read',
      category: 'component',
      unsupportedReason: 'service_unavailable',
      desktop: true,
    }).text()
    expect(text).toContain('无需重新下载安装包')
    expect(text).toContain('服务恢复运行后需重启 Agent')
    expect(text).not.toContain('安装完成后需重启 Agent')
    expect(text).not.toContain('前往下载页')
  })
})
