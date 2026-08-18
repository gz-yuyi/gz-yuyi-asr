# 实时 WebSocket 接口

本文档描述语义科技 ASR 服务的实时语音 WebSocket 协议。

协议采用「片段修订 + 原子重切段批次」模型：单片段更新使用 `TranscriptUpdate`；一次说话人重切段产生“删除父段 + 新增子段”或“删除子段 + 恢复父段”时，使用一个 `TranscriptUpdateBatch` WebSocket 消息原子交付。客户端仍按 `segment_id` 保留最大 `revision`。

> [!NOTE]
> `TranscriptUpdateBatch` 不提供兼容开关：结构性说话人重切段固定使用批次事件，普通单片段 revision 仍使用 `TranscriptUpdate`。

## 1. 地址

- 路径：`WS /api/realtime/ws`
- 本地默认地址：`ws://127.0.0.1:18080/api/realtime/ws`

协议支持两种握手方式，服务端按客户端首帧自动判定：新式握手用 `StartSession` 首帧携带配置（推荐）；v1 兼容握手用 URL query 携带配置、连接后直接发音频。详见 §3.1。

## 2. 协议原则

- 片段闭合后，`segment_id / start_ms / end_ms` 保持稳定；说话人重切段会删除父段并创建新的子段 ID，不会修改原 ID 的时间范围。
- 同一 `segment_id` 可以收到更高 `revision` 的修正结果。
- 客户端只保留同一 `segment_id` 的最大 `revision`。
- 只影响一个片段的逻辑操作使用单个 `TranscriptUpdate`。
- 一次结构性说话人重切段必须把同一父子片段族的全部删除、恢复和新增放入同一个 `TranscriptUpdateBatch`；服务端不得再把其中的子更新单独发送。
- 同一轮全局聚类若重切多个互不相关的父段，每个父子片段族分别形成一个批次，避免长会话产生无界的大消息；普通的单片段 speaker revision 仍使用 `TranscriptUpdate`。
- 批次只改变传输和提交边界，不改变每个片段的文本、时间、speaker、`segment_id` 或 `revision` 计算结果。
- v1 与 v2 握手使用相同的下行事件结构，差异仅在握手与控制帧形态。

## 3. 会话建立与音频

### 3.1 握手模式与兼容

协议支持两种握手，服务端按客户端首帧自动判定，无需额外协商：

- **新式握手（推荐，`protocol_version=2`）**：连接后第一条消息是 JSON 文本帧 `StartSession`，会话级配置全部在该帧内传递。
- **v1 兼容握手（`protocol_version=1`）**：连接时用 URL query 参数携带配置，连接后直接发送二进制音频帧，不发 `StartSession`。用于存量 v1 客户端。

判定规则：

- 首帧是可解析为 JSON 且 `type=StartSession` 的文本帧 → 新式握手。
- 首帧是二进制音频帧（或 URL 带 query 参数且首帧不是 `StartSession`）→ v1 兼容握手，配置取自 URL query，缺省用默认值。

`SessionStarted` 事件回传 `protocol_version`，告诉客户端服务端把本连接识别成了哪种模式。两种模式下事件（下行）schema 完全一致，差异只在握手与控制帧形态。

### 3.2 `StartSession`（新式握手）

新式握手下，连接成功后的第一条文本帧必须是 `StartSession`，用于携带全部会话级配置：

```json
{
  "type": "StartSession",
  "audio_encoding": "pcm_s16le",
  "sample_rate": 16000,
  "hotword_id": "default",
  "context": "",
  "allowed_output_languages": ["zh", "en"],
  "vad_threshold": 0.25,
  "vad_min_silence_duration_ms": 500,
  "enable_speaker": true,
  "enable_align": true,
  "speaker_num": null,
  "group_ids": ["default"],
  "speaker_profile_ids": [],
  "number_normalization_mode": 1,
  "filler_filter_mode": 0,
  "profanity_filter_mode": 0
}
```

