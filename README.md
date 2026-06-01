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
