import { defineConfig } from 'vitepress';

export default defineConfig({
  title: '语义科技ASR',
  description: '广州语义科技语音识别客户端接入文档',
  base: process.env.YUYI_DOCS_BASE || '/gz-yuyi-asr/',
  lastUpdated: true,
  ignoreDeadLinks: [/^\/console\//],
  themeConfig: {
    logo: { text: '语义科技ASR' },
    nav: [
      { text: '文档首页', link: '/' },
      { text: '实时转写', link: '/realtime-websocket-api' },
      { text: '离线转写', link: '/offline_async_http' },
      { text: '声纹识别', link: '/speaker_profiles_http' },
      { text: '热词管理', link: '/hotwords_http' },
      { text: '测试控制台', link: '/console/' },
    ],
    sidebar: [
      {
        text: '客户端接入',
        items: [
          { text: '接入概览', link: '/' },
          { text: '实时 WebSocket 转写 API', link: '/realtime-websocket-api' },
          { text: '离线异步转写 API', link: '/offline_async_http' },
          { text: '转写文本后处理模式', link: '/text-postprocessing' },
          { text: '声纹注册与识别 API', link: '/speaker_profiles_http' },
          { text: '热词管理 API', link: '/hotwords_http' },
          { text: '授权机制与调用流程', link: '/authorization-mechanism' },
        ],
      },
    ],
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/gz-yuyi/gz-yuyi-asr' },
    ],
    footer: {
      message: '广州语义科技语音识别客户端文档',
      copyright: 'Copyright © 2026 gz-yuyi',
    },
  },
});
