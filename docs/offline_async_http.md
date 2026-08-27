# 🔌 API 接口规范 - 离线录音转写（HTTP 异步任务模式）

离线转写使用异步任务模式，支持通过**轮询**和**回调**两种方式获取结果。

支持的离线音频格式：
- `wav`
- `mp3`
- `aac`
- `m4a`
- `opus`

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
| `AllowedOutputLanguages` | string/array[string] | 否 | 输出语种白名单，默认 `["zh","en"]`；可传 `"zh"` 或 `["ja","ko"]`，也兼容单语种字段 `Language` |
| `Align` | bool | 否 | 是否启用字词时间戳对齐，默认 `true` |
| `GroupIds` | array[string] | 否 | 限定本次任务可匹配的声纹组 ID；不传或空数组表示匹配默认组 `default` |
| `SpeakerProfileIds` | array[string] | 否 | 限定本次任务可匹配的全局人员 ID；不传或空数组表示匹配指定组内全部启用声纹 |
| `EnableSpeakerOverlap` | bool | 否 | 是否启用离线重叠说话检测与修正；不传则使用服务端默认配置。启用后 `SpeakerSegments` 可能出现时间重叠 |
| `SpeakerNum` | int | 否 | 本次任务已知说话人数；传入后聚类按该人数约束 |
| `SpeakerClusterType` | string | 否 | 本次任务说话人聚类类型：`spectral`、`AHC`、`umap_hdbscan` |
| `SpeakerClusterMergeCosineThreshold` | number | 否 | 本次任务相似说话人簇合并阈值，范围 `(0, 1]` |
| `SpeakerClusterPValue` | number | 否 | 本次任务 spectral clustering 的 p-pruning 参数，范围 `(0, 1)` |
| `SpeakerClusterMinNumSpeakers` | int | 否 | 本次任务自动估计说话人数下限 |
| `SpeakerClusterMaxNumSpeakers` | int | 否 | 本次任务自动估计说话人数上限 |
| `SpeakerClusterMinClusterSize` | int | 否 | 本次任务小簇重分配前的最小簇大小 |
| `AsrSegmentationMode` | string | 否 | ASR 切段模式：`speaker_turn`=按说话人 turn 切段；`vad_word_align`=按 VAD/长窗转写后用字词时间戳对齐说话人 |
| `NumberNormalizationMode` | int | 否 | 数字转换模式：`0`=不转换，`1`=智能转换（默认），`3`=数学与数字串增强转换；详见[文本后处理模式](text-postprocessing.md#数字转换模式) |
| `FillerFilterMode` | int | 否 | 语气词过滤模式：`0`=不处理（默认），`1`=基础语气词过滤，`2`=扩展填充词过滤；详见[文本后处理模式](text-postprocessing.md#语气词过滤模式) |
| `ProfanityFilterMode` | int | 否 | 脏词过滤模式：`0`=不处理（默认），`1`=删除，`2`=替换为 `*`；详见[文本后处理模式](text-postprocessing.md#脏词过滤模式) |

说明：
- 热词表创建、查询和删除详见 [热词管理 API](hotwords_http.md)。
- `SpeakerId` 表示单个任务内的临时说话人编号；注册声纹命中结果通过 `SpeakerProfileId`、`SpeakerName` 和 `SpeakerMatchStatus` 等字段返回。
- `SpeakerProfileId` 是全局唯一人员 ID；`GroupIds` 只限定候选范围，不改变人员身份。声纹管理详见 [声纹注册与识别 API](speaker_profiles_http.md)。
- 不传 `AllowedOutputLanguages` 时默认允许中文和英语；需要其它语种集合时应显式传入白名单。
- 授权无效时返回 `FailedOperation.LicenseUnauthorized`，且不会创建任务。

### 请求示例（URL 方式）
```json
{
  "SourceType": 0,
  "Url": "https://example.com/audio/test.wav",
  "CallbackUrl": "https://your-server.com/asr/callback",
  "HotwordId": "default",
  "Context": "请优先识别广州、荔湾区、圆中园等词语",
  "AllowedOutputLanguages": ["zh", "en"],
  "GroupIds": ["customer_service"],
  "SpeakerProfileIds": ["spk_zhangsan", "spk_lisi"],
  "EnableSpeakerOverlap": true,
  "SpeakerNum": 2,
  "SpeakerClusterType": "spectral",
  "AsrSegmentationMode": "vad_word_align",
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
  "AllowedOutputLanguages": ["zh", "en"],
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

### 失败响应示例（授权失效）
```json
{
  "Response": {
    "RequestId": "...",
    "Error": {
      "Code": "FailedOperation.LicenseUnauthorized",
      "Message": "license expired; refusing new offline tasks"
    }
  }
}
```

---

## 上传音频创建转写任务

### 接口地址
`POST /api/asr/create_task_upload`

该接口用于直接上传音频文件并创建离线转写任务，请求体为原始二进制音频内容。

授权未加载、已过期或无有效路数时，该接口会在读取请求体前返回 `FailedOperation.LicenseUnauthorized`，不会保存上传文件或创建排队任务。

### 请求头
| Header | 值 |
| :--- | :--- |
| `Content-Type` | 音频 MIME 类型；未知时可使用 `application/octet-stream` |

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `filename` | string | 否 | 上传文件名，默认 `upload.wav` |
| `callback_url` | string | 否 | 回调 URL，不填则使用轮询模式 |
| `hotword_id` | string | 否 | 热词表 ID |
| `context` | string | 否 | 识别上下文提示 |
| `allowed_output_languages` | string | 否 | 输出语种白名单，默认 `zh,en`；多个值用逗号分隔，如 `ja,ko`，也兼容 `language` |
| `Align` / `align` | bool | 否 | 是否启用字词时间戳对齐，默认 `true` |
| `GroupIds` / `group_ids` | string | 否 | 限定本次任务可匹配的声纹组 ID，多个值使用逗号分隔 |
| `SpeakerProfileIds` / `speaker_profile_ids` | string | 否 | 限定本次任务可匹配的全局人员 ID，多个值使用逗号分隔 |
| `EnableSpeakerOverlap` | bool | 否 | 是否启用离线重叠说话检测与修正 |
| `SpeakerNum` | int | 否 | 本次任务已知说话人数 |
| `SpeakerClusterType` | string | 否 | 本次任务说话人聚类类型：`spectral`、`AHC`、`umap_hdbscan` |
| `SpeakerClusterMergeCosineThreshold` | number | 否 | 本次任务相似说话人簇合并阈值，范围 `(0, 1]` |
| `SpeakerClusterPValue` | number | 否 | 本次任务 spectral clustering 的 p-pruning 参数，范围 `(0, 1)` |
| `SpeakerClusterMinNumSpeakers` | int | 否 | 本次任务自动估计说话人数下限 |
| `SpeakerClusterMaxNumSpeakers` | int | 否 | 本次任务自动估计说话人数上限 |
| `SpeakerClusterMinClusterSize` | int | 否 | 本次任务小簇重分配前的最小簇大小 |
| `AsrSegmentationMode` | string | 否 | ASR 切段模式：`speaker_turn` 或 `vad_word_align` |
| `number_normalization_mode` | int | 否 | 数字转换模式：`0`=不转换，`1`=智能转换（默认），`3`=数学与数字串增强转换；详见[文本后处理模式](text-postprocessing.md#数字转换模式) |
| `filler_filter_mode` | int | 否 | 语气词过滤模式：`0`=不处理（默认），`1`=基础语气词过滤，`2`=扩展填充词过滤；详见[文本后处理模式](text-postprocessing.md#语气词过滤模式) |
| `profanity_filter_mode` | int | 否 | 脏词过滤模式：`0`=不处理（默认），`1`=删除，`2`=替换为 `*`；详见[文本后处理模式](text-postprocessing.md#脏词过滤模式) |

### 请求体
音频文件二进制内容。

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "TaskId": 1,
      "Bytes": 1048576
    }
  }
}
```

### 失败响应示例（空文件）
```json
{
  "Response": {
    "RequestId": "...",
    "Error": {
      "Code": "MissingParameter",
      "Message": "empty upload body"
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
| `Response.Data.Status` | int | 任务状态（0=等待中，1=执行中，2=成功，3=失败或取消） |
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
| `Response.Data.ResultDetail[].HasOverlap` | bool | 该句时间范围内是否存在至少两位不同说话人同时活动 |
| `Response.Data.ResultDetail[].OverlapDurationMs` | int | 该句时间范围内多人同时说话的实际累计时长（毫秒） |
| `Response.Data.ResultDetail[].OverlapSegments` | array | 该句内的精确重叠片段；每段均已裁剪到当前句子的时间范围，无重叠时为空数组 |
| `Response.Data.ResultDetail[].OverlapSegments[].StartMs` | int | 重叠片段开始时间（原音频绝对时间，毫秒） |
| `Response.Data.ResultDetail[].OverlapSegments[].EndMs` | int | 重叠片段结束时间（原音频绝对时间，毫秒） |
| `Response.Data.ResultDetail[].OverlapSegments[].SpeakerIds` | int[] | 该片段内同时活动的任务内临时说话人 ID，至少包含两项 |
| `Response.Data.ResultDetail[].SpeakerId` | int | 说话人 ID（仅当前任务内有意义） |
| `Response.Data.ResultDetail[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `Response.Data.ResultDetail[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `Response.Data.ResultDetail[].SpeakerMatchScore` | number | 声纹匹配分数，通常为 cosine similarity，范围建议 `0.0 - 1.0` |
| `Response.Data.ResultDetail[].SpeakerMatchStatus` | string | 声纹匹配状态：`matched / unknown` |
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
| `Response.Data.SpeakerProfileMatches[].SpeakerMatchStatus` | string | `matched / unknown` |
| `Response.Data.SpeakerSegments` | array | 按说话人切分后的时间段；启用声纹识别时可附带注册声纹匹配字段；启用 `EnableSpeakerOverlap` 时不同说话人的时间段可能重叠 |
| `Response.Data.SpeakerSegments[].StartMs` | int | 说话人片段开始时间（毫秒） |
| `Response.Data.SpeakerSegments[].EndMs` | int | 说话人片段结束时间（毫秒） |
| `Response.Data.SpeakerSegments[].SpeakerId` | int | 当前任务内临时说话人 ID |
| `Response.Data.SpeakerSegments[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `Response.Data.SpeakerSegments[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `Response.Data.SpeakerSegments[].SpeakerMatchScore` | number | 声纹匹配分数 |
| `Response.Data.SpeakerSegments[].SpeakerMatchStatus` | string | `matched / unknown` |
| `Response.Data.OverlapPreviewRegions` | array | 可按需生成试听音轨的双人重叠区间；离线任务只记录元数据，不执行语音分离、不保存分离音频 |
| `Response.Data.OverlapPreviewRegions[].RegionId` | string | 当前任务内稳定的重叠预览区间 ID |
| `Response.Data.OverlapPreviewRegions[].StartMs` | int | 原音频中重叠区间开始时间（毫秒） |
| `Response.Data.OverlapPreviewRegions[].EndMs` | int | 原音频中重叠区间结束时间（毫秒） |
| `Response.Data.OverlapPreviewRegions[].OverlapDurationMs` | int | 区间内实际检测到恰好两位说话人同时活动的累计时长（毫秒） |
| `Response.Data.OverlapPreviewRegions[].SpeakerIds` | int[] | 候选任务内临时说话人 ID；预览音轨顺序不保证与该数组顺序对应 |
| `Response.Data.AudioDuration` | number | 音频时长（秒） |
| `Response.Data.ErrorMsg` | string | 错误信息（失败时返回） |
| `Response.Data.CallbackLastError` | string | 最近一次回调错误（有失败投递时返回） |
| `Response.Error.Code` | string | 错误码（失败时返回） |
| `Response.Error.Message` | string | 错误说明（失败时返回） |

`OverlapSegments` 已按当前句子的 `StartMs` / `EndMs` 裁剪，业务侧可以直接使用。顶层 `OverlapPreviewRegions` 用于调用重叠区间分离试听接口，普通业务可以忽略。

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
          "HasOverlap": true,
          "OverlapDurationMs": 680,
          "OverlapSegments": [
            {"StartMs": 1820, "EndMs": 2500, "SpeakerIds": [0, 1]}
          ],
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
        },
        {
          "StartMs": 1820,
          "EndMs": 2500,
          "SpeakerId": 1,
          "SpeakerMatchScore": 0.61,
          "SpeakerMatchStatus": "unknown"
        }
      ],
      "OverlapPreviewRegions": [
        {
          "RegionId": "overlap_0000",
          "StartMs": 1800,
          "EndMs": 2520,
          "OverlapDurationMs": 680,
          "SpeakerIds": [0, 1]
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

## 查询任务结果

### 接口地址
`GET /api/asr/task_result`

该接口用于获取任务状态和结果明细。返回结构与 `task_status` 一致，适合在任务完成后单独拉取结果。

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `TaskId` | int | 是 | 创建任务时返回的任务 ID |

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "...",
    "Data": {
      "TaskId": 1,
      "Status": 2,
      "StatusStr": "succeeded",
      "ProgressPercent": 100.0,
      "ResultDetail": [
        {
          "FinalSentence": "你好，这是第一段语音。",
          "StartMs": 1000,
          "EndMs": 3500,
          "HasOverlap": true,
          "OverlapDurationMs": 680,
          "OverlapSegments": [
            {"StartMs": 1820, "EndMs": 2500, "SpeakerIds": [0, 1]}
          ],
          "SpeakerId": 0
        }
      ]
    }
  }
}
```

---

## 取消任务

### 接口地址
`POST /api/asr/cancel_task`

该接口用于请求取消尚未完成的离线任务。已完成任务不会回退结果。

### 请求头
| Header | 值 |
| :--- | :--- |
| `Content-Type` | `application/json` |

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `TaskId` | int | 是 | 创建任务时返回的任务 ID |

### 请求示例
```json
{
  "TaskId": 1
}
```

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "TaskId": 1,
      "Status": 3,
      "StatusStr": "canceled",
      "CallbackStatus": "not_required",
      "CallbackAttempts": 0,
      "ProgressPercent": 0.0,
      "ProgressStage": "canceled",
      "ProgressCurrent": 0,
      "ProgressTotal": 0
    }
  }
}
```

---

## 查询任务列表

### 接口地址
`GET /api/asr/task_list`

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Status` | string | 否 | 状态过滤，默认 `succeeded`；支持 `queued / running / callback_pending / succeeded / failed / canceled / all` |
| `Limit` | int | 否 | 返回数量，默认 `50`，最大 `200` |
| `Offset` | int | 否 | 偏移量，默认 `0` |

### 响应参数
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `Response.Data.Items` | array | 任务列表 |
| `Response.Data.Total` | int | 符合过滤条件的任务总数 |
| `Response.Data.Limit` | int | 本次请求的返回数量 |
| `Response.Data.Offset` | int | 本次请求的偏移量 |
| `Response.Data.Items[].TaskId` | int | 任务 ID |
| `Response.Data.Items[].Status` | int | 任务状态（0=等待中，1=执行中，2=成功，3=失败或取消） |
| `Response.Data.Items[].StatusStr` | string | 状态描述 |
| `Response.Data.Items[].SourceType` | int | 音频来源类型 |
| `Response.Data.Items[].SourceUrl` | string | URL 来源地址 |
| `Response.Data.Items[].HotwordId` | string | 热词表 ID |
| `Response.Data.Items[].Context` | string | 识别上下文提示 |
| `Response.Data.Items[].AudioDuration` | number | 音频时长（秒） |
| `Response.Data.Items[].ResultSegmentCount` | int | 结果片段数量 |
| `Response.Data.Items[].Preview` | string | 首个非空结果片段预览 |
| `Response.Data.Items[].HasResult` | bool | 是否已有结果 |
| `Response.Data.Items[].HasAudio` | bool | 是否可通过 `task_audio` 获取音频 |
| `Response.Data.Items[].CallbackStatus` | string | 回调状态 |
| `Response.Data.Items[].CallbackAttempts` | int | 回调尝试次数 |
| `Response.Data.Items[].ProgressPercent` | number | 任务进度百分比 |
| `Response.Data.Items[].ProgressStage` | string | 当前处理阶段 |
| `Response.Data.Items[].CreatedAt` | string | 创建时间 |
| `Response.Data.Items[].UpdatedAt` | string | 更新时间 |
| `Response.Data.Items[].StartedAt` | string | 开始处理时间 |
| `Response.Data.Items[].FinishedAt` | string | 完成时间 |

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "Items": [
        {
          "TaskId": 1,
          "Status": 2,
          "StatusStr": "succeeded",
          "SourceType": 0,
          "SourceUrl": "https://example.com/audio/test.wav",
          "HotwordId": "default",
          "Context": "请优先识别广州",
          "AudioDuration": 600.0,
          "ResultSegmentCount": 24,
          "Preview": "你好，这是第一段语音。",
          "HasResult": true,
          "HasAudio": true,
          "CallbackStatus": "not_required",
          "CallbackAttempts": 0,
          "ProgressPercent": 100.0,
          "ProgressStage": "succeeded",
          "CreatedAt": "2026-06-05T10:00:00",
          "UpdatedAt": "2026-06-05T10:03:00",
          "StartedAt": "2026-06-05T10:00:10",
          "FinishedAt": "2026-06-05T10:03:00"
        }
      ],
      "Total": 1,
      "Limit": 50,
      "Offset": 0
    }
  }
}
```

---

## 获取任务音频

### 接口地址
`GET /api/asr/task_audio`

该接口用于获取任务关联音频，客户端应同时支持直接音频响应和 HTTP 重定向。

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `TaskId` | int | 是 | 创建任务时返回的任务 ID |

### 成功响应

返回音频二进制内容，或返回 `3xx` 重定向；客户端应跟随重定向获取音频。

### 失败响应示例（音频不存在）
```json
{
  "Response": {
    "RequestId": "...",
    "Error": {
      "Code": "FailedOperation.ArtifactNotFound",
      "Message": "audio not found for task: 1"
    }
  }
}
```

---

## 按需生成重叠区间分离试听

### 接口地址
`POST /api/asr/overlap_separation_preview`

该接口只接受任务结果 `OverlapPreviewRegions` 中已经登记的区间，按请求生成试听音频，且不会修改任务结果。

### 请求参数（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `TaskId` | int | 是 | 创建任务时返回的任务 ID |
| `RegionId` | string | 是 | `OverlapPreviewRegions[].RegionId` |

```json
{
  "TaskId": 12,
  "RegionId": "overlap_0000"
}
```

### 成功响应

返回 `audio/wav` 双声道 PCM16 音频。左、右声道是两条无序输出音轨，只覆盖 `StartMs` 到 `EndMs` 的核心重叠区间，不保证与 `SpeakerIds` 一一对应。

响应头：

| 响应头 | 说明 |
| :--- | :--- |
| `X-Yuyi-Region-Id` | 本次处理的区间 ID |
| `X-Yuyi-Track-Correlation` | 两条输出音轨的相关度 |
| `X-Yuyi-Quality-Warning` | 可选质量提示；两条音轨高度相似时返回 `tracks_are_highly_correlated` |

### 失败响应

任务不存在时返回 `FailedOperation.NoSuchTask`；区间 ID 不属于该任务时返回 `InvalidParameterValue`；任务音频不可用时返回 `FailedOperation.ArtifactNotFound`；生成试听失败时返回 `FailedOperation.OverlapSeparationPreviewFailed`。

---

## 下载任务结果

### 接口地址
`GET /api/asr/task_result_download`

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `TaskId` | int | 是 | 创建任务时返回的任务 ID |
| `Format` | string | 否 | 下载格式，支持 `json / txt / rttm`，默认 `json` |

### 成功响应
- `Format=json`：返回 `application/json; charset=utf-8`，内容为任务结果 JSON。
- `Format=txt`：返回 `text/plain; charset=utf-8`，内容为按行拼接的 `FinalSentence`。
- `Format=rttm`：返回 `text/plain; charset=utf-8`，内容为离线说话人分离 RTTM；该格式不可用时返回错误。

---

## 查询任务统计

### 接口地址
`GET /api/asr/task_stats`

### 响应参数
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `QueuedTasks` | int | 等待处理的任务数 |
| `RunningTasks` | int | 正在处理或等待回调的任务数 |
| `SucceededTasks` | int | 已成功任务数 |
| `FailedTasks` | int | 识别失败任务数 |
| `CanceledTasks` | int | 已取消任务数 |
| `TotalTasks` | int | 任务总数 |
| `PendingTranscriptionTasks` | int | 等待或正在转写的任务数 |
| `TranscriptionFailedTasks` | int | 转写失败任务数 |
| `CallbackFailedTasks` | int | 回调最终失败任务数 |

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "QueuedTasks": 0,
      "RunningTasks": 1,
      "SucceededTasks": 10,
      "FailedTasks": 1,
      "CanceledTasks": 0,
      "TotalTasks": 12,
      "PendingTranscriptionTasks": 1,
      "TranscriptionFailedTasks": 1,
      "CallbackFailedTasks": 0
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
| `overlapPreviewRegions` | string | 否 | 双人重叠预览区间 JSON 字符串（成功且任务结果存在 `OverlapPreviewRegions` 时返回） |
| `audioTime` | float | 否 | 音频时长（秒，成功时返回） |

### `resultDetail` JSON 结构（字符串内容）
`resultDetail` 字段是一个 JSON 字符串，解析后为数组：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `[].FinalSentence` | string | 单句最终文本（含标点） |
| `[].StartMs` | int | 单句开始时间（毫秒） |
| `[].EndMs` | int | 单句结束时间（毫秒） |
| `[].HasOverlap` | bool | 该句时间范围内是否存在至少两位不同说话人同时活动 |
| `[].OverlapDurationMs` | int | 该句时间范围内多人同时说话的实际累计时长（毫秒） |
| `[].OverlapSegments` | array | 该句内的精确重叠片段；每段均已裁剪到当前句子的时间范围，无重叠时为空数组 |
| `[].OverlapSegments[].StartMs` | int | 重叠片段开始时间（原音频绝对时间，毫秒） |
| `[].OverlapSegments[].EndMs` | int | 重叠片段结束时间（原音频绝对时间，毫秒） |
| `[].OverlapSegments[].SpeakerIds` | int[] | 该片段内同时活动的任务内临时说话人 ID，至少包含两项 |
| `[].SpeakerId` | int | 说话人 ID（仅当前任务内有意义） |
| `[].SpeakerProfileId` | string | 匹配到的注册声纹 Profile ID；未命中时缺省或为 `null` |
| `[].SpeakerName` | string | 匹配到的注册声纹名称；未命中时缺省或为 `null` |
| `[].SpeakerMatchScore` | number | 声纹匹配分数 |
| `[].SpeakerMatchStatus` | string | `matched / unknown` |
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
| `[].SpeakerMatchStatus` | string | `matched / unknown` |

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
| `[].SpeakerMatchStatus` | string | `matched / unknown` |

### `overlapPreviewRegions` JSON 结构（字符串内容）
`overlapPreviewRegions` 字段是一个 JSON 字符串，解析后为数组，内容与任务状态查询返回的 `Response.Data.OverlapPreviewRegions` 一致：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `[].RegionId` | string | 当前任务内稳定的重叠预览区间 ID |
| `[].StartMs` | int | 原音频中重叠区间开始时间（毫秒） |
| `[].EndMs` | int | 原音频中重叠区间结束时间（毫秒） |
| `[].OverlapDurationMs` | int | 区间内实际检测到恰好两位说话人同时活动的累计时长（毫秒） |
| `[].SpeakerIds` | int[] | 候选任务内临时说话人 ID |

### 回调示例（成功，解码后可读）
```
code=0
message=success
requestId=17695849897311
taskId=1
resultDetail=[
  {"FinalSentence":"你好，这是第一段语音。","StartMs":1000,"EndMs":3500,"HasOverlap":true,"OverlapDurationMs":680,"OverlapSegments":[{"StartMs":1820,"EndMs":2500,"SpeakerIds":[0,1]}],"SpeakerId":0,"SpeakerProfileId":"spk_zhangsan","SpeakerName":"张三","SpeakerMatchScore":0.86,"SpeakerMatchStatus":"matched","Emotion":"neutral","EmotionScore":0.82,
   "Words":[{"Char":"你","Time":1.02},{"Char":"好","Time":1.14}]}
]
speakerProfileMatches=[
  {"SpeakerId":0,"SpeakerProfileId":"spk_zhangsan","SpeakerName":"张三","SpeakerMatchScore":0.86,"SpeakerMatchStatus":"matched"}
]
speakerSegments=[
  {"StartMs":1000,"EndMs":3500,"SpeakerId":0,"SpeakerProfileId":"spk_zhangsan","SpeakerName":"张三","SpeakerMatchScore":0.86,"SpeakerMatchStatus":"matched"}
]
overlapPreviewRegions=[
  {"RegionId":"overlap_0000","StartMs":1800,"EndMs":2520,"OverlapDurationMs":680,"SpeakerIds":[0,1]}
]
audioTime=5.5
```

### 回调示例（成功，URL 编码后的传输形式，换行展示）
```
code=0
&message=success
&requestId=17695849897311
&taskId=1
&resultDetail=%5B%7B%22FinalSentence%22%3A%22%E4%BD%A0%E5%A5%BD%EF%BC%8C%E8%BF%99%E6%98%AF%E7%AC%AC%E4%B8%80%E6%AE%B5%E8%AF%AD%E9%9F%B3%E3%80%82%22%2C%22StartMs%22%3A1000%2C%22EndMs%22%3A3500%2C%22HasOverlap%22%3Atrue%2C%22OverlapDurationMs%22%3A680%2C%22OverlapSegments%22%3A%5B%7B%22StartMs%22%3A1820%2C%22EndMs%22%3A2500%2C%22SpeakerIds%22%3A%5B0%2C1%5D%7D%5D%2C%22Emotion%22%3A%22neutral%22%2C%22EmotionScore%22%3A0.82%2C%22Words%22%3A%5B%7B%22Char%22%3A%22%E4%BD%A0%22%2C%22Time%22%3A1.02%7D%2C%7B%22Char%22%3A%22%E5%A5%BD%22%2C%22Time%22%3A1.14%7D%5D%7D%5D
&overlapPreviewRegions=%5B%7B%22RegionId%22%3A%22overlap_0000%22%2C%22StartMs%22%3A1800%2C%22EndMs%22%3A2520%2C%22OverlapDurationMs%22%3A680%2C%22SpeakerIds%22%3A%5B0%2C1%5D%7D%5D
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