字段说明：

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---:|---|---|
| `type` | string | 是 | 无 | 固定 `StartSession` |
| `audio_encoding` | string | 否 | `pcm_s16le` | 实时音频编码：`pcm_s16le / wav / mp3 / aac / m4a / opus` |
| `sample_rate` | int | 否 | `16000` | 采样率；`pcm_s16le` 时必须为 `16000` |
| `hotword_id` | string/null | 否 | `default` | 热词表 ID |
| `context` | string/null | 否 | 空 | 会话级 ASR 背景提示；与服务端自动滚动前文组合使用 |
| `language` | string/null | 否 | 未设置 | 输出语种限制（单语种），如 `zh`、`en`、`ja`、`ko`；传入时替换默认中英白名单 |
| `allowed_output_languages` | string/array/null | 否 | `["zh","en"]` | 输出语种白名单（多语种），如 `"zh,en"` 或 `["zh","en"]`；中文方言如 `Cantonese/yue` 归入 `zh` |
| `vad_threshold` | float | 否 | `0.25` | VAD 阈值 |
| `vad_min_silence_duration_ms` | int | 否 | `500` | 闭段最小静音时长 |
| `enable_speaker` | bool | 否 | `true` | 是否启用说话人回写；启用时服务端自动执行注册声纹识别 |
| `enable_align` | bool | 否 | `true` | 是否生成词级时间戳；`false` 时跳过强制对齐并且不返回 `words`。最终生效还受服务端 `--no-align` 限制 |
| `speaker_mode` | string/null | 否 | `cluster` | 说话人后端：`cluster`（最终与离线聚类对齐）或 `diart`（低延迟在线跟踪） |
| `speaker_num` | int/null | 否 | 空 | 指定说话人数；为空使用自动估计 |
| `group_ids` | string/array/null | 否 | `default` | 限定本次会话可匹配的声纹组 |
| `speaker_profile_ids` | string/array/null | 否 | 空 | 限定本次会话可匹配的注册人员；为空匹配指定组内全部启用声纹 |
| `number_normalization_mode` | int | 否 | `1` | 数字转换模式：`0/1/3` |
| `filler_filter_mode` | int | 否 | `0` | 语气词过滤模式：`0/1/2` |
| `profanity_filter_mode` | int | 否 | `0` | 脏词过滤模式：`0/1/2` |

注册声纹匹配随 `enable_speaker` 启用或关闭。旧客户端传入的 `enable_speaker_recognition` 会被忽略。

实时服务默认自动保存最近 5 个已闭段最终文本（最多 160 个 Unicode 字符），并仅在当前 VAD 语音段不超过 1.2 秒时，把这些前文作为 Qwen3-ASR 的系统上下文。它用于消解短句中的同音词，不会重复编码音频，也不会使用 `Partial`、词时间戳或说话人修订作为前文。客户端 `context` 是可选的固定背景，两者可同时生效。部署端可用以下环境变量调整或关闭：

- `YUYI_ASR_REALTIME_ROLLING_CONTEXT=0/1`
- `YUYI_ASR_REALTIME_ROLLING_CONTEXT_UTTERANCES`（默认 `5`）
- `YUYI_ASR_REALTIME_ROLLING_CONTEXT_CHARS`（默认 `160`）
- `YUYI_ASR_REALTIME_ROLLING_CONTEXT_MAX_UTTERANCE_SECONDS`（默认 `1.2`；`0` 表示所有段）

服务端解析成功后返回 `SessionStarted`（`protocol_version=2`），其中回显实际生效的配置。若 `StartSession` 非法，返回 `ErrorResponse(error_code=SESSION_ERROR)` 并关闭连接。

### 3.3 URL Query 参数（v1 兼容握手）

存量 v1 客户端在连接 URL 上携带配置，连接后直接发二进制音频，不发 `StartSession`：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---:|---|---|
| `hotword_id` | string | 否 | `default` | 热词表 ID |
| `context` | string | 否 | 空 | 识别上下文提示 |
| `language` | string | 否 | 未设置 | 输出语种限制（单语种），如 `zh`、`en` |
| `allowed_output_languages` | string | 否 | `zh,en` | 输出语种白名单（逗号分隔），如 `zh,en` |
| `vad_threshold` | float | 否 | `0.25` | VAD 阈值 |
| `vad_min_silence_duration_ms` | int | 否 | `500` | 闭段最小静音时长 |
| `enable_speaker` | bool | 否 | `true` | 是否启用说话人回写；启用时自动执行注册声纹识别 |
| `enable_align` | bool | 否 | `true` | 是否生成词级时间戳（同新式握手字段） |
| `speaker_mode` | string | 否 | `cluster` | `cluster` 或 `diart`；推荐新客户端通过 `StartSession` 设置 |
| `speaker_num` | int | 否 | 空 | 指定说话人数 |
| `group_ids` | string | 否 | `default` | 限定本次会话可匹配的声纹组 |
| `speaker_profile_ids` | string | 否 | 空 | 限定本次会话可匹配的注册人员 |
| `audio_encoding` | string | 否 | `pcm_s16le` | 实时音频编码 |
| `sample_rate` | int | 否 | `16000` | 采样率 |
| `number_normalization_mode` | int | 否 | `1` | 数字转换模式：`0/1/3` |
| `filler_filter_mode` | int | 否 | `0` | 语气词过滤模式：`0/1/2` |
| `profanity_filter_mode` | int | 否 | `0` | 脏词过滤模式：`0/1/2` |

