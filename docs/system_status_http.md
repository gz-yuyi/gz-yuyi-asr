# 系统状态 API

## 查询授权与任务状态

### 接口地址

`GET /api/system/route_status`

### 成功响应示例

```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "LicensedRoutes": 20,
      "RealtimeActiveRoutes": 3,
      "AvailableRoutes": 17,
      "OfflineProcessingTasks": 20,
      "OfflineRunningTasks": 8,
      "OfflineJobConcurrency": 8,
      "OfflineAudioRatePerRoute": 2,
      "OfflineTotalAudioRate": 40,
      "QueuedTasks": 12,
      "ExpirationTime": "2027-04-15T23:59:59"
    }
  }
}
```

### 响应字段

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `LicensedRoutes` | int | 当前授权路数，用于实时会话准入及离线总吞吐折算 |
| `RealtimeActiveRoutes` | int | 当前已准入的实时会话数 |
| `AvailableRoutes` | int | 当前空闲实时授权路数，即授权路数减实时占用，最小为 `0`；离线执行任务不扣除此值 |
| `OfflineProcessingTasks` | int | 已受理且尚未完成转写的离线任务数，包含等待调度与实际执行；等于 `QueuedTasks + OfflineRunningTasks`，不是同时推理路数 |
| `OfflineRunningTasks` | int | 当前实际执行的离线任务数，不包含等待调度的任务，不代表占用相同数量的实时授权路 |
| `OfflineJobConcurrency` | int | 当前离线同时执行任务上限；超出的任务排队 |
| `OfflineAudioRatePerRoute` | number | 每条授权路折算的离线音频实时倍数 |
| `OfflineTotalAudioRate` | number | 当前有效离线总吞吐额度，单位为音频秒/墙钟秒；授权无效时为 `0` |
| `QueuedTasks` | int | 尚未进入执行阶段的离线任务数 |
| `RealtimeReservedRoutes` | int | 单个服务实例配置的实时会话上限；不是当前实时占用数 |
| `ExpirationTime` | string/null | 当前授权到期时间；不可用时为 `null` |

### 授权与吞吐语义

离线总吞吐额度 = 授权路数 × 每路实时倍数。例如授权 20 路、每路 2 倍时，所有离线任务共享 40 倍实时额度；单个任务可以使用空闲额度，不保证也不限制每个任务恰好为 2 倍。

离线按包含静音的输入音频时长计量，重叠切片不重复计入。已消耗的预算在失败或取消后不退还，未进入执行窗口的后续音频不提前整文件扣费。总额度约束工作准入的平均速度，允许有界在途工作造成结果交付突发，不是任意滚动一秒的返回速率承诺。

任务创建成功即进入业务“处理中”状态，其中可能等待调度；即使任务数量小于授权路数，也不保证全部同时执行。`OfflineProcessingTasks` 按实际任务数返回，没有任务时为 `0`，不按授权路数补齐或截断。测试网页主展示“离线处理中任务”，实际执行、等待调度及内部并发上限放在可展开的调度明细中。实时授权会话数与离线执行任务数不再相加比较授权路数；两类业务共享计算资源，授权额度不代表硬件吞吐承诺。

实时不附加离线商业节拍，但仍检查授权、会话准入、输入大小和积压限制。客户端应按真实音频速度发送，不得将取消商业节拍理解为无限速上传或无限缓存。

本次变更删除 `TotalRoutes` 和 `OfflineActiveRoutes`，客户端应直接使用上述字段，不依赖旧字段别名。响应中可能包含额外诊断字段，客户端不应依赖未在本页列出的字段。
