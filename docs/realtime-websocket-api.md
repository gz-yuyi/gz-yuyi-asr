# 实时 WebSocket 接口

本文档描述语义科技 ASR 服务的实时语音 WebSocket 协议。

## 1. 地址

- 路径：`WS /api/realtime/ws`
- 本地默认地址：`ws://127.0.0.1:18080/api/realtime/ws`

实时接口不再使用 URL query 参数。客户端连接成功后，第一条消息必须是 JSON 文本帧 `StartSession`。

## 2. 链路模型

实时链路由三段组成：

1. 草稿 ASR：API 侧小型 CTC 流式模型生成 `DraftTranscript`。
2. 在线说话人跟踪：diart 风格 tracker 根据 speaker segmentation 和 speaker embedding 生成稳定 `SpeakerTurnUpdate`。
3. 最终 ASR：稳定窗口送入 vLLM 离线 ASR 接口，返回 `FinalTranscript`。

实时链路不再使用 VAD 闭段，也不再调用 vLLM `/v1/realtime`。

## 3. 客户端消息

### 3.1 `StartSession`

第一条文本帧必须是：

```json
{
  "type": "StartSession",
  "audio_encoding": "pcm_s16le",
  "sample_rate": 16000,
  "hotword_id": "default",
  "context": "",
  "speaker_enabled": true,
  "speaker_max_speakers": null,
  "enable_speaker_recognition": false,
  "group_ids": [],
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
| `audio_encoding` | string | 否 | `pcm_s16le` | 当前只支持 `pcm_s16le` |
| `sample_rate` | int | 否 | `16000` | 当前只支持 `16000` |
| `hotword_id` | string/null | 否 | `default` | 热词表 ID |
| `context` | string/null | 否 | 空 | ASR 上下文提示 |
| `speaker_enabled` | bool | 否 | `true` | 是否输出在线说话人 turn |
| `speaker_max_speakers` | int/null | 否 | 空 | 单会话最大在线 speaker 数；为空使用服务端配置 |
| `enable_speaker_recognition` | bool | 否 | `false` | 预留字段；当前实时链路不执行注册声纹匹配 |
| `group_ids` | string[] | 否 | `[]` | 预留字段；当前实时链路不执行注册声纹匹配 |
| `speaker_profile_ids` | string[] | 否 | `[]` | 预留字段；当前实时链路不执行注册声纹匹配 |
| `number_normalization_mode` | int | 否 | `1` | 数字转换模式 |
| `filler_filter_mode` | int | 否 | `0` | 语气词过滤模式 |
| `profanity_filter_mode` | int | 否 | `0` | 脏词过滤模式 |

### 3.2 二进制音频帧

`StartSession` 成功后，客户端持续发送二进制 PCM 音频帧。

当前要求：

- 编码：`PCM16LE`
- 声道：`mono`
- 采样率：`16000`
- 每帧字节数必须为偶数

服务端不会解码压缩音频。`wav/mp3/aac/m4a/opus/speex/silk` 等格式不属于当前实时协议。

### 3.3 控制消息

控制消息均为 JSON 文本帧。

#### `Ping`

```json
{"type": "Ping"}
```

服务端返回 `Pong`。

#### `FinishSession`

```json
{"type": "FinishSession"}
```

服务端停止接收音频，冲刷剩余窗口，返回剩余 `FinalTranscript`，最后返回 `SessionCompleted` 并关闭连接。

#### `CancelSession`

```json
{"type": "CancelSession"}
```

服务端取消会话，不再冲刷最终 ASR，返回 `SessionCompleted` 并关闭连接。

## 4. 服务端事件

所有非错误事件都包含：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 事件类型 |
| `session_id` | string | 会话 ID |
| `server_time_ms` | int | 服务端发送时间戳，毫秒 |

### 4.1 `SessionStarted`

```json
{
  "type": "SessionStarted",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900000123,
  "protocol_version": 2,
  "audio_encoding": "pcm_s16le",
  "sample_rate": 16000,
  "speaker_enabled": true,
  "requested_speaker_enabled": true,
  "speaker_recognition_enabled": false,
  "draft_backend": "sherpa_onnx_ctc",
  "diart_enabled": true
}
```

`speaker_enabled` 表示服务端实际启用在线说话人跟踪；`requested_speaker_enabled` 表示客户端请求值。若客户端请求 `speaker_enabled=true`，但服务端缺少 diart segmentation 或 embedding 运行时，会返回 `SESSION_CONFIGURATION_ERROR` 并关闭连接，不会静默降级为无说话人模式。

### 4.2 `DraftTranscript`

草稿文本可能被后续草稿覆盖。客户端应以 `draft_id + revision` 保留最新版本。

```json
{
  "type": "DraftTranscript",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900001123,
  "draft_id": "draft_000001",
  "revision": 3,
  "text": "广州在全球智慧城市大会",
  "start_ms": 0,
  "end_ms": 2600,
  "stability": "volatile"
}
```

### 4.3 `SpeakerTurnUpdate`

稳定 speaker turn 事件。服务端只在 turn 越过稳定水位后发送。

```json
{
  "type": "SpeakerTurnUpdate",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900002123,
  "turn_id": "turn_000001",
  "speaker_id": 0,
  "start_ms": 1200,
  "end_ms": 3860,
  "speaker_state": "stable"
}
```

### 4.4 `FinalTranscript`

最终文本事件。客户端应以 `segment_id + revision` 保留最新版本。

```json
{
  "type": "FinalTranscript",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900004188,
  "segment_id": "seg_000001",
  "revision": 1,
  "text": "广州在全球智慧城市大会获城市大奖。",
  "start_ms": 1000,
  "end_ms": 4100,
  "speaker_id": 0,
  "speaker_state": "stable",
  "words": [],
  "language": "zh"
}
```

若 `speaker_enabled=false` 或服务端未启用 diart，`speaker_id` 为 `null`，`speaker_state` 为 `disabled` 或 `unknown`。

### 4.5 `Pong`

```json
{
  "type": "Pong",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900005123
}
```

### 4.6 `SessionCompleted`

```json
{
  "type": "SessionCompleted",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900010001,
  "segment_count": 8,
  "audio_duration_ms": 136420,
  "canceled": false
}
```

`CancelSession` 场景下 `canceled=true`。

### 4.7 `ErrorResponse`

错误事件包含：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `ErrorResponse` |
| `session_id` | string/null | 会话 ID；如果尚未创建会话则为 `null` |
| `server_time_ms` | int | 服务端发送时间戳，毫秒 |
| `code` | int | 状态码 |
| `message` | string | 状态说明 |
| `error_code` | string | 业务错误码 |
| `detail` | string | 错误详情 |

示例：

```json
{
  "type": "ErrorResponse",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900003888,
  "code": 4004,
  "message": "audio frame too large",
  "error_code": "AUDIO_FRAME_TOO_LARGE",
  "detail": "single realtime audio frame exceeds server limit"
}
```

## 5. 错误码

| 状态码 | error_code | 说明 |
|---|---|---|
| `1001` | `AUDIO_DECODE_ERROR` | PCM 帧格式错误 |
| `1002` | `UNSUPPORTED_AUDIO_ENCODING` | 输入编码或采样率不支持 |
| `4002` | `INVALID_CONTROL_COMMAND` | 非法控制消息 |
| `4003` | `SESSION_LIMIT_EXCEEDED` | 会话数、会话时长或缓冲区超过服务端限制 |
| `4004` | `AUDIO_FRAME_TOO_LARGE` | 单个音频帧超过服务端限制 |
| `4005` | `SESSION_TIMEOUT` | 会话空闲超时 |
| `5000` | `INTERNAL_SERVER_ERROR` | 服务端内部异常 |
| `5000` | `FINAL_ASR_ERROR` | 最终 ASR 处理失败 |

## 6. 客户端状态建议

客户端建议维护三类状态，并在同一条时间线中合并展示：

- 草稿区：按 `draft_id` 保存最大 `revision` 的 `DraftTranscript`。
- 说话人 turn 区：按 `turn_id` 保存最新 `SpeakerTurnUpdate`，在对应最终文本返回前作为“待精修”片段展示。
- 最终区：按 `segment_id` 保存最大 `revision` 的 `FinalTranscript`。

收到 `FinalTranscript` 后，客户端应优先展示最终文本，并隐藏或弱化同一时间范围内已被覆盖的 speaker turn。草稿文本只建议展示最新一条，用于表达当前仍在流动的识别结果，不建议和最终文本做两个割裂区域。

## 7. 最小交互示例

```text
client -> server: {"type":"StartSession","audio_encoding":"pcm_s16le","sample_rate":16000}
server -> client: SessionStarted
client -> server: <binary pcm frame>
server -> client: DraftTranscript
server -> client: SpeakerTurnUpdate
client -> server: {"type":"FinishSession"}
server -> client: FinalTranscript
server -> client: SessionCompleted
```
