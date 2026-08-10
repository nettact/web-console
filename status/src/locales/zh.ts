// A small, dedicated locale for the public page — around forty keys, not the
// console's three thousand. Importing src/locales would put every settings
// string, every incident label and every metric name into an anonymous visitor's
// download for no benefit.
export default {
  brand: 'NetTact',
  loading: '加载中…',
  retry: '重试',

  notFound: {
    title: '页面不存在',
    body: '这个状态页可能已被删除或停止发布。请向提供链接的人确认地址。',
  },
  noSlug: {
    title: '未指定状态页',
    body: '请使用完整链接访问，形如 /status/#/your-page。',
  },
  error: {
    title: '暂时无法加载',
    body: '连接服务器失败，稍后会自动重试。',
  },

  updated: {
    justNow: '刚刚更新',
    secondsAgo: '{n} 秒前更新',
    minutesAgo: '{n} 分钟前更新',
    hoursAgo: '{n} 小时前更新',
  },
  stale: '数据可能已过时，正在重试',

  agents: {
    title: '节点',
    empty: '这个页面没有公开任何节点。',
    unnamed: '节点 {n}',
    online: '在线',
    offline: '离线',
    since: '自 {time}',
    summary: '{online} / {total} 在线',
  },

  targets: {
    title: '监控目标',
    empty: '这个页面没有公开任何监控目标。',
    unnamed: '{kind} 目标 {n}',
    availability: '24 小时可用率',
    availabilityUnknown: '暂无数据',
    summary: '{up} / {total} 正常',
    status: {
      up: '正常',
      down: '异常',
      degraded: '波动',
      unknown: '未知',
    },
  },

  kind: {
    icmp: 'Ping',
    http: 'HTTP(s)',
    tcp: 'TCP',
    dns: 'DNS',
    nat: 'NAT',
    gateway: '网关',
    host: '系统',
  },

  theme: {
    toDark: '切换到深色',
    toLight: '切换到浅色',
  },
  lang: {
    toggle: 'English',
  },
  poweredBy: '由 NetTact 提供',
}
