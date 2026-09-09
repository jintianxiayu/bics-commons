## MODIFIED Requirements

### Requirement: 命令异常传播且不自动降级

适配器和 `RedisCacheProvider` 的直接调用 SHALL 传播客户端命令拒绝的原始错误。Redis 不可用、连接超时、非法 TTL 或扫描失败 MUST NOT 被 Provider 转换为 cache miss、写入成功或删除成功，也 MUST NOT 创建或切换到其他 Redis 或 Memory Provider。`@Cache` 和 `@CacheEvict` SHALL 在装饰器编排边界隔离这些可捕获错误并保留业务结果；本能力不设置额外超时、离线队列、重连或重试策略。

#### Scenario: E01 读取异常不是 cache miss

- **WHEN** 调用方直接读取 Provider，且 GET 命令因 Redis 不可用或连接超时而拒绝
- **THEN** Provider 以同一错误拒绝，不返回 `undefined`、不报告 cache miss

#### Scenario: E02 写入异常传播

- **WHEN** 直接调用 Provider 写入且 Redis 命令以错误拒绝
- **THEN** 写入调用以同一错误拒绝，不报告成功、不改用其他 Provider

#### Scenario: E03 删除或清库异常传播

- **WHEN** 直接调用 Provider 的精确删除、模式删除或数据库清理，且底层命令以错误拒绝
- **THEN** 对应直接调用以同一错误拒绝，不吞掉错误或继续报告完整清理成功

#### Scenario: E04 非法 TTL 在写入前被拒绝

- **WHEN** 调用方直接传入 Redis Provider 不接受的负数、非整数或非有限 TTL
- **THEN** Provider 以 `RangeError` 拒绝，不执行 Redis 写入、不替换为默认 TTL、不重试

#### Scenario: E05 真实连接不可用时不创建替代连接

- **WHEN** 已配置有限失败时间的调用方连接关闭或无法连接测试 Redis，调用方直接执行任一 Provider 操作
- **THEN** 调用在客户端自身失败边界内拒绝，不创建新的 ioredis、node-redis 或内存连接

#### Scenario: E06 @Cache 读取异常旁路 Redis

- **WHEN** `@Cache` 通过 Redis Provider 读取且 GET 命令同步抛出或异步拒绝
- **THEN** 装饰器不把错误当作正常 miss，也不切换 Provider，而是旁路本次后续缓存操作并执行业务方法一次
- **AND** 调用方收到业务方法的成功结果或原始业务异常，不收到 Redis 错误

#### Scenario: E07 装饰器写入与删除异常被隔离

- **WHEN** `@Cache` 回填或 `@CacheEvict` 淘汰所触发的 Redis 命令同步抛出或异步拒绝
- **THEN** 装饰器记录并消费该错误，保留原业务结果或原始业务异常
- **AND** Redis Provider 的直接调用错误语义、连接所有权和数据协议保持不变

### Requirement: 装饰器异常条目跨客户端及版本互操作

`@Cache` 显式启用异常缓存后写入 Redis 的异常条目 SHALL 使用客户端无关、带版本标识且可 JSON 往返的表示；ioredis、node-redis 和符合 `RedisCacheClient` 契约的自定义适配器 MUST 能共享该表示。正常值协议、物理 key、客户端连接所有权和通用 `RedisCacheProvider` 的字符串/JSON 规则 MUST 保持不变。

#### Scenario: 标准 Error 跨客户端往返

- **WHEN** ioredis 路径使用默认 codec 写入标准 `Error` 异常条目，再由 node-redis 路径读取相同物理 key，或反向执行
- **THEN** 新版本装饰器识别同一异常条目版本，并恢复具有相同 `name` 与 `message` 的新 `Error`
- **AND** 不要求任一 Redis 客户端理解装饰器内部异常语义

#### Scenario: 自定义 codec 跨进程往返

- **WHEN** 共享同一 cache key 的新版本进程配置兼容的自定义 codec，并通过不同 Redis 客户端写入和读取领域异常
- **THEN** 读取进程将 JSON payload 交给当前 codec 解码并抛出解码结果
- **AND** 客户端适配器不增加专属包装、不修改 payload，也不加载领域异常类型

#### Scenario: 新版本旁路旧异常条目

- **WHEN** 新版本读取到旧版本写入、没有当前版本标识的 `{ error }` 条目
- **THEN** 装饰器将其视为 miss，不把可能已丢失信息的 payload 作为业务异常抛出
- **AND** 业务成功时正常值可以覆盖该 key，业务失败时仅按当前异常策略决定是否写入版本化条目

#### Scenario: 禁用策略时不消费异常条目

- **WHEN** 当前装饰器未配置异常缓存策略，但 Redis 中存在旧版或新版异常条目
- **THEN** 装饰器旁路该条目并执行业务方法
- **AND** 正常 `{ value }` 条目仍按既有规则命中

#### Scenario: 混合版本读取新异常条目

- **WHEN** 新版本在 Redis 写入版本化异常条目，而仍在运行的旧版本读取同一物理 key
- **THEN** 旧版本仍能把该值解析为合法 JSON 且不得破坏 Redis key 或正常值协议，但可能按旧逻辑抛出未解码的 envelope 对象
- **AND** 发布说明 MUST 要求共享异常 cache key 的读取方完成升级后再启用新异常缓存策略

#### Scenario: 错误 payload 不可序列化

- **WHEN** 默认或自定义 codec 产生不能 JSON 往返的 payload
- **THEN** 装饰器在调用 Redis Provider 写入前跳过异常缓存并传播原业务异常
- **AND** Redis 客户端不收到部分异常值写入，现有 key 保持不变

#### Scenario: Redis 读取失败保持 Provider 直接传播与装饰器隔离

- **WHEN** 读取异常条目时 Redis 不可用、连接超时或客户端命令拒绝
- **THEN** Provider 直接调用以原始错误拒绝；装饰器不尝试 codec、不把故障记录为正常业务 miss，并旁路本次后续缓存操作
- **AND** 装饰器不切换客户端、连接或 Memory Provider，执行业务方法一次并保留业务结果或原始业务异常
