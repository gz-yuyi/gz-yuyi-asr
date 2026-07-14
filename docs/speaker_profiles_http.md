# 声纹注册与识别 API

注册声纹用于把离线音频内聚类得到的临时 `SpeakerId` 映射到已知人员。声纹识别不改变当前任务内的聚类编号，只在结果中补充已注册人员的匹配信息。

## 术语

| 名称 | 说明 |
| :--- | :--- |
| `SpeakerId` | 当前转写任务内的临时说话人编号，只在本次任务内有意义 |
| `SpeakerProfileId` | 注册声纹 Profile ID，表示一个人，跨任务、跨分组全局唯一 |
| `SpeakerName` | 注册声纹显示名称 |
| `GroupId` | 声纹组 ID，用于部门、项目、租户等业务范围过滤 |
| `GroupName` | 声纹组显示名称 |
| `EnrollmentId` | 单条注册样本 ID；同一个人可以有多条 enrollment |
| `SpeakerMatchScore` | 临时说话人与注册声纹的匹配分数 |
| `SpeakerMatchStatus` | 匹配状态：`matched`=命中，`unknown`=未达到阈值或区分度不足，`disabled`=本次任务未启用声纹识别 |

## 身份与分组规则

- `SpeakerProfileId` 是“人”的全局唯一 ID，不随分组变化。
- 同一个人加入多个组时，应复用同一个 `SpeakerProfileId`，不要在不同组里重复创建不同 Profile。
- 分组只是 `SpeakerProfile` 的 membership；一个 Profile 可以属于多个组。
- 不传 `GroupId` 时使用默认组 `default`。
- `SpeakerProfileIds` 用于限定具体人员，`GroupIds` 用于限定匹配范围；两者同时传时取交集。

示例：

```text
SpeakerProfileId=spk_zhangsan 代表张三本人
张三可以同时属于 GroupId=customer_service 和 GroupId=qa_team
注册声纹时仍写到 spk_zhangsan 下面，不为每个组重复注册一个人
```

## 注册建议

- 注册音频应尽量只包含一个人的语音。
- 推荐有效语音时长不少于 **10 秒**，更稳定的注册样本建议 **30 秒以上**。
- 服务端会复用离线转写链路中的音频准备、VAD、固定窗口切片和声纹 embedding 模型。
- 注册时不建议直接对整段音频只提一个 embedding；应先切成与识别链路一致的小片段，再对小片段 embedding 做质量过滤和聚合。
- 同一个 `SpeakerProfileId` 可以多次注册样本；一次注册可能生成 1 条或多条 enrollment。服务端可把同一注册音频中的多个稳定主簇保存为多个 prototype enrollment，用于覆盖同一人员的不同声学状态。
- 不同声纹模型或模型版本产生的 embedding 不应直接混用；匹配时只比较相同模型版本和向量维度的注册向量。

---

## 创建或加入声纹 Profile

### 接口地址
`POST /api/speakers/create`

该接口用于创建一个全局唯一的人员 Profile；如果 `SpeakerProfileId` 已存在，则更新基础信息，并把该 Profile 加入指定组。

### 请求头
| Header | 值 |
| :--- | :--- |
| `Content-Type` | `application/json` |

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `SpeakerProfileId` | string | 否 | 自定义人员 ID；不传则服务端生成 |
| `SpeakerName` | string | 是 | 说话人显示名称 |
| `Description` | string | 否 | 备注 |
| `GroupId` | string | 否 | 加入的声纹组 ID；不传使用默认组 `default` |
| `GroupName` | string | 否 | 声纹组显示名称；组不存在时可用该名称创建 |

