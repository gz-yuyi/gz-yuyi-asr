# 更新日志

这里记录本项目的所有重要变更。

## 记录规则

- 接口标准重构或破坏兼容的契约变化，需要提升主版本号。
- 向后兼容的接口小变化，需要提升次版本号。
- 测试控制台的 bug 修复、界面改进和功能变化，需要提升修订版本号。
- 同一次变更跨多个类别时，使用要求最高的版本级别。

## [Unreleased]

### 变更

- 清理授权机制和离线异步 HTTP 文档中已过时或与现有接口重复的说明，避免产生错误的配置和实现预期。

### 新增

- 实时 WebSocket 接口新增输出语种白名单参数 `language` 和 `allowed_output_languages`，可限制只输出指定语种的识别结果。
- 测试控制台实时转写面板新增「输出语种」输入框，支持设置如 `zh` 或 `zh,en`。

## [v1.2.0] - 2026-07-06

### 新增

- 离线转写接口文档新增离线重叠说话检测、任务级说话人聚类参数、VAD/字词时间戳对齐 ASR 切段模式、RTTM 下载格式和调试产物 `Artifacts` 字段说明。
- 测试控制台离线任务新增说话人分离高级参数，可设置重叠说话修正、已知说话人数、聚类算法、聚类阈值、说话人数范围和 ASR 切段模式，并新增 RTTM 结果下载入口。
- 新增 GitHub Pages 自动部署流程，`main` 分支更新和手动触发会重新构建文档与测试控制台并同步到 `gh-pages` 分支。

### 变更

- 实时 WebSocket 文档延续 v1 `TranscriptUpdate + revision` 单事件下行模型，并补充 `StartSession` / `FinishSession` / `CancelSession` 与 URL query / `ping` / `stop` 的双模式兼容说明。
- 测试控制台实时 WebSocket 面板恢复按 `TranscriptUpdate` 单事件流增量渲染，草稿、最终文本、说话人和词级时间戳都按同一 `segment_id` 的最高 `revision` 更新，并补回 VAD 阈值和最小静音时长配置入口。
- 离线转写接口文档补充授权失效时的创建任务拒收行为，明确 `create_task` 和 `create_task_upload` 返回 `FailedOperation.LicenseUnauthorized`，不会创建排队任务或保存上传文件。（关联 [yuyi-asr#9](https://github.com/gz-yuyi/yuyi-asr/issues/9)）
- 测试控制台 HTML 资产改为合并发布到 `vX.Y.Z` release，不再创建独立的 `console-vX.Y.Z` release。
- 测试控制台声纹管理页将多条 enrollment 明确展示为“声纹样本 / prototype”，并补充质量分含义和注册成功时生成 prototype 数提示，避免误解为识别出了多个不同人员。

### 修复

- 测试控制台音频上传和声纹注册上传改为无硬超时的上传请求，并在上传状态中显示进度，避免大文件上传超过通用 HTTP 超时后只显示浏览器 abort 原始错误。（关联 [#27](https://github.com/gz-yuyi/yuyi-asr/issues/27)）
- 测试控制台单文件打包后会等待 DOM 加载完成再初始化，避免刷新预览页时根节点尚未解析导致页面空白。
- 测试控制台实时转写表格会按 `segment_deleted=true` 删除已展示片段，不再把严格语气词过滤产生的空删除事件渲染为空白行。（关联 [yuyi-asr#25](https://github.com/gz-yuyi/yuyi-asr/issues/25)）
- 测试控制台实时音频发送在 `sleep(ms)` 为空时按 `chunk(ms)` 发送节奏处理，避免误把文件测试跑成 0ms 高速灌流。
- 测试控制台实时转写结果区域增加固定滚动视窗并在持续收到转写事件时保持贴底滚动，避免长音频测试时看不到最新片段。
- 测试控制台实时转写草稿展示适配滚动窗口与迟到修订，避免已精修前缀或旧草稿在结果区重复显示。

## [v1.1.2] - 2026-06-11

### 变更

- 声纹注册接口文档补充多 prototype enrollment 返回字段和环境变量说明，明确多 prototype 仍归并到同一 Profile，不会被当成不同人员。

## [v1.1.1] - 2026-06-07

### 新增

- 测试控制台实时 WebSocket 面板新增 `refine_mode` 选择项，并在连接时写入 WebSocket URL，便于验收 `none` / `speaker_only` / `asr_only` / `all` 四种闭段修正策略。
- 测试控制台实时 WebSocket 面板新增音频 URL 加载入口，便于在浏览器文件上传不可用的环境中通过 HTTP 音频地址完成流式发送验收。

## [v1.1.0] - 2026-06-05

### 新增

- 实时 WebSocket 转写接口新增 `refine_mode` 参数，用于控制闭段修正策略，支持 `none` / `speaker_only` / `asr_only` / `all`。
- 实时 WebSocket 转写接口新增注册声纹识别参数和 `TranscriptUpdate` 匹配字段，统一实时与离线声纹识别结果语义。

### 变更

- 明确闭段 `offline_asr` 精修和 speaker refine 是可选能力，默认使用 `speaker_only`，避免实时草稿和闭段精修对所有片段重复推理。
- 补充实时会话资源限制建议和对应错误码，覆盖会话数、会话时长、音频帧大小和超时限制。

## [v1.0.0] - 2026-06-05

### 新增

- 新增热词管理 API 文档，覆盖热词表新增、查询、列表和删除接口。
- 新增中心文档仓库维护规则，要求更新日志、语义版本和版本化测试控制台产物同步维护。

### 变更

- 将接口标准确认为中心文档维护，并补齐离线转写任务的上传、结果、取消、列表、音频、下载和统计接口说明。
- 测试控制台 HTML release 改为按版本发布，使用 `vX.Y.Z` tag 和 `yuyi-asr-test-console-vX.Y.Z.html` 资产命名。

### 修复

- 清理声纹注册与识别文档中的重复 `GroupId` / `GroupName` 参数说明。
- 删除声纹 Profile 删除接口文档中当前实现不支持的 `GroupId` 参数。
