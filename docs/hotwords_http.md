# 热词管理 API

热词表用于在实时或离线识别时提供领域词、专名、地名等上下文提示。离线转写任务通过 `HotwordId` 引用热词表；实时 WebSocket 通过 `hotword_id` 查询热词表。

## 通用响应结构

成功响应：

```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {}
  }
}
```

失败响应：

```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Error": {
      "Code": "InvalidParameterValue",
      "Message": "hotword not found: default"
    }
  }
}
```

---

## 新增或更新热词表

### 接口地址
`POST /api/hotwords/upsert`

如果 `HotwordId` 已存在，则更新其内容；如果不存在，则创建新热词表。

### 请求头
| Header | 值 |
| :--- | :--- |
| `Content-Type` | `application/json` |

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `HotwordId` | string | 是 | 热词表 ID |
| `Content` | string | 是 | 热词内容，可使用逗号、换行或业务约定格式分隔 |

### 请求示例
```json
{
  "HotwordId": "default",
  "Content": "广州,荔湾区,圆中园"
}
```

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "HotwordId": "default",
      "Content": "广州,荔湾区,圆中园",
      "CreatedAt": "2026-06-05T10:00:00",
      "UpdatedAt": "2026-06-05T10:00:00"
    }
  }
}
```

---

## 查询热词表

### 接口地址
`GET /api/hotwords/get`

### 请求参数（Query）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `HotwordId` | string | 是 | 热词表 ID |

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "HotwordId": "default",
      "Content": "广州,荔湾区,圆中园",
      "CreatedAt": "2026-06-05T10:00:00",
      "UpdatedAt": "2026-06-05T10:00:00"
    }
  }
}
```

---

## 查询热词表列表

### 接口地址
`GET /api/hotwords/list`

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "Items": [
        {
          "HotwordId": "default",
          "Content": "广州,荔湾区,圆中园",
          "CreatedAt": "2026-06-05T10:00:00",
          "UpdatedAt": "2026-06-05T10:00:00"
        }
      ]
    }
  }
}
```

---

## 删除热词表

### 接口地址
`POST /api/hotwords/delete`

### 请求头
| Header | 值 |
| :--- | :--- |
| `Content-Type` | `application/json` |

### 请求体（JSON）
| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `HotwordId` | string | 是 | 热词表 ID |

### 请求示例
```json
{
  "HotwordId": "default"
}
```

### 成功响应示例
```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "HotwordId": "default",
      "Deleted": true
    }
  }
}
```

删除不存在的热词表时，`Deleted` 返回 `false`。