### 请求示例
```json
{
  "SpeakerProfileId": "spk_zhangsan",
  "SpeakerName": "张三",
  "Description": "客服一组",
  "GroupId": "customer_service",
  "GroupName": "客服组"
}
```

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "SpeakerProfileId": "spk_zhangsan",
      "SpeakerName": "张三",
      "Description": "客服一组",
      "Groups": [
        {
          "GroupId": "customer_service",
          "GroupName": "客服组"
        }
      ],
      "EnrollmentCount": 0,
      "Status": "active"
    }
  }
}
```

---

## 注册声纹（URL 或本地路径）

### 接口地址
`POST /api/speakers/enroll`

### 请求头
| Header | 值 |
| :--- | :--- |
| `Content-Type` | `application/json` |

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `SpeakerProfileId` | string | 是 | 全局唯一人员 ID |
| `SpeakerName` | string | 条件必填 | `AutoCreate=true` 且 Profile 不存在时必填 |
| `SourceType` | int | 是 | 音频来源类型：`0`=URL，`1`=本地文件路径 |
| `Url` | string | 条件必填 | 音频 URL 地址（`SourceType=0` 时必填） |
| `Extra` | string | 条件必填 | 本地音频文件绝对路径（`SourceType=1` 时必填） |
| `AutoCreate` | bool | 否 | Profile 不存在时是否自动创建，默认 `false` |
| `Description` | string | 否 | 自动创建 Profile 时使用的备注 |
| `GroupId` | string | 否 | 将 Profile 加入该声纹组；不传使用默认组 `default` |
| `GroupName` | string | 否 | 声纹组显示名称 |

### 请求示例
```json
{
  "SpeakerProfileId": "spk_zhangsan",
  "SpeakerName": "张三",
  "SourceType": 1,
  "Extra": "/data/speaker_samples/zhangsan.wav",
  "AutoCreate": true,
  "Description": "客服一组",
  "GroupId": "customer_service",
  "GroupName": "客服组"
}
```

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "SpeakerProfileId": "spk_zhangsan",
      "SpeakerName": "张三",
      "EnrollmentId": "enr_000001",
      "EnrollmentCount": 3,
      "QualityScore": 0.91,
      "PrototypeCount": 3,
      "PrototypeEnrollmentIds": ["enr_000001", "enr_000002", "enr_000003"],
      "Status": "active"
    }
  }
}
```

### 失败响应示例（注册音频不合格）
```json
{
  "Response": {
    "RequestId": "...",
    "Error": {
      "Code": "InvalidParameterValue",
      "Message": "effective speech is too short: 2400ms"
    }
  }
}
```

### 失败响应示例（注册质量分过低）
```json
{
  "Response": {
    "RequestId": "...",
    "Error": {
      "Code": "FailedOperation.SpeakerEnrollmentQualityTooLow",
      "Message": "speaker enrollment quality score 0.42 is below minimum 0.6"
    },
    "Data": {
      "QualityScore": 0.42,
      "MinQualityScore": 0.6
    }
  }
}
```

---

## 上传音频注册声纹

### 接口地址
`POST /api/speakers/enroll_upload`

### 请求头
| Header | 值 |
| :--- | :--- |
| `Content-Type` | `application/octet-stream` |

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `SpeakerProfileId` | string | 是 | 全局唯一人员 ID |
| `SpeakerName` | string | 条件必填 | `AutoCreate=true` 且 Profile 不存在时必填 |
| `AutoCreate` | bool | 否 | Profile 不存在时是否自动创建，默认 `false` |
| `Description` | string | 否 | 自动创建 Profile 时使用的备注 |
| `GroupId` | string | 否 | 将 Profile 加入该声纹组；不传使用默认组 `default` |
| `GroupName` | string | 否 | 声纹组显示名称 |
| `Filename` | string | 否 | 上传音频文件名，默认 `speaker.wav` |

### 请求体
原始音频二进制内容。

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "SpeakerProfileId": "spk_zhangsan",
      "SpeakerName": "张三",
      "EnrollmentId": "enr_000002",
      "EnrollmentCount": 2,
      "QualityScore": 0.94,
      "Status": "active"
    }
  }
}
```

---

## 查询声纹 Profile

### 接口地址
`GET /api/speakers/get`

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `SpeakerProfileId` | string | 是 | 全局唯一人员 ID |
| `GroupId` | string | 否 | 可选分组过滤；传入后仅在该组下查询该 Profile |

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "SpeakerProfileId": "spk_zhangsan",
      "SpeakerName": "张三",
      "Description": "客服一组",
      "Groups": [
        {
          "GroupId": "customer_service",
          "GroupName": "客服组"
        },
        {
          "GroupId": "qa_team",
          "GroupName": "质检组"
        }
      ],
      "EnrollmentCount": 2,
      "Status": "active",
      "Enrollments": [
        {
          "EnrollmentId": "enr_000001",
          "EffectiveSpeechMs": 18420,
          "QualityScore": 0.91,
          "CreatedAt": "2026-05-27 10:02:00"
        }
      ]
    }
  }
}
```

---

## 查询声纹 Profile 列表

