# web-console

NetTact Web 控制台 —— Vue 3 + Vite + TypeScript + ECharts(PWA,架构 §12)。

开发:

```
npm install
npm run dev      # Vite :5173,代理 /api → http://localhost:12450
```

构建产物 `dist/` **不打包进 server-lite 二进制**:发版时把 dist 压缩包发布为
本仓库的公开 GitHub Release 资产,server-lite **运行时自动下载**(编译时经
ldflags 烧入精确版本号,SHA256 校验)。本地联调时 server-lite 设
`NETTACT_WEBUI_LOCAL=../web-console/dist` 直接服务本地构建。

M1 页面:Agent 列表、网关 RTT / 丢包 ECharts 时序图、接口状态表。

配套后端:[github.com/nettact/server-lite](https://github.com/nettact/server-lite)。
