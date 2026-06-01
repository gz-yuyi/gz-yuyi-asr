# 实时 WebSocket 接口

本文档描述语义科技 ASR 服务的实时语音 WebSocket 协议。

目标有两层：

- 固化项目最初讨论过的协议约束
- 明确当前仓库已经实现到哪一层

如果后续实现变更，请同时更新代码和本文档。

## 1. 地址

- 路径：`WS /api/realtime/ws`
- 本地默认地址：`ws://127.0.0.1:18080/api/realtime/ws`

## 2. 设计原则

- `Streaming VAD` 是唯一切段来源
- 一旦片段闭合，`segment_id / start_ms / end_ms` 视为稳定，不再重新切段
- 实时链路优先返回低延迟文本
- 后续可以对同一 `segment_id` 发更高 `revision` 的修正结果
- 客户端只保留同一 `segment_id` 的最大 `revision`

## 3. 当前实现状态

当前仓库已经实现：

- 二进制音频帧
  - 默认：`PCM s16le / mono / 16kHz`
  - 若构建启用了 `VOICE_SERVICE_ENABLE_FFMPEG=ON`：
    - `wav`
    - `mp3`
    - `aac`
    - `m4a`
    - `opus`
- 文本控制帧
  - `ping`
  - `stop`
- 服务端事件
  - `SessionStarted`
  - `TranscriptUpdate`
  - `SessionCompleted`
  - `ErrorResponse`

当前实现边界：

- `pcm_s16le` 仍然要求 `mono / 16kHz`
- 非 PCM 格式会先走 FFmpeg 解码，再统一转成内部 `PCM16LE / mono / 16kHz`
- `speex` / `silk` 取决于运行环境中的 FFmpeg 解码器与输入封装，当前不作为稳定承诺
- 压缩格式当前按“每个二进制帧是可独立解码的音频块”处理
- 若未配置 `streaming_asr`，实时文本仍退化为“闭段后一次性输出”
- 配置 `streaming_asr` 后，会在活动段内先发 `source=streaming` 的低延迟草稿
- `qwen3-asr` 当前保留为“VAD 闭段 + offline recognizer”的离线精修层
- speaker refine 基于 embedding 与增量/周期聚类
- `hotword_id` 已支持查本地 SQLite 热词库；`A3_vllm` / `A3_llamacpp` 会动态映射到 `prompt`，`asr-offline-a3` 会在启动时加载全局静态热词
- `context` 已支持透传到 `A3_vllm` / `A3_llamacpp`，会映射到 `/v1/audio/transcriptions` 的 `prompt`
- 情绪分析已支持作为闭段后的附加修正能力接入，不进入实时草稿主链路

## 4. Query 参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 | 当前状态 |
|---|---|---:|---|---|---|
| `hotword_id` | string | 否 | `default` | 热词表 ID | 当前会先查本地 SQLite 热词库；`A3_vllm` / `A3_llamacpp` 动态生效，`asr-offline-a3` 启动后静态生效（更新需重启） |
| `context` | string | 否 | 空 | 识别上下文提示 | 当前对 `A3_vllm` / `A3_llamacpp` 生效，会映射为 `prompt` |
| `vad_threshold` | float | 否 | `0.25` | VAD 阈值 | 已实现 |
| `vad_min_silence_duration_ms` | int | 否 | `500` | 闭段最小静音时长 | 已实现 |
| `enable_speaker` | bool | 否 | `true` | 是否启用 speaker refine | 已实现 |
| `speaker_num` | int | 否 | 空 | 指定说话人数 | 已实现 |
| `audio_encoding` | string | 否 | `pcm_s16le` | 实时音频编码 | 已实现；`wav/mp3/aac/m4a/opus` 需 FFmpeg 构建 |
| `sample_rate` | int | 否 | `16000` | 采样率 | `pcm_s16le` 时必须是 `16000`；压缩格式由解码器统一转到 `16k` |
| `number_normalization_mode` | int | 否 | `1` | 数字转换模式：`0/1/3` | 已实现；按会话参数控制 |
| `filler_filter_mode` | int | 否 | `0` | 语气词过滤模式：`0/1/2` | 已实现；按会话参数控制 |
| `profanity_filter_mode` | int | 否 | `0` | 脏词过滤模式：`0/1/2` | 已实现；按会话参数控制 |

