## Context

参见 [proposal.md](./proposal.md) 的 Why。当前 `@Cache` 在 Provider miss 后用同一个 `try/catch` 包围业务方法和正常结果写入：业务 Promise 拒绝时直接把 `{ error }` 交给 Provider，并复用正常 `ttl`。Memory Provider 保存对象引用，Redis Provider 则对整个条目执行普通 `JSON.stringify`，因此标准 `Error` 通常退化为 `{}`。Pending 请求由独立 Map 合并，并在 Promise fulfilled/rejected 后删除。

`@jintianxiayu/cache-decorator` 当前版本为 `1.0.0`，`CacheOptions` 只有 `ttl`、`providerName`、`key`，类型契约会冻结这些字段。项目使用 TypeScript legacy decorators，根配置已启用 `experimentalDecorators` 与 `emitDecoratorMetadata`；当前 `@Cache` 通过替换 `PropertyDescriptor.value` 工作，没有定义或读取 reflect-metadata key。本变更必须保持正常缓存 key、Provider 注册、连接所有权、正常值 Redis 协议和现有 fire-and-forget 写入边界。

## Goals / Non-Goals

**Goals:**

- 将持久化异常从隐式默认行为改为显式策略，并让无策略状态天然表示“只缓存正常结果”。
- 在装饰器边界解析并验证异常策略，使内部流程只接收可信的有限 TTL、完整 codec 和稳定回调。
- 让异常筛选、编码、命中解码、legacy 旁路与 pending 合并具有单一且可测试的执行顺序。
- 为标准 `Error` 提供 Memory/Redis 一致的基础往返，并允许领域方用 codec 恢复自定义错误语义。
- 在不泄露业务异常内容的前提下，让日志准确表达异常写入、策略跳过和策略失败。

**Non-Goals:**

- 不自动判断哪些数据库、HTTP、超时或领域异常值得缓存；分类责任仍由调用方的 `shouldCache` 承担。
- 不改变 `CacheProvider`、Redis 客户端适配器、连接生命周期、正常值 `{ value }` 协议、key 或淘汰 pattern。
- 不给存量 Redis 异常条目做全库扫描、批量迁移或自动删除。
- 不改变单 key 写入/删除的 fire-and-forget 等待边界，也不在本变更中治理所有既有异步写入 rejection。
- 不支持 stage-3 decorators，不新增 metadata key，也不扩展同步方法支持。
- 不修改 Logger 包、peerDependency、第三方依赖或 YAML 配置。

## Decisions

### 1. 使用可选策略对象，而不是两个松散字段

公共签名采用以下结构，并从包根导出新增类型：

```typescript
export interface CacheErrorCodec {
    encode(error: unknown): unknown;
    decode(payload: unknown): unknown;
}

export interface CacheErrorPolicy {
    ttl: number;
    shouldCache?: (error: unknown) => boolean;
    codec?: CacheErrorCodec;
}

export interface CacheOptions {
    ttl?: number;
    providerName?: string;
    key?: CacheKeyResolver;
    errorCache?: CacheErrorPolicy;
}
```

`errorCache` 省略即禁用；对象存在即启用且 `ttl` 必填。codec 自身包含 encode/decode 两个必需方法，从类型上避免只配置一半。`CacheEvictOptions` 继续只 Pick `key`，因此不会意外获得异常策略字段。

备选方案是新增 `cacheErrors?: boolean` 与 `errorTtl?: number`。该方案允许 `cacheErrors: false` 搭配 `errorTtl`、或启用后遗漏 TTL，还需要定义是否继承正常 TTL；这些无效或危险组合会进入运行期，因此不采用。另一个备选方案是只提供 `errorTtl` 并以其存在表示启用，但无法自然承载筛选和 codec。

### 2. 在 legacy decorator 求值边界归一化策略

`Cache(cacheName, options)` 在返回方法装饰器前，将外部策略解析为内部只读状态：

- `errorCache === undefined` 解析为禁用。
- `ttl` 必须是大于零的有限整数，否则立即抛出 `RangeError`。
- `shouldCache` 存在时必须是函数；`codec` 存在时 encode/decode 都必须是函数，否则 JavaScript 调用方得到 `TypeError`。
- 未提供 codec 时绑定默认 codec；内部执行路径不再反复判断 codec 是否存在。

