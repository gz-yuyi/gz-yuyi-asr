# 语义科技ASR 客户端文档

VitePress documentation site plus a Vite modularized version of `test-console.html`.

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

## 版本与发布

项目版本以 `package.json` 为准。接口标准版本与测试控制台 HTML 使用同一个固定版本 release，不使用 `latest`：

- Release tag：`vX.Y.Z`
- Release asset：`yuyi-asr-test-console-vX.Y.Z.html`

发布前按变更类型更新版本号和 `CHANGELOG.md`：

- 接口标准重构或破坏兼容的契约变化：主版本号
- 向后兼容的接口小变化：次版本号
- 测试控制台 bug 修复、界面改进和功能变化：修订版本号
