# 系统状态 API

## 查询授权与路数占用

### 接口地址

`GET /api/system/route_status`

### 成功响应示例

```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "LicensedRoutes": 50,
      "TotalRoutes": 50,
      "RealtimeActiveRoutes": 10,
      "OfflineActiveRoutes": 30,
      "AvailableRoutes": 10,
      "QueuedTasks": 0,
      "ExpirationTime": "2026-04-15T23:59:59"
    }
  }
}
```

### 响应字段

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `LicensedRoutes` | int | 当前授权的总路数 |
| `TotalRoutes` | int | `LicensedRoutes` 的兼容字段，含义相同 |
| `RealtimeActiveRoutes` | int | 当前已准入并占用授权路数的实时会话数 |
| `OfflineActiveRoutes` | int | 当前已准入并处于处理状态的离线任务数 |
| `AvailableRoutes` | int | 当前空闲授权路数，即总路数减去实时和离线占用，最小为 `0` |
| `QueuedTasks` | int | 尚未获得授权路数、仍在等待准入的离线任务数 |
| `RealtimeReservedRoutes` | int | 单个 API 实例配置的实时会话上限；该字段不是当前实时占用数 |
| `ExpirationTime` | string/null | 当前授权到期时间；不可用时为 `null` |

### 路数语义

授权路数表示服务能够同时准入的用户级任务或会话数量。实时会话与离线任务共用同一个授权池，满足：

```text
RealtimeActiveRoutes + OfflineActiveRoutes <= TotalRoutes
```

授权范围内的离线任务进入处理状态并占用路数，超出授权容量的任务才计入 `QueuedTasks`。服务内部的音频切段、模型请求队列和瞬时推理并发属于实现细节，不改变上述占用路数的统计语义。

响应中可能包含额外授权诊断字段，客户端不应依赖未在本页列出的字段。