这样非法配置在类定义阶段失败，不依赖某次业务异常才暴露。实现继续使用 legacy `PropertyDescriptor.value` 包装；不调用 `Reflect.defineMetadata/getMetadata`，不增加 metadata 结构。`experimentalDecorators` 仍是编译前提，`emitDecoratorMetadata` 维持项目现状但不是本能力运行所需。

备选方案是在第一次异常发生时再校验，优点是装饰器声明不会提前失败，缺点是无效配置可能潜伏到生产异常路径且不同 Provider 得到不同错误，因此不采用。

### 3. 拆开业务执行与缓存写入的异常边界

装饰器内部流程保持现有 key、pending、Provider 解析和读取顺序，但把业务执行的 `try/catch` 与正常值写入分离：

1. 生成 key 并优先复用 pending Promise。
2. 读取 Provider；基础设施错误原样传播，不进入异常策略。
3. `{ value }` 直接命中；异常条目按第 5 节分类。
4. miss 后只用一个窄 `try/catch` 包围原业务方法。
5. 正常完成时按既有 `ttl` 发起 `{ value }` 写入并返回结果。
6. 业务失败时执行异常策略，最后始终抛出本次业务产生的原始异常。

窄化 `try/catch` 可避免正常结果的同步 Provider 写入错误被误当成业务异常再次写入。异常缓存是原业务失败后的附属操作：同步可观察的异常条目写入失败会记录 Provider failure，但不得替换原业务异常；返回 Promise 的写入仍遵循现有 dispatched、不等待边界。

### 4. 筛选器采用 fail-closed 且不遮蔽业务异常

业务异常处理顺序固定为：检查策略 → 调用一次 `shouldCache` → encode 一次 → JSON 往返校验一次 → 发起 Provider 写入 → 抛出原业务异常。

- 无策略时直接记录 `disabled` 跳过并重新抛出。
- 显式策略未提供 `shouldCache` 时视为 `true`。
- 返回 `false` 时记录 `predicate_rejected`，不调用 codec 或 Provider。
- 筛选器抛出时记录 predicate failure，跳过缓存并重新抛出原业务异常。

不采用“筛选器失败时默认缓存”，因为它可能把调用方明确希望排除的瞬时故障持久化；也不传播筛选器异常，因为缓存策略不得遮蔽更早发生的业务失败。

### 5. 使用版本化 envelope 和成对 codec

正常条目继续保持 `{ value: T }`。异常条目在装饰器层转换为内部 envelope，概念结构如下：

```typescript
interface VersionedErrorPayload {
    kind: '@jintianxiayu/cache-decorator/error';
    version: 1;
    payload: unknown;
}

interface ErrorCacheEntry {
    error: VersionedErrorPayload;
}
```

实际常量集中定义，不作为新的 Provider API。外层仍保留 `{ error }`，旧读取方可以将其解析为普通 JSON 对象而不会破坏 key；新读取方以 kind/version 区分可信的新条目和 legacy 条目。

默认 codec 采用两种 payload：

- 标准 `Error`：保存 `name` 与 `message`，decode 时创建新的 `Error` 并恢复 name；不保存 stack、对象身份、自定义 prototype 或任意自有属性。
- 非 `Error`：仅接受可 JSON 往返的值，并按 JSON 表示恢复。`undefined`、函数、symbol、循环引用或往返失败均视为 encode failure。

无论使用 Memory、Redis 还是自定义 Provider，写入前都对完整 envelope 执行一次 JSON stringify/parse 校验，并把规范化后的值交给 Provider，避免 Memory 偶然支持 Redis 无法保存的状态。自定义 codec 可以把领域错误映射为稳定 DTO 并在命中时重建相应异常；共享 cache key 的所有新版本进程必须配置兼容 codec。

备选方案是继续缓存原始 `Error`，但它保留了 Provider 差异和 Redis `{}` 退化；另一个方案是只抛出统一通用错误，会破坏领域错误处理且无法由调用方恢复，因此均不采用。

### 6. 命中按当前策略和条目版本决定

Provider 返回值按以下顺序分类：

- `{ value }`：沿用现有成功命中。
- 当前版本异常 envelope 且策略启用：使用当前 codec decode；成功则作为 error hit 抛出，失败则记录 warn 并旁路为 miss。
- 当前版本异常 envelope 但策略禁用：记录 disabled-entry skip，并旁路为 miss。
- 没有当前 kind/version 的 legacy `{ error }`：不尝试猜测或 decode，记录 legacy-entry skip，并旁路为 miss。
- 其他不符合条目联合结构的值：保持现有 Provider 数据边界，不在本变更中扩展修复策略。

