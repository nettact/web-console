<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://nettact.org/brand/nettact-logo-horizontal-reverse.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://nettact.org/brand/nettact-logo-horizontal.svg">
    <img alt="NetTact" src="https://nettact.org/brand/nettact-logo-horizontal.svg" width="280">
  </picture>
</p>

# web-console

NetTact Web 控制台 —— Vue 3 + Vite + TypeScript + ECharts(PWA,架构 §12)。

开发:

```
npm install
npm run dev      # Vite :5173,代理 /api → http://localhost:12450
```

构建产物 `dist/` **不打包进 server 二进制**:发版时把 dist 压缩包发布为
本地联调时 server 设`NETTACT_WEBUI_LOCAL=../web-console/dist` 直接服务本地构建。


配套后端:[github.com/nettact/server](https://github.com/nettact/server)。