`POST /api/asr/create_task` 和 `POST /api/asr/create_task_upload` 会执行说话人分离和注册声纹匹配。`GroupIds` 和 `SpeakerProfileIds` 用于限定候选范围；未满足匹配条件的临时说话人返回 `SpeakerMatchStatus=unknown`。声纹 Profile 注册和管理详见 [声纹注册与识别 API](speaker_profiles_http.md)。

---

## 进度语义

- `task_status` 会返回百分比进度；排队时为 `0`，成功后为 `100`。
- `ProgressCurrent` 和 `ProgressTotal` 表示当前阶段的完成量。
- `ProgressPercent` 是阶段进度估算，不代表严格的剩余耗时。
- `ProgressStage` 可能为：`queued`、`running`、`preparing_audio`、`detecting_speech`、`segmenting_audio`、`transcribing`、`diarizing_speakers`、`assembling_result`、`succeeded`、`failed`、`canceled`。

---

## 错误码
| 错误码 | 说明 |
| :--- | :--- |
| `InvalidParameter` | 参数无效 |
| `InvalidParameterValue` | 参数值无效 |
| `MissingParameter` | 缺少必填参数 |
| `FailedOperation.ErrorDownFile` | 音频下载/读取失败 |
| `FailedOperation.ErrorRecognize` | 识别处理失败 |
| `FailedOperation.LicenseUnauthorized` | 授权未加载、已过期或无有效路数，拒绝创建新的离线任务 |
| `FailedOperation.NoSuchTask` | 任务不存在 |
| `FailedOperation.TaskNotFinished` | 任务尚未完成，结果不可用 |
| `FailedOperation.NoSuchSpeakerProfile` | 声纹 Profile 不存在 |
| `FailedOperation.SpeakerEnrollFailed` | 声纹注册失败 |
| `InternalError.FailAccessDatabase` | 服务暂时不可用 |
