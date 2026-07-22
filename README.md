# web-console

NetTact Web 控制台 —— Vue 3 + Vite + TypeScript + ECharts（PWA，架构 §12）。

开发：

```
npm install
npm run dev      # Vite :5173，代理 /api → http://localhost:12450
```

构建产物 `dist/` 会在 server-lite 构建时拷入其二进制（`go:embed`，M4）。

M1 页面：Agent 列表、网关 RTT / 丢包 ECharts 时序图、接口状态表。

配套后端：[github.com/nettact/server-lite](https://github.com/nettact/server-lite)。
