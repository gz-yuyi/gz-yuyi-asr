# 实时 WebSocket 接口

本文档描述语义科技 ASR 服务的实时语音 WebSocket 协议。

协议采用「单事件 + 修订」模型：服务端把同一片段的所有中间结果（低延迟草稿、离线精修、说话人回写、情绪补充）统一收敛成一条时间线上的 `TranscriptUpdate` 事件，客户端只需按 `segment_id` 保留最大 `revision`。融合工作在服务端完成，客户端保持简单。

## 1. 地址

- 路径：`WS /api/realtime/ws`
- 本地默认地址：`ws://127.0.0.1:18080/api/realtime/ws`

协议支持两种握手方式，服务端按客户端首帧自动判定：新式握手用 `StartSession` 首帧携带配置（推荐）；v1 兼容握手用 URL query 携带配置、连接后直接发音频。详见 §3.1。

## 2. 设计原则

- `Streaming VAD` 是唯一切段来源。
- 一旦片段闭合，`segment_id / start_ms / end_ms` 视为稳定，不再重新切段。
- 实时链路优先返回低延迟文本，随后可对同一 `segment_id` 发更高 `revision` 的修正结果。
- 客户端只保留同一 `segment_id` 的最大 `revision`，服务端负责把多路结果融合到一条时间线。
- 协议只描述角色（草稿 / 离线精修 / 说话人 / 情绪），不暴露具体模型或后端实现。说话人为离线并行、算完回填，不是实时主链路的一部分。
- 服务端同时兼容存量 v1 客户端的握手方式（URL query + 裸控制帧），见 §3.1。两种握手下服务端事件（下行）schema 完全一致，差异只在握手与控制帧形态。

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
| `audio_encoding` | string | 否 | `pcm_s16le` | 实时音频编码；`wav/mp3/aac/m4a/opus` 需服务端启用音频解码 |
| `sample_rate` | int | 否 | `16000` | 采样率；`pcm_s16le` 时必须为 `16000`，压缩格式由解码器统一转到 `16k` |
| `hotword_id` | string/null | 否 | `default` | 热词表 ID |
| `context` | string/null | 否 | 空 | ASR 上下文提示 |
| `language` | string/null | 否 | 未设置 | 输出语种限制（单语种），如 `zh`、`en`、`ja`、`ko`；传入时替换默认中英白名单 |
| `allowed_output_languages` | string/array/null | 否 | `["zh","en"]` | 输出语种白名单（多语种），如 `"zh,en"` 或 `["zh","en"]`；中文方言如 `Cantonese/yue` 归入 `zh` |
| `vad_threshold` | float | 否 | `0.25` | VAD 阈值 |
| `vad_min_silence_duration_ms` | int | 否 | `500` | 闭段最小静音时长 |
| `enable_speaker` | bool | 否 | `true` | 是否启用说话人回写；启用时服务端自动执行注册声纹识别 |
| `speaker_num` | int/null | 否 | 空 | 指定说话人数；为空使用自动估计 |
| `group_ids` | string/array/null | 否 | `default` | 限定本次会话可匹配的声纹组 |
| `speaker_profile_ids` | string/array/null | 否 | 空 | 限定本次会话可匹配的注册人员；为空匹配指定组内全部启用声纹 |
| `number_normalization_mode` | int | 否 | `1` | 数字转换模式：`0/1/3` |
| `filler_filter_mode` | int | 否 | `0` | 语气词过滤模式：`0/1/2` |
| `profanity_filter_mode` | int | 否 | `0` | 脏词过滤模式：`0/1/2` |

注册声纹识别没有独立的客户端启停字段或环境变量：`enable_speaker=true` 时自动启用，`enable_speaker=false` 时随说话人回写一起关闭。旧客户端传入的 `enable_speaker_recognition` 会被忽略。

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

不传输出语种参数时默认允许中文和英语（`zh,en`）；需要其它语种集合时显式传入相应白名单。输出语种白名单分两级生效：先按模型返回的语种标签做段级过滤，再对保留的段做字符级过滤——拉丁字母、数字、标点、符号和空白永远保留，不属于白名单语种文字（如中韩会话中混入的韩语/日语字符）会被剔除；含白名单语种字母表之外变音字母的拉丁词（如中英会话中的土耳其语/越南语词）整词剔除，纯 ASCII 拉丁词无法判定语种故保留；外文字符占比过半或过滤后无有效文字时整段丢弃。段级过滤只在模型明确返回可识别语种时生效；如果模型未返回语种或语种未知，服务端会保留文本，避免误删有效结果。

### 3.4 二进制音频帧

握手完成后（新式握手为 `StartSession` 成功、v1 兼容握手为连接建立），客户端持续发送二进制音频帧。

- `pcm_s16le`
  - 编码：`PCM16LE`
  - 声道：`mono`
  - 采样率：`16000`
  - 每帧字节数必须为偶数
- `wav/mp3/aac/m4a/opus`
  - 需服务端启用音频解码能力
  - 服务端会先解码并重采样为内部 `PCM16LE / mono / 16kHz`
  - 当前要求每个二进制帧本身是可独立解码的音频块

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