示例：

```text
ws://127.0.0.1:18080/api/realtime/ws?enable_speaker=true&vad_threshold=0.25&sample_rate=16000&number_normalization_mode=1
```

## 5. 客户端发送规范

### 5.1 二进制音频帧

客户端持续发送二进制音频数据。

当前要求：

- `pcm_s16le`
  - 编码：`PCM16LE`
  - 声道：`mono`
  - 采样率：`16000`
- `wav/mp3/aac/m4a/opus`
  - 需要 `VOICE_SERVICE_ENABLE_FFMPEG=ON`
  - 服务端会先解码并重采样为内部 `PCM16LE / mono / 16kHz`
  - 当前要求每个二进制帧本身是可独立解码的音频块

如果格式不符合，服务端会返回：

- `ErrorResponse`
- `error_code=UNSUPPORTED_AUDIO_ENCODING`

### 5.2 文本控制帧

支持：

- `ping`
  - 接收后忽略
- `stop`
  - 结束当前会话
  - 冲刷尾部数据
  - 必要时先做最终 speaker refine，再发 `SessionCompleted`

其他文本消息会返回：

- `ErrorResponse`
- `error_code=INVALID_CONTROL_COMMAND`

## 6. 服务端处理流程

1. 接收音频帧并写入会话缓冲
2. `Streaming VAD` 检测语音并生成稳定片段
3. 若配置了 `streaming_asr`，活动段内持续发 `source=streaming` 的 partial
4. 闭段时发 `source=streaming` 的 final
5. 同一片段可再发 `offline_asr` 结果
6. speaker 侧可再发一个或多个 `speaker_refine`
7. 后续如启用情绪分析，可对同一 `segment_id` 再发情绪修正
8. `stop` 后在必要时补最终修正，再发 `SessionCompleted`

## 7. 客户端状态管理规则

客户端应以 `segment_id` 作为主键。

对于同一个 `segment_id`：

- 若新消息的 `revision` 小于等于本地版本，丢弃
- 若新消息的 `segment_deleted=true`，删除/隐藏该 `segment_id`；如果带有 `supersedes_segment_id`，也删除/隐藏被替代的父片段
- 若 `revision` 更高，则整体替换文本和 speaker 状态

推荐最小状态结构：

```json
{
  "segment_id": "seg_000001",
  "revision": 4,
  "text": "广州在全球智慧城市大会获“城市大奖”。",
  "speaker_id": 2,
  "speaker_state": "stable",
  "start_ms": 1200,
  "end_ms": 3860,
  "is_final": true
}
```

## 8. 通用返回字段

所有服务端事件都带这些字段：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 事件类型 |
| `code` | int | 状态码 |
| `message` | string | 状态说明 |
| `session_id` | string | 会话 ID |
| `server_time_ms` | int | 服务端发送时间戳（毫秒） |

## 9. 服务端事件

### 9.1 `SessionStarted`

会话创建成功后返回一次。

字段：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `SessionStarted` |
| `enable_speaker` | bool | 当前会话是否启用 speaker refine |

示例：

```json
{
  "type": "SessionStarted",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900000123,
  "enable_speaker": true
}
```

### 9.2 `TranscriptUpdate`

这是核心事件。同一片段可能多次返回。

字段：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `TranscriptUpdate` |
| `segment_id` | string | 片段 ID |
| `revision` | int | 当前片段的版本号，单调递增 |
| `source` | string | `streaming` / `offline_asr` / `speaker_refine` / `emotion_refine` |
| `is_final` | bool | 当前片段是否已闭段 |
| `text` | string | 最新文本 |
| `segment_deleted` | bool | 是否删除/隐藏该片段；为 `true` 时客户端不应展示 `text` |
| `start_ms` | int | 片段起始时间 |
| `end_ms` | int/null | 片段结束时间；未闭段时可为空 |
| `speaker_id` | int/null | 当前会话内的展示 speaker 编号 |
| `speaker_state` | string | `pending` / `provisional` / `stable` |
| `emotion` | string/null | 情绪标签；建议值：`neutral / happy / sad / angry` |
| `emotion_score` | number/null | 情绪置信度，范围建议 `0.0 - 1.0` |
| `emotion_state` | string/null | `pending` / `stable` |
| `replace_all_text` | bool | 客户端应按整段替换处理 |

