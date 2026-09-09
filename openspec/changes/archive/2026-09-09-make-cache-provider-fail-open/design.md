## Context

参见 [proposal.md](./proposal.md) 的动机。当前装饰器编排存在三种不同失败边界：Provider 解析和读取在业务执行前传播；正常结果同步写入失败以及 `allEntries` 淘汰失败会在业务成功后传播；异步写入和单 key 删除 rejection 则未被消费。与此同时，`RedisCacheProvider` 的直接调用需要继续向显式调用方报告真实命令错误。

本设计只调整 `@Cache` 与 `@CacheEvict` 的编排层。现有 Provider 接口允许同步返回或 Promise 返回，Logger 已提供不会影响调用结果的 `logCacheEvent` 边界，因而无需修改 Provider、Redis 适配器或引入依赖。

## Goals / Non-Goals

**Goals:**

- 用单一、不可配置的 fail-open 规则隔离所有可捕获的 Provider 解析及操作异常。
- 保证业务方法的成功值、对象身份和原始 rejection reason 不被缓存异常替换。
- 消费 fire-and-forget 操作的异步 rejection，同时保持其不等待时序。
- 保持缓存命中、业务异常缓存、pending 请求合并和 Provider 直接调用契约可区分且可测试。

**Non-Goals:**

- 不处理 V8 致命 OOM、进程终止或无法进入 JavaScript 异常边界的故障。
- 不增加统一超时、重试、熔断、离线队列、替代 Provider 或 Memory 容量治理。
- 不改变 Redis key/value、TTL、序列化、异常 envelope、扫描模式或连接生命周期。
- 不增加公共配置、公共类型、导出或第三方依赖。

## Decisions

### 1. fail-open 只存在于装饰器编排层

`CacheProvider`、`RedisCacheProvider` 及适配器继续 fail-fast：调用方直接 `await provider.get/set/delete/deleteByPattern/clear` 时得到原始错误。`@Cache` 和 `@CacheEvict` 负责把同一错误隔离在缓存边界内。

选择该边界是因为装饰器知道主营业务结果，而 Provider 不知道自己由装饰器还是管理命令调用。若在 Provider 内吞错，直接清理、诊断和集成代码会失去失败信号。

备选方案是在 Provider 内统一吞错并返回 miss/void；该方案会把真实 Redis 故障伪装成成功并破坏直接调用契约，因此不采用。

### 2. `@Cache` 使用显式查找结果区分 miss 与 bypass

缓存查找在内部表示为互斥状态：

- `hit`：取得可消费的缓存条目，沿用 value/error 命中逻辑；
- `miss`：Provider 正常返回未命中，执行业务后允许向同一 Provider 回填；
- `bypass`：Provider 解析或读取失败，记录 `cache.operation_failed`，执行业务但禁止本次后续正常或异常缓存写入。

实现应使用带判别字段的内部联合类型或等价的清晰分支，使 bypass 状态不能意外携带可写 Provider。这样可避免把读取故障记录为 `cache.miss`，也避免在已知异常的 Provider 上继续回填。

有效的版本化异常缓存命中仍代表先前业务结果，而不是 Provider 故障，因此继续按策略解码并向调用方抛出；非法或不可解码条目继续按既有规则旁路为正常 miss。

备选方案是在读取 catch 中简单令 `cached = undefined`；该方案无法区分正常 miss 与基础设施失败，随后会误报 miss 并再次写入故障 Provider，因此不采用。

### 3. 所有写入和单 key 删除统一观测同步及异步失败

非 `async` 的内部 dispatch helper 负责：

1. 在 `try/catch` 中调用 Provider，捕获同步异常并记录 `cache.operation_failed`；
2. 仅在同步调用成功返回后记录既有 dispatched 事件；
3. 当返回值是 Promise 时附加 rejection handler，记录同一 operation 并消费 rejection；
4. 不等待 Promise，不把失败重新抛回装饰器调用。

正常结果回填与异常条目写入复用写入 helper；两者的差别只在业务结果：前者保留成功值，后者保留原始业务异常。单 key 淘汰使用等价 helper 并保留 `cache.evict_dispatched` 时序。

备选方案是等待所有写入和删除；该方案会把缓存延迟加入主营业务延迟，并改变既有 fire-and-forget 契约，因此不采用。继续完全忽略 Promise rejection 会保留进程级未处理 rejection 风险，也不采用。

### 4. `allEntries` 保留等待顺序但吞掉淘汰失败

`@CacheEvict(allEntries)` 继续在业务成功后等待 `deleteByPattern`，成功时才记录 `cache.evict_completed`。同步抛出或异步拒绝时记录 `cache.operation_failed` 并返回已经取得的业务结果。

