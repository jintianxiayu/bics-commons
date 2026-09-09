## Why

`@Cache` 当前会无条件缓存业务方法抛出的所有异常，并沿用正常结果的 TTL；这会把数据库、网络或超时等瞬时故障放大为持续失败，未配置 TTL 时还可能长期保留。Redis 对原生 `Error` 的普通 JSON 序列化又会丢失名称、消息、堆栈及类型信息，因此需要把异常缓存改为显式、短时、可筛选且跨 Provider 行为明确的策略。

## What Changes

- **BREAKING**：`@Cache` 未配置异常缓存策略时不再向 Provider 持久化业务异常；相同 key 的并发调用仍复用同一个 pending Promise，并在该 Promise settled 后清理。
- 为 `CacheOptions` 增加可选的 `errorCache` 策略对象；对象存在即表示启用异常缓存，并要求配置独立的正整数秒级 `ttl`，不允许 `0`、负数、非整数或非有限值。
- `errorCache` 支持可选的异常筛选回调，只允许调用方选择稳定、可安全复用的业务异常；回调未提供时，在显式启用策略的前提下缓存全部业务异常。策略同时允许提供成对的错误 codec，以便需要保留领域错误语义的调用方控制安全序列化与还原。
- 异常缓存只处理被装饰业务方法的 throw/rejection；Provider、注册表、key resolver 和 Logger 失败不得进入异常缓存。
- 正常结果继续使用 `CacheOptions.ttl`，异常条目只使用 `errorCache.ttl`；筛选未通过或筛选回调自身失败时不写入异常条目，并保持原始业务异常传播。
- 为异常条目定义 Provider 无关、可 JSON 往返的版本化表示，避免 Redis 将原生 `Error` 静默退化为空对象；新版本读取既有异常条目时保持兼容，禁用异常缓存时不得继续消费存量异常条目。
- 调整缓存决策日志，使其只在实际发起异常写入时记录 `cache.write_dispatched`/`entryType: error`，并能区分按策略跳过与策略回调失败，同时继续禁止记录业务异常内容、缓存值和完整 key。
- 更新单元测试、Redis 互操作测试、公共类型契约、README 和发布 changeset，覆盖默认关闭、显式开启、独立 TTL、筛选、存量条目及并发拒绝语义。

## Capabilities

### New Capabilities

- `cache-error-policy`: 定义 `@Cache` 对业务异常的显式缓存策略、独立 TTL、可选筛选、pending 边界以及错误条目的跨 Provider 语义。

### Modified Capabilities

- `cache-operation-logging`: 调整异常回填、跳过决策、公共 `CacheOptions` 契约和日志敏感信息边界。
- `redis-cache-client`: 定义版本化异常条目的 JSON 往返、存量异常条目读取及新旧版本共存边界，同时保持正常值协议不变。

## Impact

- **公共契约变更：是。** `CacheOptions` 和包根 `.d.ts` 将新增异常缓存策略相关公共类型；省略配置时由“缓存全部业务异常”改为“不持久化业务异常”，且 Redis 缓存命中的异常表示会被规范化，因此属于默认行为与错误语义不兼容变更。
- **兼容性结论：不兼容。** 破例理由是现有默认行为会缓存瞬时故障并可能永久放大失败，继续兼容该默认值与本变更的安全目标冲突。依赖现有异常负缓存的下游必须显式配置 `errorCache` 并选择 TTL；已知受影响下游清单及通知对象待维护者确认，实施或发布前需要下游确认或通知。
- 受影响包为 `@jintianxiayu/cache-decorator`，当前版本为 `1.0.0`；按照仓库规则需要 **major changeset**。
- 主要影响 `packages/cache-decorator/src/decorators/cache.ts`、缓存日志事件与上下文、公共导出、类型契约和相关测试；`CacheEvictOptions`、`CacheProvider` 方法签名、key 生成、Provider 选择和连接生命周期不变。
- Redis 物理 key、正常 `{ value }` 条目、秒级 TTL、客户端适配及淘汰 pattern 保持不变；异常 `{ error }` 条目将采用带版本标识的 JSON 安全内容。要求新版本读取既有异常条目，禁用策略时旁路存量异常条目；不强制批量迁移或清理，但混合部署期间旧版本无法完整理解新异常表示的限制必须写入迁移说明。
- 不新增或改变第三方依赖、peerDependency、HTTP 协议、日志 transport 或 YAML 配置结构。
