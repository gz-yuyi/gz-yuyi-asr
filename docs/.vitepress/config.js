import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'VoxFlow ASR',
  description: '广州语义科技语音识别客户端接入文档',
  base: '/gz-yuyi-asr/',
  lastUpdated: true,
  ignoreDeadLinks: [/^\/console\//],
  themeConfig: {
    logo: { text: 'VoxFlow' },
    nav: [
      { text: '文档首页', link: '/' },
      { text: '离线转写', link: '/offline_async_http' },
      { text: '声纹识别', link: '/speaker_profiles_http' },
      { text: '测试控制台', link: '/console/' },
    ],
    sidebar: [
      {
        text: '客户端接入',
        items: [
          { text: '接入概览', link: '/' },
          { text: '离线异步转写 API', link: '/offline_async_http' },
          { text: '声纹注册与识别 API', link: '/speaker_profiles_http' },
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
