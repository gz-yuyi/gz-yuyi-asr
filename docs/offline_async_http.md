# 🔌 API 接口规范 - 离线录音转写（HTTP 异步任务模式）

基于数据库的异步任务系统，支持**轮询**和**回调**两种模式获取转写结果。

支持的离线音频格式：
- `wav`
- `mp3`
- `aac`
- `m4a`
- `opus`

说明：
- 当构建启用了 `FFmpeg` 时，离线路径会自动解码并重采样到内部统一的 `16kHz / mono / PCM16`
- 未启用 `FFmpeg` 的构建默认仅保证 `wav` 输入

---

## 创建转写任务

### 接口地址
`POST /api/asr/create_task`

### 请求头
| Header | 值 |
| :--- | :--- |
| `Content-Type` | `application/json` |

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `SourceType` | int | 是 | 音频来源类型：`0`=URL，`1`=本地文件路径 |
| `Url` | string | 条件必填 | 音频 URL 地址（`SourceType=0` 时必填） |
| `Extra` | string | 条件必填 | 本地音频文件绝对路径（`SourceType=1` 时必填） |
| `CallbackUrl` | string | 否 | 回调 URL，不填则使用轮询模式 |
| `HotwordId` | string | 否 | 热词表 ID |
| `Context` | string | 否 | 识别上下文提示 |
| `EnableSpeakerRecognition` | bool | 否 | 是否启用已注册声纹识别；不传则使用服务端默认配置 |
| `GroupIds` | array[string] | 否 | 限定本次任务可匹配的声纹组 ID；不传或空数组表示匹配默认组 `default` |
| `SpeakerProfileIds` | array[string] | 否 | 限定本次任务可匹配的全局人员 ID；不传或空数组表示匹配指定组内全部启用声纹 |
| `NumberNormalizationMode` | int | 否 | 数字转换模式：`0/1/3`，默认 `1` |
| `FillerFilterMode` | int | 否 | 语气词过滤模式：`0/1/2`，默认 `0` |
| `ProfanityFilterMode` | int | 否 | 脏词过滤模式：`0/1/2`，默认 `0` |

说明：
- `HotwordId` 当前会先查本地 SQLite 热词库
- 当 `asr.type=A3_vllm` 或 `asr.type=A3_llamacpp` 时，会映射到 `prompt`
- 当 `asr.type=asr-offline-a3` 时，会在服务启动时加载全局静态热词；更新后需重启服务
- `Context` 会和热词提示合并后一起传给 `A3_vllm` / `A3_llamacpp`
- `SpeakerId` 仍表示单个转写任务内的临时说话人编号；启用声纹识别后，会额外返回 `SpeakerProfileId`、`SpeakerName`、`SpeakerMatchScore` 等注册声纹匹配字段
- `SpeakerProfileId` 是全局唯一人员 ID；`GroupIds` 只用于限定匹配范围，不改变人员身份
- 声纹 Profile 注册、管理和匹配策略详见 [声纹注册与识别 API](speaker_profiles_http.md)

### 请求示例（URL 方式）
```json
{
  "SourceType": 0,
  "Url": "https://example.com/audio/test.wav",
  "CallbackUrl": "https://your-server.com/asr/callback",
  "HotwordId": "default",
  "Context": "请优先识别广州、荔湾区、圆中园等词语",
  "EnableSpeakerRecognition": true,
  "GroupIds": ["customer_service"],
  "SpeakerProfileIds": ["spk_zhangsan", "spk_lisi"],
  "NumberNormalizationMode": 1,
  "FillerFilterMode": 0,
  "ProfanityFilterMode": 0
}
```

### 请求示例（本地路径方式）
```json
{
  "SourceType": 1,
  "Extra": "F:\\audio\\recording.wav",
  "CallbackUrl": "https://your-server.com/asr/callback",
  "HotwordId": "default",
  "Context": "请优先识别广州、荔湾区、圆中园等词语",
  "NumberNormalizationMode": 1,
  "FillerFilterMode": 0,
  "ProfanityFilterMode": 0
}
```

