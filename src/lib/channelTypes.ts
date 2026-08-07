import { PUSH_PROVIDERS } from './pushProviders'

export type ChannelTypeGroup = 'collaboration' | 'personal' | 'integration' | 'local'

export interface ChannelTypeDescriptor {
  type: string
  labelKey: string
  descriptionKey: string
  group: ChannelTypeGroup
  mark: string
  testable: boolean
}

const TYPE_META: Record<string, Omit<ChannelTypeDescriptor, 'type' | 'labelKey'>> = {
  webhook: {
    descriptionKey: 'settings.channelCatalog.descriptions.webhook',
    group: 'integration',
    mark: 'WH',
    testable: true,
  },
  email: {
    descriptionKey: 'settings.channelCatalog.descriptions.email',
    group: 'integration',
    mark: 'SMTP',
    testable: false,
  },
  dingtalk: {
    descriptionKey: 'settings.channelCatalog.descriptions.dingtalk',
    group: 'collaboration',
    mark: '钉',
    testable: true,
  },
  wecom: {
    descriptionKey: 'settings.channelCatalog.descriptions.wecom',
    group: 'collaboration',
    mark: '企',
    testable: true,
  },
  feishu: {
    descriptionKey: 'settings.channelCatalog.descriptions.feishu',
    group: 'collaboration',
    mark: '飞',
    testable: true,
  },
  telegram: {
    descriptionKey: 'settings.channelCatalog.descriptions.telegram',
    group: 'collaboration',
    mark: 'TG',
    testable: true,
  },
  serverchan: {
    descriptionKey: 'settings.channelCatalog.descriptions.serverchan',
    group: 'personal',
    mark: 'S³',
    testable: true,
  },
  wxpusher: {
    descriptionKey: 'settings.channelCatalog.descriptions.wxpusher',
    group: 'personal',
    mark: 'WX',
    testable: true,
  },
  system: {
    descriptionKey: 'settings.channelCatalog.descriptions.system',
    group: 'local',
    mark: 'OS',
    testable: false,
  },
}

const CORE_TYPES: ChannelTypeDescriptor[] = [
  { type: 'webhook', labelKey: 'settings.channelCatalog.types.webhook', ...TYPE_META.webhook },
  { type: 'email', labelKey: 'settings.channelCatalog.types.email', ...TYPE_META.email },
]

const PUSH_TYPES: ChannelTypeDescriptor[] = PUSH_PROVIDERS.map((provider) => ({
  type: provider.type,
  labelKey: provider.labelKey,
  ...(TYPE_META[provider.type] ?? {
    descriptionKey: provider.helpKey,
    group: 'integration',
    mark: provider.type.slice(0, 3).toUpperCase(),
    testable: true,
  }),
}))

const SYSTEM_TYPE: ChannelTypeDescriptor = {
  type: 'system',
  labelKey: 'settings.sysNotify',
  ...TYPE_META.system,
}

export function channelTypeCatalog(nativeNotify: boolean, exclude: string[] = []): ChannelTypeDescriptor[] {
  const types = [...CORE_TYPES, ...PUSH_TYPES, ...(nativeNotify ? [SYSTEM_TYPE] : [])]
  return types.filter((type) => !exclude.includes(type.type))
}

export function channelTypeDescriptor(type: string): ChannelTypeDescriptor {
  const found = [...CORE_TYPES, ...PUSH_TYPES, SYSTEM_TYPE].find((item) => item.type === type)
  if (found) return found
  return {
    type,
    labelKey: '',
    descriptionKey: '',
    group: 'integration',
    mark: type.slice(0, 3).toUpperCase(),
    testable: false,
  }
}
