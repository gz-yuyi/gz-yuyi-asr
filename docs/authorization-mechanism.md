# 授权机制与调用流程

当前项目使用 `src/yuyi_auth` 对接既有在线授权协议，并用授权结果控制离线任务创建准入和同时处理路数。

## 授权协议

- 请求接口：`POST {license.service_url}{license.path}?product={product}`
- `license.path` 默认：`/license/getLicense`
- POST body 为空
- 如果配置了 `license.authorization`，请求头透传：`Authorization: {license.authorization}`
- `product` 明文：`{"productId":"11111"}`
- `product` 加密：`RSA-OAEP-SHA256(公钥加密，OAEP Hash=SHA-256，MGF1 Hash=SHA-256) -> Base64 -> URL encode`
- 默认使用内置 `HttpPublicKey` 加密；`license.public_key_path` 仅作为显式覆盖

授权服务响应字段：

- `code`：必须为 `200`
- `msg`：错误信息
- `licenseInfo`：加密后的授权内容

`licenseInfo` 处理方式：

- `Base64 解码 -> RSA-OAEP-SHA256(私钥解密，OAEP Hash=SHA-256，MGF1 Hash=SHA-256)`
- 默认使用内置 `ProductPrivateKey` 解密；`license.private_key_path` 仅作为显式覆盖

解密后的明文结构：

```json
{
  "productId": "1111",
  "code": "stream",
  "name": "ASR转写引擎",
  "concurrency": "5",
  "expirationTime": "2026-04-15"
}
```

## 路数控制

- `concurrency` 表示最多同时处理多少个离线任务
- 提交离线任务前先检查授权是否有效；授权未加载、过期或路数小于等于 0 时，`create_task` 和 `create_task_upload` 返回 `FailedOperation.LicenseUnauthorized`，不会创建 `queued` 任务，也不会保存上传文件
- 授权有效时，提交任务只入库为 `queued`，不占路数，也不会因为当前运行数已达到授权并发数被拒绝
- worker claim 任务前检查授权是否有效
- worker 只有在 `running` 任务数小于有效处理容量时才把 `queued` 任务切到 `running`
- 有效处理容量为 `min(OFFLINE_ASR_MAX_AUDIO_JOBS, 授权 concurrency)`
- 授权失效后不再接收新的离线任务，也不再 claim 新任务；已有 `queued` 任务保持 pending
- 通过环境变量加载的运行时默认强制授权；缺少 `service_url/product_id`、启动拉取失败、授权过期或授权路数为 0 都按 fail closed 处理

## 配置

环境变量：

- `OFFLINE_ASR_LICENSE_SERVICE_URL`
- `OFFLINE_ASR_LICENSE_PATH`，默认 `/license/getLicense`
- `OFFLINE_ASR_LICENSE_PRODUCT_ID`
- `OFFLINE_ASR_LICENSE_AUTHORIZATION`
- `OFFLINE_ASR_LICENSE_PUBLIC_KEY_PATH`
- `OFFLINE_ASR_LICENSE_PRIVATE_KEY_PATH`
- `OFFLINE_ASR_LICENSE_REFRESH_INTERVAL_MS`，默认 `60000`
- `OFFLINE_ASR_LICENSE_TIMEOUT_MS`，默认 `5000`

不提供环境变量关闭授权。测试或本地开发代码如需绕过启动强制授权，只能在进程内显式构造 `LicenseConfig(require_at_startup=False)`。

兼容旧环境变量：

- `OFFLINE_ASR_LICENSE_ENDPOINT` 可作为 `OFFLINE_ASR_LICENSE_SERVICE_URL`
- `OFFLINE_ASR_PRODUCT_ID` 可作为 `OFFLINE_ASR_LICENSE_PRODUCT_ID`

## 状态查询

`GET /api/system/route_status` 返回授权状态、授权路数、当前 running 数、queued 数、可用处理路数、到期时间和最近刷新错误。
