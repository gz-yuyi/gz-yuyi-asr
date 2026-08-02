# 语义科技ASR 客户端文档

VitePress 客户端接口合同站点，以及模块化的 `test-console.html` 测试控制台。

`docs/` 只维护客户端可依赖的请求、响应、错误码和协议语义，不记录服务端架构、模型算法、存储路径、环境变量或部署运维细节；这些内容统一维护在 `yuyi-asr` 实现仓库。

Online console: https://gz-yuyi.github.io/gz-yuyi-asr/

## Commands

```bash
npm install
npm run dev          # documentation site
npm run dev:console  # test console
npm run build        # documentation + /console/ GitHub Pages payload
```

Console dev server entry: `http://localhost:5173/test-console.html`.

`npm run build` emits `dist-pages/` for GitHub Pages. The docs are served from `/`, and the standalone console is served from `/console/`.