语义说明：

- `source=streaming`
  - 低延迟文本
  - 通常是片段的第一次结果
- `source=offline_asr`
  - 更权威的文本修正
- `source=speaker_refine`
  - 对 speaker 或文本做回写修正
- `source=emotion_refine`
  - 对情绪标签做闭段后补充或修正
- `is_final=true`
  - 表示片段已闭合
  - 不表示后续不会再收到更高 `revision`
- `segment_deleted=true`
  - 表示该片段最终文本被后处理过滤为空，例如语气词过滤后无有效内容
  - 如果客户端此前已展示该 `segment_id`，应删除/隐藏它
  - 如果同时存在 `supersedes_segment_id`，应删除/隐藏被替代的父片段

情绪分析接入建议：

- 第一版建议只在片段闭段后执行，不进入实时草稿路径
- 推荐沿用同一 `segment_id + revision` 覆盖语义
- 若当前片段尚未得到情绪结果：
  - `emotion=null`
  - `emotion_score=null`
  - `emotion_state=pending`
- 若情绪结果已稳定：
  - `emotion_state=stable`

示例 1：流式结果

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
  "start_ms": 1200,
  "end_ms": 3860,
  "speaker_id": null,
  "speaker_state": "pending",
  "emotion": null,
  "emotion_score": null,
  "emotion_state": "pending",
  "replace_all_text": true
}
```

示例 3：情绪分析补充

```json
{
  "type": "TranscriptUpdate",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900005633,
  "segment_id": "seg_000001",
  "revision": 4,
  "source": "emotion_refine",
  "is_final": true,
  "text": "广州在全球智慧城市大会获“城市大奖”。",
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

示例 4：speaker refine 回写

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

示例 5：最终修正为空，删除已展示片段

```json
{
  "type": "TranscriptUpdate",
  "code": 0,
  "message": "success",
  "session_id": "sess_8db8f0",
  "server_time_ms": 1762900006123,
  "segment_id": "seg_000002",
  "parent_segment_id": "seg_000001",
  "supersedes_segment_id": "seg_000001",
  "revision": 1,
  "source": "speaker_refine",
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

### 9.3 `SessionCompleted`

会话结束后的最终消息。

字段：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `SessionCompleted` |
| `segment_count` | int | 片段总数 |
| `finalized_segment_count` | int | 最终完成处理的片段数 |
| `audio_duration_ms` | int | 总音频时长 |

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
  "audio_duration_ms": 136420
}
```

### 9.4 `ErrorResponse`

服务端报错时返回。

字段：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `ErrorResponse` |
| `error_code` | string | 业务错误码 |
| `detail` | string | 错误详情 |
| `segment_id` | string/null | 若错误与片段有关，则返回片段 ID |

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

## 10. 错误码

当前仓库已经实际使用：

| 状态码 | error_code | 说明 |
|---|---|---|
| `1001` | `AUDIO_DECODE_ERROR` | 音频块解码失败 |
| `1002` | `UNSUPPORTED_AUDIO_ENCODING` | 输入编码不支持，或当前构建未启用对应解码能力 |
| `3001` | `ASR_INFERENCE_ERROR` | ASR 推理失败 |
| `3003` | `SPEAKER_REFINE_ERROR` | speaker refine 失败 |
| `4001` | `SESSION_ERROR` | 会话状态错误 |
| `4002` | `INVALID_CONTROL_COMMAND` | 非法控制指令 |
| `5000` | `INTERNAL_SERVER_ERROR` | 服务端内部异常 |

协议设计里保留过、但当前仓库还没有实际发出的：

| 状态码 | 说明 |
|---|---|
| `1001` | 音频解码失败 |
| `2001` | 热词表不存在 |
| `3002` | Offline ASR / 标点修正失败 |
| `3004` | VAD 处理失败 |

## 11. 示例命令

启动服务：

```bash
./build-bundled/voice_service config/voice-service.sherpa.conf
```

通过 demo client 发送一段 WAV：

```bash
./build-bundled/voice_service_wav_ws_client \
  --wav models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/test_wavs/qiqiu1.wav \
  --url 'ws://127.0.0.1:18080/api/realtime/ws?enable_speaker=true' \
  --chunk-ms 100 \
  --sleep-ms 0
```