### 响应参数
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `Response.RequestId` | string | 请求 ID（时间戳数字字符串） |
| `Response.Data.TaskId` | int | 自增长任务 ID（成功时返回） |
| `Response.Error.Code` | string | 错误码（失败时返回） |
| `Response.Error.Message` | string | 错误说明（失败时返回） |

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "TaskId": 1
    }
  }
}
```

### 失败响应示例（参数错误）
```json
{
  "Response": {
    "RequestId": "...",
    "Error": {
      "Code": "InvalidParameterValue",
      "Message": "本地文件不存在: /path/to/file.wav"
    }
  }
}
```

---

## 查询任务状态

### 接口地址
`GET /api/asr/task_status`

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `TaskId` | int | 是 | 创建任务时返回的任务 ID |

### 响应参数
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `Response.RequestId` | string | 请求 ID（时间戳数字字符串） |
| `Response.Data.TaskId` | int | 自增长任务 ID |
| `Response.Data.Status` | int | 任务状态（0=等待中，1=执行中，2=成功，3=失败） |
| `Response.Data.StatusStr` | string | 状态描述 |
| `Response.Data.CallbackStatus` | string | 回调状态：`not_required / pending / succeeded / failed` |
| `Response.Data.CallbackAttempts` | int | 已执行的回调投递次数 |
| `Response.Data.ProgressPercent` | number | 任务进度百分比，范围 `0.0 - 100.0` |
| `Response.Data.ProgressStage` | string | 当前处理阶段 |
| `Response.Data.ProgressCurrent` | int | 当前阶段已完成数量，ASR 阶段表示已完成片段数 |
| `Response.Data.ProgressTotal` | int | 当前阶段总数量，ASR 阶段表示总片段数 |
| `Response.Data.ProgressMessage` | string | 进度补充信息，异常时可能返回 |
| `Response.Data.ResultDetail` | array | 详细结果（成功时返回） |
| `Response.Data.ResultDetail[].FinalSentence` | string | 单句最终文本（含标点） |
| `Response.Data.ResultDetail[].StartMs` | int | 单句开始时间（毫秒） |
| `Response.Data.ResultDetail[].EndMs` | int | 单句结束时间（毫秒） |
| `Response.Data.ResultDetail[].SpeakerId` | int | 说话人 ID（仅当前任务内有意义） |
| `Response.Data.ResultDetail[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `Response.Data.ResultDetail[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `Response.Data.ResultDetail[].SpeakerMatchScore` | number | 声纹匹配分数，通常为 cosine similarity，范围建议 `0.0 - 1.0` |
| `Response.Data.ResultDetail[].SpeakerMatchStatus` | string | 声纹匹配状态：`matched / unknown / disabled` |
| `Response.Data.ResultDetail[].Emotion` | string | 情绪标签；建议值：`neutral / happy / sad / angry` |
| `Response.Data.ResultDetail[].EmotionScore` | number | 情绪置信度，范围建议 `0.0 - 1.0` |
| `Response.Data.ResultDetail[].Words` | array | 字符级时间戳 |
| `Response.Data.ResultDetail[].Words[].Char` | string | 单个字符 |
| `Response.Data.ResultDetail[].Words[].Time` | number | 字符时间点（秒） |
| `Response.Data.SpeakerProfileMatches` | array | 当前任务内临时说话人与注册声纹的匹配关系 |
| `Response.Data.SpeakerProfileMatches[].SpeakerId` | int | 当前任务内临时说话人 ID |
| `Response.Data.SpeakerProfileMatches[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `Response.Data.SpeakerProfileMatches[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `Response.Data.SpeakerProfileMatches[].SpeakerMatchScore` | number | 当前临时说话人与注册声纹的匹配分数 |
| `Response.Data.SpeakerProfileMatches[].SpeakerMatchStatus` | string | `matched / unknown / disabled` |
| `Response.Data.SpeakerSegments` | array | 按说话人切分后的时间段；启用声纹识别时可附带注册声纹匹配字段 |
| `Response.Data.SpeakerSegments[].StartMs` | int | 说话人片段开始时间（毫秒） |
| `Response.Data.SpeakerSegments[].EndMs` | int | 说话人片段结束时间（毫秒） |
| `Response.Data.SpeakerSegments[].SpeakerId` | int | 当前任务内临时说话人 ID |
| `Response.Data.SpeakerSegments[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `Response.Data.SpeakerSegments[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `Response.Data.SpeakerSegments[].SpeakerMatchScore` | number | 声纹匹配分数 |
| `Response.Data.SpeakerSegments[].SpeakerMatchStatus` | string | `matched / unknown / disabled` |
| `Response.Data.AudioDuration` | number | 音频时长（秒） |
| `Response.Data.ErrorMsg` | string | 错误信息（失败时返回） |
| `Response.Data.CallbackLastError` | string | 最近一次回调错误（有失败投递时返回） |
| `Response.Error.Code` | string | 错误码（失败时返回） |
| `Response.Error.Message` | string | 错误说明（失败时返回） |

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "...",
    "Data": {
      "TaskId": 1,
      "Status": 2,
      "StatusStr": "识别成功",
      "CallbackStatus": "succeeded",
      "CallbackAttempts": 1,
      "ProgressPercent": 100.0,
      "ProgressStage": "succeeded",
      "ProgressCurrent": 24,
      "ProgressTotal": 24,
      "AudioDuration": 600.0,
      "ResultDetail": [
        {
          "FinalSentence": "你好，这是第一段语音。",
          "StartMs": 1000,
          "EndMs": 3500,
          "SpeakerId": 0,
          "SpeakerProfileId": "spk_zhangsan",
          "SpeakerName": "张三",
          "SpeakerMatchScore": 0.86,
          "SpeakerMatchStatus": "matched",
          "Emotion": "neutral",
          "EmotionScore": 0.82,
          "Words": [
            {"Char": "你", "Time": 1.02},
            {"Char": "好", "Time": 1.14},
            {"Char": "，", "Time": 1.26}
          ]
        }
      ],
      "SpeakerProfileMatches": [
        {
          "SpeakerId": 0,
          "SpeakerProfileId": "spk_zhangsan",
          "SpeakerName": "张三",
          "SpeakerMatchScore": 0.86,
          "SpeakerMatchStatus": "matched"
        },
        {
          "SpeakerId": 1,
          "SpeakerMatchScore": 0.61,
          "SpeakerMatchStatus": "unknown"
        }
      ],
      "SpeakerSegments": [
        {
          "StartMs": 1000,
          "EndMs": 3500,
          "SpeakerId": 0,
          "SpeakerProfileId": "spk_zhangsan",
          "SpeakerName": "张三",
          "SpeakerMatchScore": 0.86,
          "SpeakerMatchStatus": "matched"
        }
      ]
    }
  }
}
```

### 失败响应示例（任务不存在）
```json
{
  "Response": {
    "RequestId": "...",
    "Error": {
      "Code": "FailedOperation.NoSuchTask",
      "Message": "任务不存在: 123"
    }
  }
}
```

---

## 回调通知（异步任务完成时）

当任务完成（成功或失败）时，系统会向 `CallbackUrl` 发送 POST 请求。

### 回调请求头
| Header | 值 | 说明 |
| :--- | :--- | :--- |
| `Content-Type` | `application/x-www-form-urlencoded` | 表单编码提交 |

### 回调请求参数（表单字段）
| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `code` | int | 是 | 0=成功，1=失败 |
| `message` | string | 是 | 状态说明（成功通常为 `success`） |
| `requestId` | string | 是 | 请求 ID（创建任务时的链路 ID，纯数字字符串） |
| `taskId` | int | 是 | 任务 ID |
| `resultDetail` | string | 否 | 详细结果 JSON 字符串（成功时返回） |
| `speakerProfileMatches` | string | 否 | 当前任务内临时说话人与注册声纹匹配关系 JSON 字符串（成功且启用声纹识别时返回） |
| `speakerSegments` | string | 否 | 说话人时间段 JSON 字符串（成功且存在说话人分段时返回） |
| `audioTime` | float | 否 | 音频时长（秒，成功时返回） |

### `resultDetail` JSON 结构（字符串内容）
`resultDetail` 字段是一个 JSON 字符串，解析后为数组：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `[].FinalSentence` | string | 单句最终文本（含标点） |
| `[].StartMs` | int | 单句开始时间（毫秒） |
| `[].EndMs` | int | 单句结束时间（毫秒） |
| `[].SpeakerId` | int | 说话人 ID（仅当前任务内有意义） |
| `[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `[].SpeakerMatchScore` | number | 声纹匹配分数 |
| `[].SpeakerMatchStatus` | string | `matched / unknown / disabled` |
| `[].Emotion` | string | 情绪标签；建议值：`neutral / happy / sad / angry` |
| `[].EmotionScore` | number | 情绪置信度，范围建议 `0.0 - 1.0` |
| `[].Words` | array | 字符级时间戳 |
| `[].Words[].Char` | string | 单个字符 |
| `[].Words[].Time` | number | 字符时间点（秒） |

### `speakerProfileMatches` JSON 结构（字符串内容）
`speakerProfileMatches` 字段是一个 JSON 字符串，解析后为数组：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `[].SpeakerId` | int | 当前任务内临时说话人 ID |
| `[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `[].SpeakerMatchScore` | number | 声纹匹配分数 |
| `[].SpeakerMatchStatus` | string | `matched / unknown / disabled` |

### `speakerSegments` JSON 结构（字符串内容）
`speakerSegments` 字段是一个 JSON 字符串，解析后为数组：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `[].StartMs` | int | 说话人片段开始时间（毫秒） |
| `[].EndMs` | int | 说话人片段结束时间（毫秒） |
| `[].SpeakerId` | int | 当前任务内临时说话人 ID |
| `[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `[].SpeakerMatchScore` | number | 声纹匹配分数 |
| `[].SpeakerMatchStatus` | string | `matched / unknown / disabled` |

### 回调示例（成功，解码后可读）
```
code=0
message=success
requestId=17695849897311
taskId=1
resultDetail=[
  {"FinalSentence":"你好，这是第一段语音。","StartMs":1000,"EndMs":3500,"SpeakerId":0,"SpeakerProfileId":"spk_zhangsan","SpeakerName":"张三","SpeakerMatchScore":0.86,"SpeakerMatchStatus":"matched","Emotion":"neutral","EmotionScore":0.82,
   "Words":[{"Char":"你","Time":1.02},{"Char":"好","Time":1.14}]}
]
speakerProfileMatches=[
  {"SpeakerId":0,"SpeakerProfileId":"spk_zhangsan","SpeakerName":"张三","SpeakerMatchScore":0.86,"SpeakerMatchStatus":"matched"}
]
speakerSegments=[
  {"StartMs":1000,"EndMs":3500,"SpeakerId":0,"SpeakerProfileId":"spk_zhangsan","SpeakerName":"张三","SpeakerMatchScore":0.86,"SpeakerMatchStatus":"matched"}
]
audioTime=5.5
```

### 回调示例（成功，URL 编码后的传输形式，换行展示）
```
code=0
&message=success
&requestId=17695849897311
&taskId=1
&resultDetail=%5B%7B%22FinalSentence%22%3A%22%E4%BD%A0%E5%A5%BD%EF%BC%8C%E8%BF%99%E6%98%AF%E7%AC%AC%E4%B8%80%E6%AE%B5%E8%AF%AD%E9%9F%B3%E3%80%82%22%2C%22StartMs%22%3A1000%2C%22EndMs%22%3A3500%2C%22Emotion%22%3A%22neutral%22%2C%22EmotionScore%22%3A0.82%2C%22Words%22%3A%5B%7B%22Char%22%3A%22%E4%BD%A0%22%2C%22Time%22%3A1.02%7D%2C%7B%22Char%22%3A%22%E5%A5%BD%22%2C%22Time%22%3A1.14%7D%5D%7D%5D
&audioTime=5.5
```

### 回调示例（失败）
```
code=1&message=FailedOperation.ErrorRecognize&requestId=17695849897311&taskId=1
```

### 回调重试机制
- 最多重试 **3 次**
- 首次在任务完成后立即投递；若失败，再分别在 **1 分钟** 和 **5 分钟** 后重试
- 响应 HTTP 200 视为成功，否则重试

---

## 注册声纹识别

`POST /api/asr/create_task` 可通过 `EnableSpeakerRecognition`、`GroupIds` 和 `SpeakerProfileIds` 启用或限定注册声纹识别。声纹 Profile 注册、管理、质量要求和匹配策略详见 [声纹注册与识别 API](speaker_profiles_http.md)。

---

## 任务超时

离线任务默认不设置固定总耗时上限，避免几小时音频在正常处理时被固定 10 分钟窗口截断。

相关配置：
- `offline.task_timeout_ms=0`：硬总超时，`0` 表示关闭；设置为正数时，任务总等待时间超过该毫秒数会失败
- `offline.task_idle_timeout_ms=600000`：空闲超时；如果超过该毫秒数没有收到识别事件、完成事件或错误事件，任务会失败

说明：
- `task_status` 会返回百分比进度。任务排队时为 `0`，开始执行后进入准备、VAD、切片、ASR、说话人聚类、结果组装等阶段，成功后为 `100`。
- ASR 阶段按已完成片段数更新，长音频可以通过轮询看到 `ProgressPercent`、`ProgressCurrent` 和 `ProgressTotal` 持续变化。
- 百分比是服务端阶段权重估算，不代表严格的剩余耗时；不同音频的 VAD、ASR、说话人聚类耗时比例会有差异。
- 常见 `ProgressStage`：`queued`、`running`、`preparing_audio`、`detecting_speech`、`segmenting_audio`、`transcribing`、`diarizing_speakers`、`assembling_result`、`succeeded`、`failed`、`canceled`。
- 内部会用转写事件作为活跃信号；只要持续有片段结果或其他服务事件返回，任务不会因为空闲超时失败

---

## 任务保留与清理

离线任务服务会定期清理已结束的 SQLite 任务记录，避免数据库和受管控工作目录持续增长。

默认规则：
- 识别成功且回调成功（或未配置回调）的记录保留 **7 天**
- 识别失败的记录保留 **60 天**
- 识别成功但回调最终失败的记录按异常记录处理，保留 **60 天**

相关配置：
- `offline.success_retention_days=7`
- `offline.failed_retention_days=60`
- `offline.cleanup_interval_ms=86400000`

清理范围：
- 删除 SQLite 中已过期的 `offline_tasks` 记录
- 同步删除服务托管的本地音频文件：
  - `offline.work_dir/task_<task_id>.wav`
  - `offline.work_dir/uploads/*`

说明：
- `callback_status=pending` 的任务不会被清理，直到回调进入成功或失败终态
- 对于通过 `SourceType=1` 传入的任意外部本地路径，服务不会在清理时盲删原文件；只删除 `offline.work_dir/uploads/` 下由服务保存的上传副本

---

## 错误码
| 错误码 | 说明 |
| :--- | :--- |
| `InvalidParameter` | 参数无效 |
| `InvalidParameterValue` | 参数值无效 |
| `MissingParameter` | 缺少必填参数 |
| `FailedOperation.ErrorDownFile` | 音频下载/读取失败 |
| `FailedOperation.ErrorRecognize` | 识别处理失败 |
| `FailedOperation.NoSuchTask` | 任务不存在 |
| `FailedOperation.NoSuchSpeakerProfile` | 声纹 Profile 不存在 |
| `FailedOperation.SpeakerEnrollFailed` | 声纹注册失败 |
| `InternalError.FailAccessDatabase` | 数据库访问失败 |

---

## 实现评估

## 情绪分析补充说明

- 情绪分析已作为**闭段后的附加能力**接入
- 第一版建议只给每个片段补充：
  - `Emotion`
  - `EmotionScore`
- 不建议第一版做实时连续情绪流
- 若情绪分析尚未启用，上述字段可缺省或置空

### 结论
这套异步 HTTP 接口是可行的，而且适合：

- 长音频文件转写
- 批量录音处理
- 不需要持续 WebSocket 连接的后端集成
- 需要轮询或回调获取最终结果的业务系统

如果现在就做，我建议：

1. 先保留这份文档里的“创建任务 / 查状态 / 回调”三段接口。
2. 第一版先实现轮询能力，回调作为可选增强。
3. 内部用独立任务队列，不直接把 HTTP 请求线程绑到模型推理线程上。

### 和现有实时服务的关系
当前项目已经有：

- `VAD`
- `streaming_asr`
- `offline_asr`
- `speaker_refine`
- worker pool

但当前主流程是围绕实时 `Session` 和 WebSocket 组织的。

所以离线异步 HTTP 不建议直接复用整个 `VoiceService` 作为黑盒，而建议复用：

- 模型 engine 层
- `offline_asr` worker pool
- speaker refine 相关逻辑
- 结果结构和 `ResultDetail` 映射逻辑

更准确地说：

- **可直接复用**：引擎配置、模型加载、离线 ASR、speaker refine
- **最好不要直接复用**：WebSocket 会话状态机、实时 streaming draft 流程

原因很简单：

- 离线任务不需要长连接
- 不需要 `streaming partial`
- 不需要实时 revision 回写
- 一次任务通常只关心最终稳定结果

### 推荐实现方式

建议拆成 5 个内部模块：

1. `HTTP API 层`
- 提供：
  - `POST /api/asr/create_task`
  - `GET /api/asr/task_status`
- 只做参数校验、任务入库、返回 `TaskId`

2. `任务存储层`
- 建议最少落库：
  - `task_id`
  - `request_id`
  - `source_type`
  - `source_url / local_path`
  - `callback_url`
  - `status`
  - `error_message`
  - `result_json`
  - `created_at / updated_at`
- 第一版用 SQLite/MySQL/Postgres 都可以
- 如果只是单机验证，SQLite 就够了

3. `下载 / 文件准备层`
- `SourceType=0` 时下载 URL 到本地工作目录
- `SourceType=1` 时校验文件路径存在
- 统一转成服务内部可处理的本地文件路径

4. `离线处理 worker`
- 从任务队列取任务
- 读取音频
- 跑：
  - `VAD`
  - `offline_asr`
  - `speaker_refine`
- 生成：
  - `ResultDetail`
  - `AudioDuration`
- 更新数据库状态

5. `回调派发器`
- 如果有 `CallbackUrl`
- 在任务成功/失败后异步 POST 回调
- 保存回调重试次数和最后一次错误

### 状态机建议

对外状态可以继续保持文档里的 4 个值：

- `0` = 等待中
- `1` = 执行中
- `2` = 成功
- `3` = 失败

但内部最好细一点，便于排障：

- `queued`
- `downloading`
- `preparing`
- `running`
- `callback_pending`
- `succeeded`
- `failed`

对外仍映射回 `0/1/2/3`，内部保留更细的可观测状态。

### 结果组织建议

建议离线 HTTP 最终只返回“稳定稿”，不返回实时草稿。

也就是：

- 不暴露 `streaming partial`
- 不暴露 revision 流
- 直接返回最终 `ResultDetail`

推荐内部处理顺序：

1. 音频准备
2. `VAD` 切段
3. 每段跑 `offline_asr`
4. 每段做 speaker refine / 聚类
5. 汇总成：
  - `ResultDetail[]`

这样和现在的实时链路职责划分也一致：

- WebSocket：实时体验
- HTTP 异步：最终成稿

### 当前代码怎么落地最省事

如果按“最小改动”来做，我建议：

1. 新增 `OfflineTaskService`
- 管任务生命周期
- 不直接依赖 WebSocket sink

2. 新增 `OfflineTaskWorker`
- 复用现有 engine factory
- 但独立跑离线任务

3. 新增 `TaskRepository`
- 负责数据库读写

4. `ws_server` 不动
- HTTP 入口单独加一个 `http_server` 或在现有 server 旁边并行监听

这是因为当前 `Session` 代码已经比较偏实时流程：

- 有 `pending_streaming_jobs_`
- 有 revision 更新
- 有 `streaming_asr_worker_pool`

这些对于离线任务来说都不是最自然的抽象。

### 最小可行版本

如果你想快速落地，我建议第一版只支持：

- `SourceType=0` URL
- `SourceType=1` 本地绝对路径
- 轮询查询结果
- 成功/失败状态
- 最终文本和 `ResultDetail`

第一版可以先不做：

- 回调重试
- 任务取消
- 任务优先级
- 多租户隔离
- 分布式任务调度

### 我建议补的两个接口

如果你准备长期维护这套异步接口，我建议顺手补这两个：

#### 取消任务
`POST /api/asr/cancel_task`

请求体：

```json
{
  "TaskId": 1
}
```

用途：

- 长音频误提交后可取消
- 避免无效任务一直占 worker

#### 查询结果明细
`GET /api/asr/task_result`

请求参数：

- `TaskId`

用途：

- `task_status` 只查状态
- `task_result` 只查结果
- 对大结果集更合理

如果暂时不想拆接口，也可以继续沿用现在 `task_status` 同时带状态和结果。

### 风险点

最需要提前注意的是这 4 个点：

1. 音频下载失败和超时
- URL 模式最常见失败点

2. 大文件占磁盘
- 要有工作目录清理策略

3. 长任务阻塞
- 必须用后台队列，不能同步处理

4. 结果一致性
- 建议数据库更新和回调状态分开记录
- 不要让“回调失败”覆盖“识别成功”

### 推荐优先级

如果现在开始做，我建议顺序是：

1. 先实现任务入库和轮询查询
2. 再实现后台 worker 跑离线识别
3. 再接回调
4. 最后再补取消任务和更细的任务状态

---

## 推荐结论

这套离线异步 HTTP 接口值得做，而且和当前项目的定位不冲突：

- WebSocket 继续负责低延迟实时体验
- HTTP 异步任务负责长音频和最终成稿

工程上最合理的做法不是把现有实时 `Session` 直接硬套过来，而是：

- 复用模型和结果结构
- 新建独立的任务服务和后台 worker

如果你要继续，我下一步建议直接把这份文档再往前推进成“可实施版本”，也就是补上：

- 数据库表结构
- 任务状态流转图
- worker 执行伪代码