示例：

```text
ws://127.0.0.1:18080/api/realtime/ws?enable_speaker=true&vad_threshold=0.25&sample_rate=16000&language=zh&number_normalization_mode=1
```

query 参数与新式握手的 `StartSession` 字段一一对应、语义相同。新客户端不应再使用 query 参数。

不传输出语种参数时默认允许中文和英语（`zh,en`）；需要其它语种集合时应显式传入白名单。不符合白名单的内容可能被过滤；过滤后没有可见文本时，服务端会通过 `segment_deleted=true` 通知客户端删除该片段。

### 3.4 二进制音频帧

握手完成后（新式握手为 `StartSession` 成功、v1 兼容握手为连接建立），客户端持续发送二进制音频帧。

- `pcm_s16le`
  - 编码：`PCM16LE`
  - 声道：`mono`
  - 采样率：`16000`
  - 每帧字节数必须为偶数
- `wav/mp3/aac/m4a/opus`
  - 每个二进制帧必须是可独立解码的音频块

如果格式不符合，服务端返回 `ErrorResponse`，`error_code=UNSUPPORTED_AUDIO_ENCODING` 或 `AUDIO_DECODE_ERROR`。

### 3.5 控制消息

控制消息为文本帧。为兼容 v1，服务端同时接受两种形态，语义按下表对应：

| 动作 | 新式（JSON） | v1 兼容（裸文本） |
|---|---|---|
| 心跳 | `{"type":"Ping"}` | `ping` |
| 正常结束（冲刷尾部） | `{"type":"FinishSession"}` | `stop` |
| 取消（丢弃尾部） | `{"type":"CancelSession"}` | 无（v1 无取消语义） |

#### `Ping` / `ping`

服务端返回 `Pong`。

#### `FinishSession` / `stop`

服务端停止接收音频，发送剩余的 `TranscriptUpdate` / `TranscriptUpdateBatch`，最后返回 `SessionCompleted` 并关闭连接。

#### `CancelSession`

仅新式握手提供。服务端取消会话，不再发送剩余结果，直接返回 `SessionCompleted`（`canceled=true`）并关闭连接。

其他文本消息返回 `ErrorResponse`，`error_code=INVALID_CONTROL_COMMAND`。

## 4. 事件时序

1. 会话建立后，客户端持续发送音频帧。
2. 服务端可以对同一片段发送多次 `TranscriptUpdate`，`revision` 单调递增。
3. 一次说话人重切段影响一个父子片段族时，服务端在一个 WebSocket 文本消息中发送 `TranscriptUpdateBatch`；批次中的 `updates` 共同构成一次不可拆分的状态变更。
4. `FinishSession` 后，服务端发送剩余更新和一个 `SessionCompleted`；`SessionCompleted` 必须排在所有批次之后。
5. `CancelSession` 后，服务端返回 `SessionCompleted(canceled=true)`。

## 5. 客户端状态管理规则

客户端以 `segment_id` 作为主键。对于同一个 `segment_id`：

- 若新消息的 `revision` 小于等于本地版本，丢弃。
- 若新消息的 `segment_deleted=true`，删除/隐藏该 `segment_id`；如果带有 `supersedes_segment_id`，也删除/隐藏被替代的父片段。
- 若 `revision` 更高，则整体替换文本与说话人/情绪状态。

收到 `TranscriptUpdateBatch` 时，客户端必须：