### 接口地址
`GET /api/speakers/list`

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `GroupId` | string | 否 | 声纹组 ID；不传查询默认组 `default` |
| `Status` | string | 否 | 状态过滤：`active / disabled / all`，默认 `active` |
| `Limit` | int | 否 | 返回数量，默认 `50`，最大 `200` |
| `Offset` | int | 否 | 偏移量，默认 `0` |

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "Items": [
        {
          "SpeakerProfileId": "spk_zhangsan",
          "SpeakerName": "张三",
          "Description": "客服一组",
          "Groups": [
            {
              "GroupId": "customer_service",
              "GroupName": "客服组"
            }
          ],
          "EnrollmentCount": 2,
          "Status": "active"
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

## 更新声纹 Profile

### 接口地址
`POST /api/speakers/update`

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `SpeakerProfileId` | string | 是 | 全局唯一人员 ID |
| `SpeakerName` | string | 否 | 新显示名称 |
| `Description` | string | 否 | 新备注 |
| `Status` | string | 否 | `active / disabled` |
| `GroupId` | string | 否 | 将 Profile 加入该声纹组，或更新该组名称 |
| `GroupName` | string | 否 | 声纹组显示名称 |

### 请求示例
```json
{
  "SpeakerProfileId": "spk_zhangsan",
  "SpeakerName": "张三",
  "Description": "客服一组组长",
  "Status": "active",
  "GroupId": "customer_service",
  "GroupName": "客服组"
}
```

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "SpeakerProfileId": "spk_zhangsan",
      "SpeakerName": "张三",
      "Description": "客服一组组长",
      "Groups": [
        {
          "GroupId": "customer_service",
          "GroupName": "客服组"
        }
      ],
      "EnrollmentCount": 2,
      "Status": "active"
    }
  }
}
```

---

## 删除声纹 Profile

### 接口地址
`POST /api/speakers/delete`

删除 Profile 是全局操作，会影响该人员在所有分组下的声纹识别。如果只需要把人员从某个组移除，应使用分组成员管理接口，不应删除 Profile。

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `SpeakerProfileId` | string | 是 | 全局唯一人员 ID |
| `HardDelete` | bool | 否 | 是否物理删除；默认 `false`，即仅置为 `disabled` |

### 请求示例
```json
{
  "SpeakerProfileId": "spk_zhangsan",
  "HardDelete": false
}
```

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "SpeakerProfileId": "spk_zhangsan",
      "Deleted": true,
      "HardDelete": false
    }
  }
}
```

---

## 删除单条声纹注册样本

### 接口地址
`POST /api/speakers/delete_enrollment`

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `EnrollmentId` | string | 是 | 注册样本 ID |