服务端停止接收音频，冲刷尾部数据，必要时先补最终离线精修与说话人回写，再发剩余 `TranscriptUpdate`，最后返回 `SessionCompleted` 并关闭连接。

#### `CancelSession`

仅新式握手提供。服务端立即取消会话，不再冲刷尾部、不再补最终精修，直接返回 `SessionCompleted`（`canceled=true`）并关闭连接。

其他文本消息返回 `ErrorResponse`，`error_code=INVALID_CONTROL_COMMAND`。

## 4. 服务端处理流程

1. 接收音频帧并写入会话缓冲。
2. `Streaming VAD` 检测语音并生成稳定片段。
3. 活动段内持续发 `source=streaming` 的低延迟草稿（partial）。
4. 闭段时发 `source=streaming` 的 final。
5. 同一片段可再发 `source=offline_asr` 的更权威文本修正。
6. 说话人侧离线并行计算，算完对相关片段发一个或多个 `source=speaker_refine` 回写。
7. 如启用情绪分析，可对同一 `segment_id` 再发 `source=emotion_refine` 补充。
8. 收到 `FinishSession`（或 v1 `stop`）后在必要时补最终修正，再发 `SessionCompleted`；`CancelSession` 直接结束。

## 5. 客户端状态管理规则

客户端以 `segment_id` 作为主键。对于同一个 `segment_id`：

- 若新消息的 `revision` 小于等于本地版本，丢弃。
- 若新消息的 `segment_deleted=true`，删除/隐藏该 `segment_id`；如果带有 `supersedes_segment_id`，也删除/隐藏被替代的父片段。
- 若 `revision` 更高，则整体替换文本与说话人/情绪状态。

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

核心事件。同一片段可能多次返回。

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

- `source=streaming`：低延迟文本，通常是片段的第一次结果。
- `source=offline_asr`：更权威的文本修正。
- `source=speaker_refine`：离线说话人聚类算完后，对 speaker 或文本做回写修正。
- `source=emotion_refine`：对情绪标签做闭段后补充或修正。
- `is_final=true`：表示片段已闭合，但不表示后续不会再收到更高 `revision`（离线精修、说话人回填仍可能到来）。
- `segment_deleted=true`：该片段最终文本被后处理过滤为空（例如语气词过滤后无有效内容）；客户端若已展示该 `segment_id`，应删除/隐藏；如同时存在 `supersedes_segment_id`，还应删除/隐藏被替代的父片段。

情绪分析接入建议：

- 第一版建议只在片段闭段后执行，不进入实时草稿路径。
- 沿用同一 `segment_id + revision` 覆盖语义。
- 尚无情绪结果时：`emotion=null`、`emotion_score=null`、`emotion_state=pending`；结果稳定后：`emotion_state=stable`。

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

示例 3：说话人回写

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

### 7.3 `SessionCompleted`

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

### 7.4 `ErrorResponse`

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
  "message": "model inference failed",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900003888,
  "error_code": "ASR_INFERENCE_ERROR",
  "detail": "streaming asr worker timeout",
  "segment_id": "seg_000001"
}
```

## 8. 错误码

| 状态码 | error_code | 说明 |
|---|---|---|
| `1001` | `AUDIO_DECODE_ERROR` | 音频块解码失败 |
| `1002` | `UNSUPPORTED_AUDIO_ENCODING` | 输入编码或采样率不支持，或当前构建未启用对应解码能力 |
| `3001` | `ASR_INFERENCE_ERROR` | ASR 推理失败 |
| `3003` | `SPEAKER_REFINE_ERROR` | 说话人回写失败 |
| `4001` | `SESSION_ERROR` | 会话状态错误（如缺失或非法的 `StartSession`） |
| `4002` | `INVALID_CONTROL_COMMAND` | 非法控制指令 |
| `5000` | `INTERNAL_SERVER_ERROR` | 服务端内部异常 |

协议保留、当前可能尚未实际发出的错误码：

| 状态码 | 说明 |
|---|---|
| `2001` | 热词表不存在 |
| `3002` | Offline ASR / 标点修正失败 |
| `3004` | VAD 处理失败 |

## 9. 最小交互示例

新式握手：

```text
client -> server: {"type":"StartSession","audio_encoding":"pcm_s16le","sample_rate":16000}
server -> client: SessionStarted(protocol_version=2)
client -> server: <binary pcm frame> ...
server -> client: TranscriptUpdate(source=streaming, is_final=false)
server -> client: TranscriptUpdate(source=streaming, is_final=true)
server -> client: TranscriptUpdate(source=offline_asr)
server -> client: TranscriptUpdate(source=speaker_refine)
client -> server: {"type":"FinishSession"}
server -> client: TranscriptUpdate ...
server -> client: SessionCompleted
```

v1 兼容握手（配置在 URL，控制帧用裸文本）：

```text
client connects: ws://127.0.0.1:18080/api/realtime/ws?enable_speaker=true&sample_rate=16000
server -> client: SessionStarted(protocol_version=1)
client -> server: <binary pcm frame> ...
server -> client: TranscriptUpdate(source=streaming, ...)
server -> client: TranscriptUpdate(source=offline_asr)
server -> client: TranscriptUpdate(source=speaker_refine)
client -> server: stop
server -> client: SessionCompleted
```