1. 先完整解析并校验整个消息，不得边解析边修改正式状态。
2. 以 `batch_id` 做幂等去重；同一会话内重复收到相同 `batch_id` 时整批忽略。
3. 在临时副本或数据库事务中，按 `updates` 数组顺序逐项执行上述 `segment_id + revision` 规则。
4. 所有子更新均处理成功后一次性提交；任一子更新结构非法时整批不得部分提交。
5. 批次提交后只触发一次渲染、持久化或下游业务回调，不得为每个子更新分别触发业务副作用。

`atomic=true` 表示客户端不可观察到批次的中间状态，不表示批次共享一个 revision。每个子更新仍有独立的 `segment_id` 和 `revision`。

推荐最小状态结构：

```json
{
  "segment_id": "seg_000001",
  "revision": 4,
  "text": "广州在全球智慧城市大会获“城市大奖”。",
  "speaker_id": 2,
  "speaker_state": "stable",
  "emotion": "neutral",
  "emotion_state": "stable",
  "start_ms": 1200,
  "end_ms": 3860,
  "is_final": true
}
```

## 6. 通用返回字段

所有服务端事件都带这些字段：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 事件类型 |
| `code` | int | 状态码 |
| `message` | string | 状态说明 |
| `session_id` | string | 会话 ID |
| `server_time_ms` | int | 服务端发送时间戳（毫秒） |

## 7. 服务端事件

### 7.1 `SessionStarted`

会话创建成功后返回一次，回显实际生效的关键配置。

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `SessionStarted` |
| `protocol_version` | int | 服务端识别到的握手模式：`1`=v1 兼容，`2`=新式 |
| `audio_encoding` | string | 实际生效的音频编码 |
| `sample_rate` | int | 实际生效的采样率 |
| `enable_speaker` | bool | 当前会话是否启用说话人回写 |
| `speaker_mode` | string | 实际生效的说话人后端：`cluster` / `diart` |
| `enable_speaker_recognition` | bool | 服务端计算的声纹识别状态；与 `enable_speaker` 联动，不是客户端配置项 |
| `allowed_output_languages` | array | 实际生效的输出语种白名单；默认返回 `["zh","en"]` |

示例：

```json
{
  "type": "SessionStarted",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900000123,
  "protocol_version": 2,
  "audio_encoding": "pcm_s16le",
  "sample_rate": 16000,
  "enable_speaker": true,
  "enable_speaker_recognition": true,
  "allowed_output_languages": ["zh", "en"]
}
```

### 7.2 `TranscriptUpdate`

单片段核心事件。同一片段可能多次返回；结构性说话人重切段涉及一个父子片段族时，这些完整的 `TranscriptUpdate` 对象必须嵌入 `TranscriptUpdateBatch.updates`，不得作为多个独立 WebSocket 消息发送。

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `TranscriptUpdate` |
| `segment_id` | string | 片段 ID |
| `revision` | int | 当前片段的版本号，单调递增 |
| `source` | string | `streaming` / `offline_asr` / `speaker_refine` / `emotion_refine` |
| `is_final` | bool | 当前片段是否已闭段 |
| `text` | string | 最新文本 |
| `segment_deleted` | bool | 是否删除/隐藏该片段；为 `true` 时客户端不应展示 `text` |
| `supersedes_segment_id` | string/null | 被本片段替代的父片段 ID（用于合并/拆分场景） |
| `parent_segment_id` | string/null | 本片段派生自的父片段 ID |
| `start_ms` | int | 片段起始时间 |
| `end_ms` | int/null | 片段结束时间；未闭段时可为空 |
| `speaker_id` | int/null | 当前会话内的展示 speaker 编号 |
| `speaker_state` | string | `pending` / `provisional` / `stable` |
| `speaker_is_final` | bool | **仅 Diart 最终说话人回写出现**；为 `true` 时，该 revision 携带的说话人字段不会再改变。Cluster 模式始终省略此字段 |
| `speaker_match_status` | string/null | 注册声纹匹配状态：`matched` / `unknown`；未进行说话人回写时可省略 |
| `speaker_profile_id` | string/null | 命中的注册声纹 Profile ID |
| `speaker_name` | string/null | 命中的注册人员名称 |
| `speaker_match_score` | number/null | 注册声纹 cosine 匹配分数 |
| `speaker_enrollment_id` | string/null | 命中的 enrollment ID |
| `emotion` | string/null | 情绪标签；建议值：`neutral / happy / sad / angry` |
| `emotion_score` | number/null | 情绪置信度，范围建议 `0.0 - 1.0` |
| `emotion_state` | string/null | `pending` / `stable` |
| `replace_all_text` | bool | 客户端应按整段替换处理 |

