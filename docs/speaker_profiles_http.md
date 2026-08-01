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
- 同一个 `SpeakerProfileId` 可以多次注册样本；一次注册可能返回一条或多条 enrollment，这些样本仍表示同一个人。

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
      "Status": "active",
      "AudioUrl": "/api/speakers/enrollment_audio?EnrollmentId=enr_000001"
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

### 失败响应示例（离群过滤后的有效语音不足）
```json
{
  "Response": {
    "RequestId": "...",
    "Error": {
      "Code": "FailedOperation.SpeakerEnrollmentQualityTooLow",
      "Message": "speaker enrollment accepted audio does not meet ratio or duration fallback: accepted_ratio=0.35, min_accepted_ratio=0.6, accepted_speech_ms=4200, min_accepted_speech_ms=5000, min_accepted_ratio_floor=0.4"
    },
    "Data": {
      "QualityMetric": "AcceptedRatio",
      "QualityScore": 0.35,
      "MinQualityScore": 0.6,
      "AcceptedRatio": 0.35,
      "MinAcceptedRatio": 0.6,
      "AcceptedSpeechMs": 4200,
      "MinAcceptedSpeechMs": 5000,
      "MinAcceptedRatioFloor": 0.4
    }
  }
}
```

`QualityScore` 和 `MinQualityScore` 是兼容字段，具体含义由 `QualityMetric` 标识：

| `QualityMetric` | 附加字段 | 说明 |
| :--- | :--- | :--- |
| `AcceptedRatio` | `AcceptedRatio`、`MinAcceptedRatio`、`AcceptedSpeechMs`、`MinAcceptedSpeechMs`、`MinAcceptedRatioFloor` | 保留比例和有效语音时长兜底均未通过 |
| `ConsistencyScore` | `ConsistencyScore`、`MinConsistencyScore` | 样本一致性分不足 |
| `QualityScore` | 无 | 综合注册质量分低于配置阈值 |

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
      "Status": "active",
      "AudioUrl": "/api/speakers/enrollment_audio?EnrollmentId=enr_000002"
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
          "CreatedAt": "2026-05-27 10:02:00",
          "AudioUrl": "/api/speakers/enrollment_audio?EnrollmentId=enr_000001"
        }
      ]
    }
  }
}
```

---

## 播放注册声纹音频

### 接口地址
`GET /api/speakers/enrollment_audio`

该接口按注册样本 ID 返回可播放的完整注册音频，可用于在声纹管理页或离线任务命中结果中进行人工比对。

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `EnrollmentId` | string | 是 | 注册样本 ID |

### 响应

- 成功时返回浏览器可播放的音频文件流，并支持 HTTP Range 请求。
- 样本不存在时返回 `InvalidParameterValue`；注册音频不可用时返回 `FailedOperation.ArtifactNotFound`。

`GET /api/speakers/get` 的每个 `Enrollments` 项会在注册音频可用时返回 `AudioUrl`，可直接作为该接口的播放地址。

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
| `AudioUrl` | 注册样本的受控播放地址；查询详情且音频可用时返回 |
| `Status` | Profile 状态 |

---

## 转写任务中的声纹识别

转写任务接口仍在 [offline_async_http.md](offline_async_http.md) 中维护。`POST /api/asr/create_task` 和上传创建任务会执行注册声纹匹配；以下参数用于限定候选范围：

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `GroupIds` | array[string] | 否 | 限定本次任务可匹配的声纹组 ID；不传或空数组表示匹配默认组 `default` |
| `SpeakerProfileIds` | array[string] | 否 | 限定本次任务可匹配的人员 ID；不传或空数组表示匹配指定组内全部启用声纹 |

匹配后，转写结果中的 `ResultDetail`、`SpeakerSegments` 和 `SpeakerProfileMatches` 会返回注册声纹信息。`SpeakerProfileId` 全局唯一；未满足匹配条件时返回 `SpeakerMatchStatus=unknown`。

实时 WebSocket 转写接口在 [realtime-websocket-api.md](realtime-websocket-api.md) 中维护。启用说话人回写时，可通过 `group_ids` 和 `speaker_profile_ids` 限定候选范围，并在 `TranscriptUpdate` 中接收匹配结果。
