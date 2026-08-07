// 推送渠道（钉钉 / 企业微信 / 飞书 / Telegram / Server酱 / WxPusher）的前端描述符，
// 是这六种渠道在控制台里的唯一事实来源：添加表单的 tab 顺序、字段与校验、渠道表
// Config 列的摘要、类型徽标文案，全部由这里派生。
//
// 为什么是描述符而不是六个手写表单：六家的表单差异只有「几个键、哪个必填、哪个是
// 密钥」，行为（trim、掩码回传、测试发送、恒带 lang）完全一致。写成数据后，
// PushChannelForm.vue 是唯一的渲染实现，新增一个平台只需在这里加一项 + 两个 locale
// 文件加键。
//
// 键名（`type` 与 `fields[].key`）是与 Go 服务端的契约 —— 服务端
// `notification/provider_*.go` 按同名 key 读 config，`SecretKeys()` 必须与这里标了
// `secret` 的字段一致，否则列表遮蔽与掩码合并会错位。
//
// labelKey / hintKey / helpKey 是 i18n 键（`settings.push.*`）；placeholder 反过来
// 是字面量 —— 它展示的是 token 形状（`AT_…`、`123456:ABC-DEF…`），翻译只会把它译坏。

export interface PushProviderField {
  // config map 里的键名，直接发给服务端。
  key: string
  labelKey: string
  required?: boolean
  // 凭据：输入框用 password，服务端 List 时遮成 MaskedSecret。
  secret?: boolean
  multiline?: boolean
  // 字面量占位符（不翻译），示意 token 形状。
  placeholder?: string
  hintKey?: string
}

export interface PushProviderDescriptor {
  // 渠道 type 串，与服务端 provider 注册表一致。
  type: string
  labelKey: string
  helpKey: string
  // 平台官方文档，「去哪拿凭据」的外链。
  helpUrl?: string
  fields: PushProviderField[]
  // 渠道表 Config 列展示的键；只能放非密钥字段。
  summaryKeys: string[]
}

// 顺序即添加表单里的 tab 顺序。
export const PUSH_PROVIDERS: PushProviderDescriptor[] = [
  {
    type: 'dingtalk',
    labelKey: 'settings.push.types.dingtalk',
    helpKey: 'settings.push.help.dingtalk',
    helpUrl: 'https://open.dingtalk.com/document/robots/custom-robot-access',
    fields: [
      { key: 'access_token', labelKey: 'settings.push.fields.access_token', required: true, secret: true },
      { key: 'secret', labelKey: 'settings.push.fields.secret', secret: true },
    ],
    summaryKeys: [],
  },
  {
    type: 'wecom',
    labelKey: 'settings.push.types.wecom',
    helpKey: 'settings.push.help.wecom',
    helpUrl: 'https://developer.work.weixin.qq.com/document/path/91770',
    fields: [{ key: 'key', labelKey: 'settings.push.fields.key', required: true, secret: true }],
    summaryKeys: [],
  },
  {
    type: 'feishu',
    labelKey: 'settings.push.types.feishu',
    helpKey: 'settings.push.help.feishu',
    helpUrl: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot',
    fields: [
      {
        key: 'webhook_url',
        labelKey: 'settings.push.fields.webhook_url',
        required: true,
        // 飞书的 Webhook 地址内嵌 token，本身就是凭据 —— 与通用 webhook 渠道的
        // `url`（UI 上的渠道身份，不遮）不同，这里按密钥处理。
        secret: true,
        placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…',
      },
      { key: 'secret', labelKey: 'settings.push.fields.secret', secret: true },
    ],
    summaryKeys: [],
  },
  {
    type: 'telegram',
    labelKey: 'settings.push.types.telegram',
    helpKey: 'settings.push.help.telegram',
    helpUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    fields: [
      {
        key: 'bot_token',
        labelKey: 'settings.push.fields.bot_token',
        required: true,
        secret: true,
        placeholder: '123456:ABC-DEF…',
      },
      { key: 'chat_id', labelKey: 'settings.push.fields.chat_id', required: true, placeholder: '-100… / @channel' },
      {
        key: 'api_base',
        labelKey: 'settings.push.fields.api_base',
        placeholder: 'https://api.telegram.org',
        hintKey: 'settings.push.hints.api_base',
      },
    ],
    summaryKeys: ['chat_id'],
  },
  {
    type: 'serverchan',
    labelKey: 'settings.push.types.serverchan',
    helpKey: 'settings.push.help.serverchan',
    helpUrl: 'https://sct.ftqq.com/',
    fields: [
      { key: 'sendkey', labelKey: 'settings.push.fields.sendkey', required: true, secret: true, placeholder: 'SCT… / sctp…' },
    ],
    summaryKeys: [],
  },
  {
    type: 'wxpusher',
    labelKey: 'settings.push.types.wxpusher',
    helpKey: 'settings.push.help.wxpusher',
    helpUrl: 'https://wxpusher.zjiecode.com/docs/',
    fields: [
      { key: 'app_token', labelKey: 'settings.push.fields.app_token', required: true, secret: true, placeholder: 'AT_…' },
      // uids / topic_ids 单独看都是可选，但至少要填一个 —— 这条表单级规则在
      // PushChannelForm 里按 type 特判，不值得为一家做规则 DSL。
      { key: 'uids', labelKey: 'settings.push.fields.uids', multiline: true, hintKey: 'settings.push.hints.uids' },
      { key: 'topic_ids', labelKey: 'settings.push.fields.topic_ids', hintKey: 'settings.push.hints.topic_ids' },
    ],
    summaryKeys: ['uids', 'topic_ids'],
  },
]

export function pushProvider(type: string): PushProviderDescriptor | undefined {
  return PUSH_PROVIDERS.find((p) => p.type === type)
}

export function isPushType(type: string): boolean {
  return pushProvider(type) !== undefined
}