语义说明：

- `source=streaming`：片段的初始或闭段文本。
- `source=offline_asr`：文本修正。
- `source=speaker_refine`：说话人字段修正。
- `source=emotion_refine`：情绪字段补充或修正。
- `speaker_is_final=true`：仅 Diart 在跟踪覆盖水位越过该段结尾后返回；即使说话人 ID 没有发生变化，也会发送一次完成消息。之后仍可能因其它字段收到更高 `revision`，但该段的 `speaker_id` 及注册声纹字段不会再改变。
- Cluster 会随着新音频继续全局重聚类，因此会话进行中不返回 `speaker_is_final`；流结束后以 `SessionCompleted` 前各段收到的最大 `revision` 为最终结果。
- `is_final=true`：表示片段已闭合，但不表示后续不会再收到更高 `revision`（词级时间戳、离线精修、说话人回填仍可能到来），也不等价于说话人最终完成。
- 启用 `enable_align` 时，词级时间戳可能在闭段文本之后以同一 `segment_id` 的更高 `revision` 单独回带；客户端不应假设 `words` 与初始 final 同时到达。
- 流式草稿（`is_final=false`）仅作展示用途，随着更多音频到达可能发生局部回退或改写；客户端应按 `segment_id + revision` 整段替换，并以 `is_final=true` 的文本为准。该语义不依赖服务端采用哪种推理后端。
- `segment_deleted=true`：该片段最终文本被后处理过滤为空（例如语气词过滤后无有效内容）；客户端若已展示该 `segment_id`，应删除/隐藏；如同时存在 `supersedes_segment_id`，还应删除/隐藏被替代的父片段。
- 单纯过滤一个片段可以独立发送删除事件；说话人重切段产生的“删除父段 + 新增子段”或“删除子段 + 恢复父段”必须使用 `TranscriptUpdateBatch` 原子发送。

尚无情绪结果时，`emotion` 和 `emotion_score` 可以为 `null`，`emotion_state` 为 `pending`；结果稳定后 `emotion_state` 为 `stable`。

示例 1：流式草稿

```json
{
  "type": "TranscriptUpdate",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900001789,
  "segment_id": "seg_000001",
  "revision": 1,
  "source": "streaming",
  "is_final": false,
  "text": "广州在全球智慧城市大会",
  "segment_deleted": false,
  "start_ms": 1200,
  "end_ms": null,
  "speaker_id": null,
  "speaker_state": "pending",
  "replace_all_text": true
}
```

示例 2：离线 ASR 修正

```json
{
  "type": "TranscriptUpdate",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900004188,
  "segment_id": "seg_000001",
  "revision": 3,
  "source": "offline_asr",
  "is_final": true,
  "text": "广州在全球智慧城市大会获“城市大奖”。",
  "segment_deleted": false,
  "start_ms": 1200,
  "end_ms": 3860,
  "speaker_id": null,
  "speaker_state": "pending",
  "replace_all_text": true
}
```

示例 3：Diart 最终说话人回写

```json
{
  "type": "TranscriptUpdate",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900005633,
  "segment_id": "seg_000001",
  "revision": 4,
  "source": "speaker_refine",
  "is_final": true,
  "text": "广州在全球智慧城市大会获“城市大奖”。",
  "segment_deleted": false,
  "start_ms": 1200,
  "end_ms": 3860,
  "speaker_id": 1,
  "speaker_state": "stable",
  "speaker_is_final": true,
  "replace_all_text": true
}
```

示例 4：情绪补充

```json
{
  "type": "TranscriptUpdate",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900005733,
  "segment_id": "seg_000001",
  "revision": 5,
  "source": "emotion_refine",
  "is_final": true,
  "text": "广州在全球智慧城市大会获“城市大奖”。",
  "segment_deleted": false,
  "start_ms": 1200,
  "end_ms": 3860,
  "speaker_id": 1,
  "speaker_state": "stable",
  "emotion": "neutral",
  "emotion_score": 0.82,
  "emotion_state": "stable",
  "replace_all_text": true
}
```