这保留了成功响应前完成全量淘汰的既有顺序，同时满足错误不得替换业务成功。它不解决 Provider 永久 pending；超时仍由调用方拥有的 Redis client 或自定义 Provider 决定。

备选方案是把全量淘汰改成 fire-and-forget；该方案会改变成功时序并扩大陈旧缓存窗口，本次不采用。

### 5. `@CacheEvict` 先确定业务结果，再隔离全部缓存准备和操作

业务方法失败时继续立即记录 `cache.evict_skipped` 并传播同一业务异常，不解析 Provider、不求值淘汰 key。业务成功后，Provider 解析、key 生成后的删除和 `allEntries` 删除均不得替换该结果。Provider 解析失败时不求值 key resolver，避免无意义副作用。

缓存淘汰失败可能留下陈旧数据，但用户已确认主营业务可用性优先于缓存一致性。系统以 `cache.operation_failed` 暴露该状态，不在库内自动重试。

### 6. 公共 TypeScript 与 legacy decorator 契约不变

继续采用 TypeScript legacy method decorator，通过修改 `PropertyDescriptor.value` 包装原方法；调用方仍需启用 `experimentalDecorators`。不引入 stage-3 decorator 语义，不新增或修改 reflect-metadata key，也不依赖新的元数据结构；`emitDecoratorMetadata` 的现有设置不因本变更改变。

公共签名保持：

- `Cache(cacheName: string, options?: CacheOptions)`；
- `CacheEvict(cacheName: string, options?: CacheEvictOptions)`；
- `CacheOptions`、`CacheEvictOptions` 和 `CacheProvider` 不增加字段或方法。

返回 Promise、pending Promise 身份和泛型推导保持不变。fail-open 是固定运行时语义，不通过布尔参数或选项控制。

### 7. 日志只扩展既有失败事件的触发时点

继续使用 `cache.operation_failed` 与现有 `provider_resolution`、`read`、`write`、`evict` operation。异步 write/delete rejection 在发生时补记错误；不新增事件名、配置或元数据字段。日志仍不得包含方法参数、业务结果、缓存值、完整 key、异常缓存 payload 或业务异常内容，Logger 自身失败继续被隔离。

### 8. 不改变依赖与数据契约

`reflect-metadata` dependency、`@jintianxiayu/logger` peer/devDependency 以及 ioredis/node-redis devDependency 分类和版本范围均保持不变。只有 `@jintianxiayu/cache-decorator` 需要发布 patch；其他包不需要同步发布。

## Risks / Trade-offs

- [淘汰失败后可能继续读取陈旧缓存] -> 保留 `cache.operation_failed` 作为告警信号；库内不伪造完成、不自动重试，依赖方可在运维层处理。
- [Redis 故障时所有 miss 流量进入主营业务] -> 同 key 调用继续由 `PendingCache` 合并；不在缓存库内重试或切换 Provider，避免进一步放大缓存压力。
- [异步 rejection 日志晚于业务返回] -> 使用原 LoggerContext 可用的异步上下文记录；测试验证 rejection 已消费且业务 Promise 已按原结果完成。
- [固定 fail-open 隐藏了依赖旧 rejection 的控制流，且兼容版本范围可能自动接收该 patch] -> 在 `1.0.2` 迁移说明中醒目标注运行时错误语义变化，发布前确认已知下游并要求改用缓存错误日志/监控，不再依赖装饰器 rejection。
- [全量淘汰仍可能受 Provider 超时拖延] -> 保留现有等待语义和调用方连接所有权；统一超时属于范围外能力。
- [自定义 Provider 可能返回非标准 thenable] -> 只承诺 `CacheProvider` 声明的 `void | Promise<void>`；测试覆盖同步返回、同步抛出、Promise resolve/reject。

## Migration Plan

1. 在 `1.0.2` 发布说明中列出 `@Cache` 读取/解析失败与 `@CacheEvict` 淘汰失败不再拒绝调用，并说明应通过 `cache.operation_failed` 监控缓存故障。
2. 发布前由维护者确认已知下游清单和通知时点；依赖装饰器 rejection 执行重试、事务回滚或报警的下游必须先迁移。
3. 新旧版本无需调整 Redis 数据或发布顺序，可以共享现有 key/value；混合版本期间相同缓存故障会产生不同调用结果，需要按实例版本识别。
4. 为 `@jintianxiayu/cache-decorator` 添加 patch changeset，从 `1.0.1` 计划升级至 `1.0.2`，不联动修改其他包版本；记录这是维护者因公共 API 不变而批准的版本级别例外。
5. 若需要回滚，依赖方锁定并重新部署 `1.0.1`；无需清理或迁移 Redis 数据。已发布的 `1.0.2` 不假设可以撤回。
