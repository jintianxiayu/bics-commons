## ADDED Requirements

### Requirement: 默认 debug 输出

当 `debug` 配置为 `true` 或 `{}` 时，系统 SHALL 使用包内 Logger 的 `debug()` 方法输出完整的请求和响应详情。

#### Scenario: 请求成功时的 debug 输出

- **WHEN** `debug: true` 且 HTTP 请求成功返回
- **THEN** 输出请求日志包含 method、url、headers、body
- **THEN** 输出响应日志包含 method、url、status、headers、body、duration（毫秒）

#### Scenario: 请求失败时的 debug 输出

- **WHEN** `debug: true` 且 HTTP 请求抛出错误
- **THEN** 输出请求日志包含 method、url、headers、body
- **THEN** 输出错误日志包含 method、url、error 信息、duration（毫秒）

### Requirement: 控制 body 输出

当 `debug` 配置 `logBody: false` 时，系统 SHALL 在日志中省略请求和响应的 body 部分。

#### Scenario: 关闭 body 输出

- **WHEN** `debug: { logBody: false }`
- **THEN** 请求日志不包含 body 字段
- **THEN** 响应日志不包含 body 字段

### Requirement: 控制 headers 输出

当 `debug` 配置 `logHeaders: false` 时，系统 SHALL 在日志中省略请求和响应的 headers 部分。

#### Scenario: 关闭 headers 输出

- **WHEN** `debug: { logHeaders: false }`
- **THEN** 请求日志不包含 headers 字段
- **THEN** 响应日志不包含 headers 字段

### Requirement: 自定义 logger 函数

当 `debug` 配置包含 `logger` 函数时，系统 SHALL 使用该函数替代包内 Logger 进行日志输出。

#### Scenario: 使用自定义 logger

- **WHEN** `debug: { logger: customFn }`
- **THEN** 所有 debug 日志通过 `customFn(message, meta)` 输出
- **THEN** 不调用包内 Logger

### Requirement: 未配置时无副作用

当 `debug` 未配置（`undefined`）时，系统 SHALL 不产生任何 HTTP 调试日志输出。

#### Scenario: debug 未配置

- **WHEN** `HttpClientConfig` 中未设置 `debug` 字段
- **THEN** 不输出任何请求/响应相关的日志（包括 URL、status 等简短日志）

### Requirement: Duration 计算

debug middleware SHALL 记录从请求发起到响应返回（或错误抛出）的耗时，单位为毫秒。

#### Scenario: 正常请求耗时记录

- **WHEN** `debug: true` 且请求耗时 150ms
- **THEN** 响应日志中 `duration` 字段值约为 `150`（允许合理误差）
