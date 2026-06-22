# 更新日志

这里记录本项目的所有重要变更。

## 记录规则

- 接口标准重构或破坏兼容的契约变化，需要提升主版本号。
- 向后兼容的接口小变化，需要提升次版本号。
- 测试控制台的 bug 修复、界面改进和功能变化，需要提升修订版本号。
- 同一次变更跨多个类别时，使用要求最高的版本级别。

## [Unreleased]

## [v2.0.1] - 2026-06-23

### 修复

- 测试控制台实时转写结果区域增加固定滚动视窗，长内容时在结果区域内部滚动查看，避免最终片段过多时撑长整页。（关联 [#5](https://github.com/gz-yuyi/gz-yuyi-asr/issues/5)）

## [v2.0.0] - 2026-06-23

### 变更

- 离线转写接口文档补充授权失效时的创建任务拒收行为，明确 `create_task` 和 `create_task_upload` 返回 `FailedOperation.LicenseUnauthorized`，不会创建排队任务或保存上传文件。（关联 [yuyi-asr#9](https://github.com/gz-yuyi/yuyi-asr/issues/9)）
- 测试控制台 HTML 资产改为合并发布到 `vX.Y.Z` release，不再创建独立的 `console-vX.Y.Z` release。
- 测试控制台声纹管理页将多条 enrollment 明确展示为“声纹样本 / prototype”，并补充质量分含义和注册成功时生成 prototype 数提示，避免误解为识别出了多个不同人员。
- 测试控制台实时 WebSocket 面板切换到新版 `StartSession` / `FinishSession` JSON 控制协议，移除 URL query、旧 `refine_mode` / VAD 参数、旧文本 `stop` / `ping` 控制和非 PCM 实时编码选项。
- 测试控制台实时转写结果改为同一条时间线展示 CTC 草稿和 Qwen ASR 最终文本，在线说话人 turn 只在统计栏中体现待精修数量，避免草稿与精修结果割裂显示。

### 修复

- 测试控制台实时转写在最终精修覆盖草稿时间范围后隐藏对应草稿，并在会话完成后清空草稿状态，避免最终结果列表残留全量 CTC 草稿。
- 测试控制台实时转写草稿会用历史 CTC 基线裁掉已精修前缀，无法可靠裁剪时不再展示全量累积草稿；说话人待精修 turn 不再插入主时间线，避免出现与最终结果重叠的空白占位段。
- 测试控制台实时音频发送在 `sleep(ms)` 为空时按 `chunk(ms)` 发送节奏处理，避免误把文件测试跑成 0ms 高速灌流。
- 测试控制台单文件打包后会等待 DOM 加载完成再初始化，避免刷新预览页时根节点尚未解析导致页面空白。
- 测试控制台实时转写表格会按 `segment_deleted=true` 删除已展示片段，不再把严格语气词过滤产生的空删除事件渲染为空白行。（关联 [yuyi-asr#25](https://github.com/gz-yuyi/yuyi-asr/issues/25)）
- 测试控制台音频上传和声纹注册上传改为无硬超时的上传请求，并在上传状态中显示进度，避免大文件上传超过通用 HTTP 超时后只显示浏览器 abort 原始错误。（关联 [#27](https://github.com/gz-yuyi/yuyi-asr/issues/27)）
- 测试控制台实时转写将打字机临时预览从最终分段表中分离，记录删除事件最高 revision 防止迟到 partial 回放，并阻止容器/压缩音频使用原始文件分块模式导致逐帧解码失败。

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
