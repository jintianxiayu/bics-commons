## Why

缓存用于增强依赖方可用性，但当前 `@Cache` 和 `@CacheEvict` 会在部分 Provider 解析、读取、写入或淘汰失败时阻断调用，甚至在业务已经成功后把结果改写为缓存异常。需要将装饰器统一为固定的 fail-open 语义，使所有可捕获的缓存基础设施异常只降低缓存效果，不改变主营业务的执行结果。

## What Changes

- **BREAKING**：`@Cache` 在 Provider 解析或读取失败时记录基础设施错误并旁路缓存，继续执行被装饰业务方法，不再向调用方传播 Provider 错误。
- **BREAKING**：`@Cache` 在正常结果回填同步失败或异步拒绝时记录错误并保留业务结果；异常缓存写入失败继续保留原业务异常。
- **BREAKING**：`@CacheEvict` 在业务成功后的 Provider 解析、单 key 删除或 `allEntries` 删除失败时记录错误并返回原业务结果，不再用淘汰异常替换业务成功。
- 消费所有 fire-and-forget 缓存写入和单 key 删除 Promise 的 rejection，避免缓存异常成为未处理 Promise rejection；保持既有调用不等待这些 Promise 的时序。
- 不新增 fail-open 配置项；该行为对 Memory、Redis 和自定义 `CacheProvider` 统一生效。
- 保持直接调用 `CacheProvider`/`RedisCacheProvider` 时的异常传播，不增加 Provider 切换、重试、超时、熔断或 Memory 容量治理。
- 保持现有 key、TTL、序列化、异常 envelope、Redis 物理数据、Provider 注册方式和 Logger 元数据边界不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cache-operation-logging`：修改 Provider 解析、读取、写入和淘汰失败时的装饰器结果及异步 rejection 观测语义。
- `cache-error-policy`：Provider 解析或读取失败不再阻断业务，也不进入异常缓存策略。
- `cache-evict-allentries-prefix`：`@CacheEvict(allEntries)` 淘汰失败不再替换已完成的业务结果，同时保留 Provider 直接调用的异常传播。
- `redis-cache-client`：明确区分 Redis Provider 直接调用的 fail-fast 契约与装饰器编排层的固定 fail-open 契约。

## Impact

- 受影响代码：`packages/cache-decorator/src/decorators/cache.ts`、`packages/cache-decorator/src/decorators/cache-evict.ts` 及相关测试和 README；Redis/Memory Provider 本身无需改变错误传播契约。
- 公共 API 变更：否。公共导出、公共 TypeScript 类型、函数签名和选项字段均不变。
- 公共契约变更：是。默认错误与降级语义从部分 fail-fast 改为装饰器统一 fail-open；源码和类型兼容，但依赖旧版 Provider 异常拒绝进行告警、重试或事务回滚的下游会观察到不同结果，因此运行时行为不兼容。
- 破例理由：缓存基础设施不应成为主营业务的强依赖，业务成功不能因缓存读取、回填或淘汰异常而被报告为失败。
- 发布影响：当前包版本为 `1.0.1`，维护者基于公共 API 未调整明确决定按 `patch` changeset 发布，计划版本为 `1.0.2`。这是对仓库“破坏性契约变更使用 major”默认规则的显式例外；已知受影响下游与通知时点待维护者确认，正式发布前仍需说明异常语义迁移，不能把装饰器 rejection 继续作为缓存故障信号。
- 依赖影响：不新增或变更第三方依赖、peerDependency 或运行时安装责任。
- 跨进程与数据影响：Redis key/value、TTL、序列化、异常 envelope 和物理前缀协议均不变，无存量数据迁移；新旧版本可以共享缓存数据，但同一 Provider 故障下会呈现不同的调用结果。
- 日志影响：沿用 `cache.operation_failed` 及现有白名单元数据；新增对异步写入和单 key 删除 rejection 的错误日志，不新增业务参数、返回值、完整 key/value 或新的日志配置。
- 范围外：Provider 永久 pending 的统一超时策略、自动重试、熔断、替代 Provider，以及 Memory Provider 容量和 OOM 治理。