### 请求示例
```json
{
  "EnrollmentId": "enr_000001"
}
```

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "EnrollmentId": "enr_000001",
      "SpeakerProfileId": "spk_zhangsan",
      "Deleted": true,
      "EnrollmentCount": 1
    }
  }
}
```

---

## 响应字段说明

公开 API 默认只返回业务侧需要展示或串联流程的字段：

| 字段 | 说明 |
| :--- | :--- |
| `SpeakerProfileId` | 全局唯一人员 ID |
| `SpeakerName` | 说话人显示名称 |
| `Description` | 备注 |
| `Groups` | 人员所属声纹组列表 |
| `EnrollmentId` | 本次注册生成的样本 ID |
| `EnrollmentCount` | 当前人员的注册样本数量 |
| `QualityScore` | 本次注册样本质量分 |
| `PrototypeCount` | 本次注册生成的 prototype enrollment 数；服务端未启用多 prototype 时通常为 `1` |
| `PrototypeEnrollmentIds` | 本次注册生成的所有 prototype enrollment ID；首个 ID 与 `EnrollmentId` 一致 |
| `EffectiveSpeechMs` | 注册样本有效语音时长；查询详情时可返回 |
| `Status` | Profile 状态 |

以下字段属于内部诊断信息，不建议作为默认公开响应返回：`ModelId`、`ModelRevision`、`EmbeddingDim`、`SubsegmentDurationMs`、`SubsegmentShiftMs`、`SubsegmentCount`、`AcceptedSubsegmentCount`。如需排查注册质量或模型兼容问题，可在内部调试接口、管理后台或 debug 模式中查看。

---

## 声纹识别配置建议

服务端建议提供以下环境变量：

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `YUYI_ASR_SPEAKER_MATCH_THRESHOLD` | `0.78` | 最低匹配分数阈值 |
| `YUYI_ASR_SPEAKER_MATCH_MARGIN` | `0.04` | `top1 - top2` 最小差值；用于避免相近声纹误认 |
| `YUYI_ASR_SPEAKER_MIN_ENROLL_SPEECH_MS` | `10000` | 注册时最低有效语音时长 |
| `YUYI_ASR_SPEAKER_MIN_ENROLL_QUALITY_SCORE` | `0` | 注册质量分最低阈值；`0` 表示只返回分数不拦截 |
| `YUYI_ASR_SPEAKER_MIN_ENROLL_CONSISTENCY_SCORE` | `0.65` | 注册声纹内部一致性最低阈值 |
| `YUYI_ASR_SPEAKER_MIN_ENROLL_ACCEPTED_RATIO` | `0.6` | 剔除离群 subsegment 后要求保留的最小比例 |
| `YUYI_ASR_SPEAKER_ENROLL_OUTLIER_SIMILARITY_THRESHOLD` | `0.55` | 注册声纹 subsegment 与主声音簇代表向量的最小相似度，低于该值会作为离群片段剔除 |
| `YUYI_ASR_SPEAKER_MAX_ENROLL_PROTOTYPES` | `3` | 每次注册最多写入的 prototype enrollment 数；设为 `1` 时退回单中心向量 |
| `YUYI_ASR_SPEAKER_ENROLL_PROTOTYPE_SIMILARITY_THRESHOLD` | `0.82` | 生成多 prototype 时，同一局部 prototype 内 subsegment 与 seed 的最小相似度 |
| `YUYI_ASR_SPEAKER_MIN_ENROLL_PROTOTYPE_SUBSEGMENTS` | `4` | 每个额外 prototype 至少需要覆盖的 subsegment 数 |
| `YUYI_ASR_SPEAKER_MIN_CLUSTER_SPEECH_MS` | `3000` | 识别时参与匹配的临时说话人最低累计时长 |
| `YUYI_ASR_SPEAKER_ENROLL_SUBSEGMENT_DURATION_MS` | 跟随转写链路 | 注册时声纹子段窗口长度 |
| `YUYI_ASR_SPEAKER_ENROLL_SUBSEGMENT_SHIFT_MS` | 跟随转写链路 | 注册时声纹子段滑动步长 |

匹配策略：
- 当前任务仍先做音频内说话人聚类，得到临时 `SpeakerId`。
- 对每个临时 `SpeakerId` 汇总其子段 embedding centroid。
- 用该 centroid 到声纹库中检索相同模型版本、相同维度的 enrollment centroid，距离使用 cosine。
- 同一个 `SpeakerProfileId` 下可以有多个 enrollment；服务端先从向量库取候选 enrollment 分数，再归并到 Profile。
- 多 prototype 注册会把同一注册音频中的多个稳定主簇保存为同一 Profile 下的多条 enrollment；匹配时仍按 Profile 归并，不会把这些 prototype 当成不同人员。
- Profile 分数建议取该 Profile 下 top enrollment 分数，或 top-k enrollment 平均分；第一版推荐取 top enrollment 分数，便于覆盖不同录音设备和场景。
- 只有 `top1 profile score >= threshold` 且 `top1 - top2 >= margin` 时返回 `matched`；否则返回 `unknown`。

## 转写任务如何启用声纹识别

转写任务接口仍在 [offline_async_http.md](offline_async_http.md) 中维护。`POST /api/asr/create_task` 可通过以下字段控制注册声纹识别：

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `EnableSpeakerRecognition` | bool | 否 | 是否启用已注册声纹识别；不传则使用服务端默认配置 |
| `GroupIds` | array[string] | 否 | 限定本次任务可匹配的声纹组 ID；不传或空数组表示匹配默认组 `default` |
| `SpeakerProfileIds` | array[string] | 否 | 限定本次任务可匹配的人员 ID；不传或空数组表示匹配指定组内全部启用声纹 |

启用后，转写结果中的 `ResultDetail`、`SpeakerSegments` 和 `SpeakerProfileMatches` 会返回匹配到的注册声纹信息。由于 `SpeakerProfileId` 全局唯一，结果中默认只需要返回 `SpeakerProfileId`、`SpeakerName`、`SpeakerMatchScore` 和 `SpeakerMatchStatus`。

实时 WebSocket 转写接口在 [realtime-websocket-api.md](realtime-websocket-api.md) 中维护。启用实时说话人回写时，服务端会自动执行注册声纹识别，不提供单独的启停参数或环境变量；可通过 `group_ids` 和 `speaker_profile_ids` 限定本次会话的候选声纹范围，并在 `TranscriptUpdate` 中返回匹配结果。
