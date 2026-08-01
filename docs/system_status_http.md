# 系统状态 API

## 查询授权并发

### 接口地址

`GET /api/system/route_status`

### 成功响应示例

```json
{
  "Response": {
    "RequestId": "17695849897311",
    "Data": {
      "LicensedRoutes": 5,
      "TotalRoutes": 5,
      "ExpirationTime": "2026-04-15T23:59:59"
    }
  }
}
```

### 响应字段

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `LicensedRoutes` | int | 当前授权并发路数 |
| `TotalRoutes` | int | `LicensedRoutes` 的兼容字段，含义相同 |
| `ExpirationTime` | string/null | 当前授权到期时间；不可用时为 `null` |

响应中可能包含额外状态字段，客户端不应依赖未在本页列出的字段。