旁路不自动 delete，避免给每次读取增加新的未等待删除和混合版本竞争。后续业务成功会用正常值覆盖；业务失败且策略启用会写入新 envelope。禁用策略且业务持续失败时可能重复读取同一 legacy 条目，这是不自动迁移的可接受代价。

### 7. 日志只描述实际决策且不携带错误内容

新增两个内部稳定事件：

- `cache.error_cache_skipped`：`debug`，reason 为 `disabled`、`predicate_rejected`、`legacy_entry` 或 `disabled_entry`。
- `cache.error_cache_failed`：`warn`，phase 为 `predicate`、`encode` 或 `decode`。

只有真正调用 Provider set 后才沿用 `cache.write_dispatched`/`entryType: error`。有效异常命中继续使用 `cache.hit`/`entryType: error`；旁路条目不记录 hit，而是在 skipped 后进入 miss。策略或 codec 抛出的错误对象、原业务异常、codec payload、参数、返回值和 key 均不得进入 metadata。Logger 获取或写入继续由 `logCacheEvent` 隔离。

不复用 `cache.operation_failed`，因为该事件现有语义仅代表 Provider 或注册表基础设施失败；把调用方策略失败混入其中会误导告警和故障定位。

### 8. 发布范围保持在 cache 子包

只修改 `@jintianxiayu/cache-decorator`。不新增依赖；`@jintianxiayu/logger` 继续作为必需 peer 和 workspace devDependency，ioredis/node-redis 继续仅作为开发测试依赖。发布时增加该包的 major changeset，并更新包 README、根 README 摘要、CHANGELOG 生成输入及独立消费类型验证。

## Risks / Trade-offs

- [默认行为改变会让依赖异常负缓存的下游增加业务调用] → 按 major 发布，列出迁移示例，并在发布前由维护者确认/通知受影响下游。
- [调用方使用过宽筛选器仍可能缓存瞬时故障] → 默认关闭、TTL 强制有限，README 使用白名单示例并明确不应缓存网络、超时、限流和程序错误。
- [默认 codec 保存的 error message 可能含敏感数据] → 不保存 stack 或任意自有属性；文档要求敏感领域使用脱敏自定义 codec，日志永不输出 message/payload。
- [共享 key 的进程 codec 不一致导致 decode 失败] → decode fail-closed 为 miss 并记录稳定 phase；迁移说明要求相同 key 使用兼容 codec。
- [旧版本读取新 envelope 时会抛出未解码对象] → 采用两阶段部署，所有读取方升级完成前不启用 `errorCache`。
- [legacy 条目旁路但不删除会造成重复 miss] → 允许正常成功或显式 `CacheEvict` 覆盖/清理；不在读取路径增加隐式删除副作用。
- [fire-and-forget Provider 写入异步失败仍不代表成功] → 保留 `write_dispatched` 语义并在文档说明；该既有全局问题不随本变更扩张。

## Migration Plan

1. 为 `@jintianxiayu/cache-decorator` 创建 major changeset，并在发布说明标明：省略 `errorCache` 后业务异常不再持久化；缓存命中不再保证与首次调用具有同一异常对象身份。
2. 第一阶段将所有共享相同 cache key 的读取方升级到新 major，保持 `errorCache` 省略。新版本安全旁路 legacy 异常条目；正常值继续互操作。
3. 维护者确认依赖旧异常负缓存的下游清单。需要保留负缓存的调用方按方法增加有限 TTL、白名单 `shouldCache`，领域错误需要保真时同时配置兼容 codec。
4. 如已知存在无 TTL 的旧异常 key，部署窗口内通过现有精确 `CacheEvict` 或受控缓存清理处理；不得把全库 `clear()` 作为默认迁移步骤。
5. 所有读取方升级且 codec 配置一致后，第二阶段再启用 `errorCache`。混合新旧读取方期间不得写入新 envelope。
6. 回滚到旧 major 前，先停止新 envelope 写入并清理受影响的异常 key；已发布 npm 版本不假设可撤回，消费者可锁定旧 major 作为临时回退。
