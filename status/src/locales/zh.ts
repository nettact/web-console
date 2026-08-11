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

  tabs: {
    label: '公开状态分类',
  },

  current: {
    title: '当前状态',
    healthy: {
      label: '运行正常',
      summary: '已公开资源目前未发现故障。',
    },
    fault: {
      label: '存在故障',
      summary: '已公开资源中至少有一项当前存在故障，请查看下方状态。',
    },
    unknown: {
      label: '状态待确认',
      summary: '部分已公开监控目标暂无结论，目前无法确认是否存在故障。',
    },
  },

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
    availabilityUnknown: '暂无数据',
    summary: '{up} / {total} 正常',
    // 服务端定义窗口列表；这里没有的会直接显示原始标识（如 "6h"）。
    window: {
      '24h': '24 小时',
      '7d': '7 天',
      '30d': '30 天',
      '90d': '90 天',
      '1y': '1 年',
    },
    rounds: '{n} 次探测',
    barTitle: '每日可用性',
    barStart: '{n} 天前',
    barEnd: '今天',
    barDay: '{date}：{status}；{availability}；{probes}',
    barDayEmpty: '{date}：暂无数据',
    dayAvailability: '当天可用率',
    dayProbes: '探测结果',
    dayProbeCount: '{ok} / {total} 次成功',
    dayNoProbes: '没有形成结论的探测',
    dayStatus: {
      none: '暂无结论',
      up: '全天正常',
      minor: '轻微波动',
      major: '部分故障',
      down: '严重故障',
    },
    status: {
      up: '正常',
      down: '异常',
      degraded: '波动',
      unknown: '未知',
    },
  },

  incidents: {
    title: '事故记录',
    summary: '{n} 条记录',
    empty: '这段时间内，已公开的目标和节点没有事故记录。',
    unknownSubject: '已公开服务',
    multipleSubjects: '{name} 等 {n} 项',
    window: '显示最近 {n} 天以及仍在进行的更早事故。',
    truncated: '仅显示最近 {n} 条事故。',
    started: '开始于 {time} · 已持续 {duration}',
    resolved: '开始于 {time} · 持续 {duration}',
    state: {
      open: '进行中',
      resolved: '已恢复',
    },
    impact: {
      degraded: '性能下降',
      outage: '服务中断',
    },
    duration: {
      seconds: '{n} 秒',
      minutes: '{n} 分钟',
      hours: '{n} 小时',
      days: '{n} 天',
    },
  },

  res: {
    cpu: 'CPU',
    load: '负载',
    memory: '内存',
    disk: '磁盘',
    network: '网络',
    uptime: '运行时长',
    ofTotal: '{used} / {total}',
    mounts: '{n} 个挂载点',
    stale: '该节点的数据已停止更新。',
    uptimeDH: '{d} 天 {h} 小时',
    uptimeHM: '{h} 小时 {m} 分',
    uptimeM: '{m} 分钟',
    uptimeS: '{s} 秒',
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
