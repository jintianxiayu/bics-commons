## ADDED Requirements

### Requirement: 默认 traceId 注入

当 `tracing` 配置为 `true` 或 `{}` 时，系统 SHALL 从 `LoggerContext.get('traceId')` 获取 traceId，并注入到请求头 `x-trace-id` 中。

#### Scenario: LoggerContext 中存在 traceId

- **WHEN** `tracing: true` 且 `LoggerContext.get('traceId')` 返回 `'abc-123'`
- **THEN** 发出的请求头中包含 `x-trace-id: abc-123`

#### Scenario: LoggerContext 中不存在 traceId

- **WHEN** `tracing: true` 且 `LoggerContext.get('traceId')` 返回 `undefined`
- **THEN** 发出的请求头中不包含 `x-trace-id` 字段

### Requirement: 自定义 header 名称

当 `tracing` 配置包含 `headerName` 选项时，系统 SHALL 使用该名称作为注入的请求头字段名。

#### Scenario: 指定自定义 header 名称

- **WHEN** `tracing: { headerName: 'x-request-id' }` 且 traceId 存在
- **THEN** 发出的请求头中包含 `x-request-id: <traceId>` 而非 `x-trace-id`

### Requirement: 自定义 provider

当 `tracing` 配置包含 `provider` 函数时，系统 SHALL 调用该函数获取 traceId，而非从 LoggerContext 读取。

#### Scenario: provider 返回有效值

- **WHEN** `tracing: { provider: () => 'custom-456' }`
- **THEN** 发出的请求头中包含 `x-trace-id: custom-456`

#### Scenario: provider 返回 undefined

- **WHEN** `tracing: { provider: () => undefined }`
- **THEN** 发出的请求头中不包含 `x-trace-id` 字段

### Requirement: 未配置时无副作用

当 `tracing` 未配置（`undefined`）时，系统 SHALL 不注入任何 tracing 相关的请求头。

#### Scenario: tracing 未配置

- **WHEN** `HttpClientConfig` 中未设置 `tracing` 字段
- **THEN** 请求头不包含 `x-trace-id` 或其他 tracing 相关字段

### Requirement: 执行顺序

tracing middleware SHALL 在 debug middleware 和用户自定义 middleware 之前执行，确保后续中间件可以看到已注入的 traceId header。

#### Scenario: tracing 与 debug 同时启用

- **WHEN** `tracing: true` 且 `debug: true` 同时配置，LoggerContext 有 traceId
- **THEN** debug 输出的请求 headers 中包含已注入的 `x-trace-id`