示例 5：最终修正为空，删除已展示片段

```json
{
  "type": "TranscriptUpdate",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900006123,
  "segment_id": "seg_000001",
  "revision": 6,
  "source": "offline_asr",
  "is_final": true,
  "text": "",
  "segment_deleted": true,
  "start_ms": 1200,
  "end_ms": 3860,
  "speaker_id": 1,
  "speaker_state": "stable",
  "replace_all_text": true
}
```

### 7.3 `TranscriptUpdateBatch`

一个父子片段族发生结构性替换时使用的原子批次事件。第一版仅用于 `source=speaker_refine` 和 `reason=speaker_resegmentation`；服务端把该父段及其子段的全部删除、恢复和新增放在一个 WebSocket 文本消息中。普通的多段 speaker ID 修正不强行合并为一个无限增长的批次。

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `TranscriptUpdateBatch` |
| `batch_id` | string | 会话内唯一且单调生成的批次 ID，用于日志关联和客户端幂等去重 |
| `source` | string | 第一版固定为 `speaker_refine` |
| `reason` | string | 第一版固定为 `speaker_resegmentation`（拆分或恢复一个父子片段族） |
| `atomic` | bool | 固定为 `true`；客户端必须一次性提交整个批次 |
| `updates` | array | 非空数组；每项都是完整的 `TranscriptUpdate` 对象，继续使用各自的 `segment_id` 和 `revision` |

约束：

- 一个批次必须封装在一个 WebSocket 文本消息内，不能拆成多个消息，也不能把内部 `updates` 再独立发送。
- 一个批次只包含一个父段及其派生子段；多个互不相关的父段分别发送批次，从而把单帧大小限制在单个 ASR 段的文本和词时间戳规模内。
- `updates` 使用确定顺序：先删除旧片段，再恢复或新增新片段；客户端仍应以原子事务提交，因此该顺序不会形成可见中间状态。
- 嵌套 `TranscriptUpdate` 的 `session_id` 必须与批次一致，`source` 必须为 `speaker_refine`。
- 子段必须设置 `parent_segment_id`；替代父段时设置 `supersedes_segment_id`，客户端不得依赖 `_01/_02` ID 后缀推断父子关系。
- Diart 最终批次中的有效子段继续返回 `speaker_is_final=true`；Cluster 模式仍省略该字段。
- `batch_id` 不替代片段 revision。批次重放时按 `batch_id` 整批去重，片段状态冲突时仍以每个 `segment_id` 的最大 `revision` 为准。
- 将 `updates` 按数组顺序展开后，必须与旧逐条协议产生完全相同的每段内容和 revision；批次封装不得筛选、合并或丢弃任何修正。
- 服务端在发送批次前已经拥有全部子更新，打包过程不得等待额外模型结果，因此不能额外增加 ASR、Align 或说话人推理延迟。

示例：一个父段按说话人切成两个子段

```json
{
  "type": "TranscriptUpdateBatch",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900006200,
  "batch_id": "batch_000007",
  "source": "speaker_refine",
  "reason": "speaker_resegmentation",
  "atomic": true,
  "updates": [
    {
      "type": "TranscriptUpdate",
      "code": 0,
      "message": "success",
      "session_id": "sess_8db8f0",
      "server_time_ms": 1762900006200,
      "segment_id": "seg_000001",
      "revision": 5,
      "source": "speaker_refine",
      "is_final": true,
      "text": "你好谢谢",
      "segment_deleted": true,
      "start_ms": 1200,
      "end_ms": 3860,
      "speaker_id": 0,
      "speaker_state": "stable",
      "replace_all_text": true
    },
    {
      "type": "TranscriptUpdate",
      "code": 0,
      "message": "success",
      "session_id": "sess_8db8f0",
      "server_time_ms": 1762900006200,
      "segment_id": "seg_000001_01",
      "revision": 1,
      "source": "speaker_refine",
      "is_final": true,
      "text": "你好",
      "segment_deleted": false,
      "supersedes_segment_id": "seg_000001",
      "parent_segment_id": "seg_000001",
      "start_ms": 1200,
      "end_ms": 2480,
      "speaker_id": 0,
      "speaker_state": "stable",
      "replace_all_text": true
    },
    {
      "type": "TranscriptUpdate",
      "code": 0,
      "message": "success",
      "session_id": "sess_8db8f0",
      "server_time_ms": 1762900006200,
      "segment_id": "seg_000001_02",
      "revision": 1,
      "source": "speaker_refine",
      "is_final": true,
      "text": "谢谢",
      "segment_deleted": false,
      "supersedes_segment_id": "seg_000001",
      "parent_segment_id": "seg_000001",
      "start_ms": 2480,
      "end_ms": 3860,
      "speaker_id": 1,
      "speaker_state": "stable",
      "replace_all_text": true
    }
  ]
}
```

