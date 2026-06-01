---
layout: home

hero:
  name: VoxFlow ASR
  text: 客户端接入文档
  tagline: 离线录音转写、声纹注册识别、授权路数控制的 HTTP 接口说明。
  actions:
    - theme: brand
      text: 开始接入
      link: /offline_async_http
    - theme: alt
      text: 打开测试控制台
      link: /console/

features:
  - title: 离线异步转写
    details: 创建任务、上传音频、轮询状态、下载结果，并支持回调模式。
  - title: 声纹注册与识别
    details: 管理 Speaker Profile、注册 enrollment，并把临时 SpeakerId 映射到已知人员。
  - title: 授权路数控制
    details: 说明在线授权协议、并发路数限制和状态查询接口。
---

## 文档目录

- [离线异步转写 API](./offline_async_http.md)
- [声纹注册与识别 API](./speaker_profiles_http.md)
- [授权机制与调用流程](./authorization-mechanism.md)
- [在线测试控制台](/console/)
