## ADDED Requirements

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

#### Scenario: Redis 读取失败仍按基础设施错误传播

- **WHEN** 读取异常条目时 Redis 不可用、连接超时或客户端命令拒绝
- **THEN** Provider 和装饰器按既有基础设施错误语义拒绝，不尝试 codec、不转换为策略旁路或业务 miss
- **AND** 不切换客户端、连接或 Memory Provider