如果后续聚类认为不应拆分，服务端使用另一个 `reason=speaker_resegmentation` 批次，按顺序删除 `seg_000001_01`、`seg_000001_02`，再以更高 revision 恢复 `seg_000001`。客户端仍只提交一次业务状态。

### 7.4 `SessionCompleted`

会话结束后的最终消息。

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `SessionCompleted` |
| `segment_count` | int | 片段总数 |
| `finalized_segment_count` | int | 最终完成处理的片段数 |
| `audio_duration_ms` | int | 总音频时长 |
| `canceled` | bool | 是否由 `CancelSession` 触发 |

示例：

```json
{
  "type": "SessionCompleted",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900010001,
  "segment_count": 8,
  "finalized_segment_count": 8,
  "audio_duration_ms": 136420,
  "canceled": false
}
```

### 7.5 `ErrorResponse`

服务端报错时返回。

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `ErrorResponse` |
| `error_code` | string | 业务错误码 |
| `detail` | string | 错误详情 |
| `segment_id` | string/null | 若错误与片段有关，则返回片段 ID；否则为 `null` |

示例：

```json
{
  "type": "ErrorResponse",
  "code": 3001,
  "message": "recognition failed",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900003888,
  "error_code": "ASR_INFERENCE_ERROR",
  "detail": "recognition service unavailable",
  "segment_id": "seg_000001"
}
```

## 8. 错误码

| 状态码 | error_code | 说明 |
|---|---|---|
| `1001` | `AUDIO_DECODE_ERROR` | 音频块解码失败 |
| `1002` | `UNSUPPORTED_AUDIO_ENCODING` | 输入编码或采样率不支持 |
| `3001` | `ASR_INFERENCE_ERROR` | ASR 推理失败 |
| `3003` | `SPEAKER_REFINE_ERROR` | 说话人回写失败 |
| `4001` | `SESSION_ERROR` | 会话状态错误（如缺失或非法的 `StartSession`） |
| `4002` | `INVALID_CONTROL_COMMAND` | 非法控制指令 |
| `4030` | `LICENSE_UNAUTHORIZED` | 未授权：license 缺失/无效/过期，实时会话被拒绝（握手后立即返回 `ErrorResponse` 并关闭连接） |
| `5000` | `INTERNAL_SERVER_ERROR` | 服务端内部异常 |

## 9. 最小交互示例

新式握手：

```text
client -> server: {"type":"StartSession","audio_encoding":"pcm_s16le","sample_rate":16000}
server -> client: SessionStarted(protocol_version=2)
client -> server: <binary pcm frame> ...
server -> client: TranscriptUpdate(source=streaming, is_final=false)
server -> client: TranscriptUpdate(source=streaming, is_final=true)
server -> client: TranscriptUpdate(source=offline_asr)
server -> client: TranscriptUpdate(source=speaker_refine) 或 TranscriptUpdateBatch(source=speaker_refine)
client -> server: {"type":"FinishSession"}
server -> client: TranscriptUpdate / TranscriptUpdateBatch ...
server -> client: SessionCompleted
```

v1 兼容握手（配置在 URL，控制帧用裸文本）：

```text
client connects: ws://127.0.0.1:18080/api/realtime/ws?enable_speaker=true&sample_rate=16000
server -> client: SessionStarted(protocol_version=1)
client -> server: <binary pcm frame> ...
server -> client: TranscriptUpdate(source=streaming, ...)
server -> client: TranscriptUpdate(source=offline_asr)
server -> client: TranscriptUpdate(source=speaker_refine) 或 TranscriptUpdateBatch(source=speaker_refine)
client -> server: stop
server -> client: SessionCompleted
```
