# 更新日志

## [未发布]

- 补齐声纹注册 `SourceType=0` 的 HTTP/HTTPS URL 音频支持，明确下载大小、超时、重定向约束及 `FailedOperation.ErrorDownFile` 错误语义。

- 离线改为按授权路数折算共享总吞吐，取消每任务强制速度；任务可排队，不保证授权路数以内全部同时执行。系统状态删除 `OfflineActiveRoutes` 和 `TotalRoutes`，使用 `OfflineRunningTasks`、`OfflineJobConcurrency`、`OfflineAudioRatePerRoute`、`OfflineTotalAudioRate`，实时空闲路数不再扣离线执行任务；测试控制台同步展示。

- 明确词时间范围来自实际识别音频的前后语音上下文，不保证严格包含于片段的起止时间；客户端不得据此裁掉词时间戳。

- 补齐实时对齐的实际能力回显、词时间戳字段与 `align_refine` 修订语义。
- 明确正常结束等待对齐、取消后不发布迟到结果，以及对齐能力不可用、音频缺失和对齐失败的错误行为。
- 客户端需核对实际启用状态与词时间戳回填，不能仅凭请求携带 `enable_align=true` 判断已完成对齐。
