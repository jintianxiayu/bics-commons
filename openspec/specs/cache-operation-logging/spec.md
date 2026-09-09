## Purpose

定义 `@Cache` 与 `@CacheEvict` 在关键缓存决策节点通过统一命名 Logger 输出结构化日志的行为，使依赖方能够区分命中、未命中、请求合并、回填、淘汰与基础设施失败，同时不改变缓存调用的既有结果和时序。

## Requirements

### Requirement: 固定命名 Logger 与日志级别

缓存装饰器 SHALL 将日志提交给 `@jintianxiayu/logger` 中名称固定为 `@jintianxiayu/cache-decorator` 的 Logger。正常缓存决策以及按已配置策略跳过异常缓存 MUST 使用 `debug`，发生降级但调用仍可继续、异常策略回调或 codec 失败、或淘汰因业务失败被跳过时 MUST 使用 `warn`，导致对应缓存操作失败的 Provider 或注册表异常 MUST 使用 `error`；系统 MUST NOT 使用 `info` 记录逐调用缓存事件，也 MUST NOT 使用 `console` 或自行创建其他日志传输。

#### Scenario: 正常缓存决策使用 debug

- **WHEN** 发生 pending 请求复用、缓存命中、缓存未命中、缓存写入已发起、按配置禁用或筛选结果跳过异常缓存、单 key 淘汰已发起或全量淘汰已完成
- **THEN** 系统通过命名 Logger 的 `debug` 方法提交对应结构化日志
- **AND** 不调用该 Logger 的 `info`、`warn` 或 `error` 方法记录同一正常事件

#### Scenario: 可恢复回退与淘汰跳过使用 warn

- **WHEN** 自定义 key resolver 抛出异常并回退默认 key、异常筛选器或错误 codec 失败后跳过异常缓存，或 `@CacheEvict` 装饰的业务方法失败而不执行淘汰
- **THEN** 系统通过命名 Logger 的 `warn` 方法提交对应结构化日志
- **AND** 原有回退、业务异常传播或淘汰跳过行为保持不变

#### Scenario: 缓存基础设施失败使用 error

- **WHEN** Provider 无法解析、缓存读取失败、同步可观察的写入或单 key 删除调用失败，或等待中的全量淘汰失败
- **THEN** 系统通过命名 Logger 的 `error` 方法提交失败日志
- **AND** 装饰器按固定 fail-open 语义保留业务结果或原始业务异常，不把基础设施失败记录为 cache miss、命中、写入成功或淘汰完成

#### Scenario: Logger 配置筛选输出

- **WHEN** 应用通过 `@jintianxiayu/logger` 对名称 `@jintianxiayu/cache-decorator` 配置 level、console 或 file transport
- **THEN** 缓存日志按照该命名 Logger 的既有筛选与路由规则输出
- **AND** 缓存包不维护第二套 level 或 transport 开关

### Requirement: @Cache 缓存决策日志

`@Cache` SHALL 为每次实际发生的关键缓存决策提交具有稳定 `event` 的结构化日志。日志 MUST 准确区分 pending 请求复用、Provider 值命中、可用异常命中、缓存未命中、业务结果回填、异常回填、按策略跳过异常缓存及异常策略失败，不得把请求合并或异常旁路描述为 Provider 命中，也不得把已发起的写入描述为写入成功。

#### Scenario: C01 并发调用复用 pending 请求

- **WHEN** 相同逻辑 cache key 已存在尚未完成的 pending Promise，后续并发调用复用该 Promise
- **THEN** 后续调用提交 `debug` 日志且 `event` 为 `cache.pending_hit`
- **AND** 该调用不额外提交 `cache.hit` 或 `cache.miss`，不重复读取 Provider、执行业务方法或发起缓存写入

#### Scenario: C02 命中成功缓存条目

- **WHEN** Provider 读取返回成功缓存条目
- **THEN** 系统在返回缓存值前提交 `debug` 日志且 `event` 为 `cache.hit`、`entryType` 为 `value`
- **AND** 不执行被装饰业务方法

#### Scenario: C03 命中异常缓存条目

- **WHEN** 当前装饰器启用异常缓存，且 Provider 返回可由当前 codec 解码的版本化异常条目
- **THEN** 系统在抛出解码结果前提交 `debug` 日志且 `event` 为 `cache.hit`、`entryType` 为 `error`
- **AND** 不把该异常命中记录为 Provider 基础设施失败，不再次执行被装饰业务方法

#### Scenario: C04 未命中后回填业务结果

- **WHEN** Provider 返回 miss 或异常条目被当前策略安全旁路，且被装饰业务方法成功完成
- **THEN** 系统提交 `cache.miss`，调用 Provider 写入业务结果后提交 `cache.write_dispatched`、`entryType` 为 `value`
- **AND** 返回原业务结果

#### Scenario: C05 未命中后回填业务异常

- **WHEN** Provider 未命中，被装饰业务方法以异常拒绝，且异常策略接受并成功编码该异常
- **THEN** 系统先提交 `cache.miss`，调用 Provider 写入异常条目后提交 `cache.write_dispatched`、`entryType` 为 `error`
- **AND** 重新抛出同一业务异常，不额外把业务异常记录为缓存基础设施 `error`

#### Scenario: 按配置跳过异常缓存

- **WHEN** 业务方法以异常拒绝，且异常策略未启用或筛选器返回 `false`
- **THEN** 系统提交 `debug` 日志且 `event` 为 `cache.error_cache_skipped`，`reason` 分别标识 `disabled` 或 `predicate_rejected`
- **AND** 不提交 `cache.write_dispatched`、不记录业务异常内容，并重新抛出原业务异常

#### Scenario: C07 旁路存量或禁用的异常条目

- **WHEN** Provider 返回存量未版本化异常条目，或当前策略禁用时返回版本化异常条目
- **THEN** 系统提交 `cache.error_cache_skipped`，`reason` 分别标识 `legacy_entry` 或 `disabled_entry`，随后提交 `cache.miss`
- **AND** 不提交 `cache.hit`，并按 miss 流程执行业务方法

#### Scenario: C08 异常策略或 codec 失败

- **WHEN** 异常筛选器、encode 或 decode 抛出异常，或 encode 输出不能安全 JSON 往返
- **THEN** 系统提交 `warn` 日志且 `event` 为 `cache.error_cache_failed`，并以 `phase` 区分 `predicate`、`encode` 或 `decode`
- **AND** 日志不包含策略异常、业务异常或错误 payload；写入侧仍抛出原业务异常，读取侧按 miss 继续

#### Scenario: C06 重复调用只记录实际决策

- **WHEN** 同一 key 首次调用 miss 并按当前策略写入 value 或 error，后续调用读取到可用条目
- **THEN** 首次调用记录一次 `cache.miss` 和一次 `cache.write_dispatched`，后续每次实际可用 Provider 命中各记录一次 `cache.hit`
- **AND** 日志功能不增加额外读取、重复写入或业务方法调用

### Requirement: @CacheEvict 淘汰决策日志

`@CacheEvict` SHALL 在业务方法成功后记录实际选择的淘汰范围，并在业务方法失败时明确记录淘汰被跳过。系统 MUST 区分单 key 淘汰已发起与 `allEntries` 淘汰已完成，不得在业务方法失败或淘汰失败后报告完成。

#### Scenario: E01 单 key 淘汰已发起

- **WHEN** 被装饰业务方法成功且 `allEntries` 未启用，Provider 的单 key 删除调用已返回控制权
- **THEN** 系统提交 `debug` 日志且 `event` 为 `cache.evict_dispatched`、`scope` 为 `key`
- **AND** 返回原业务结果，不把未等待的删除描述为已完成

#### Scenario: E02 allEntries 淘汰完成

- **WHEN** 被装饰业务方法成功且 `allEntries: true`，Provider 的 `deleteByPattern` 正常完成
- **THEN** 系统提交 `debug` 日志且 `event` 为 `cache.evict_completed`、`scope` 为 `allEntries`
- **AND** 返回原业务结果

#### Scenario: E03 业务方法失败时跳过淘汰

- **WHEN** `@CacheEvict` 装饰的业务方法以异常拒绝
- **THEN** 系统在重新抛出同一异常前提交 `warn` 日志且 `event` 为 `cache.evict_skipped`、`reason` 为 `business_error`
- **AND** 不解析 Provider、不生成淘汰 key，也不执行单 key 或全量淘汰

#### Scenario: E04 重复淘汰保持原幂等语义

- **WHEN** 同一淘汰方法被重复调用且底层 Provider 将重复删除视为成功
- **THEN** 每次调用分别记录与实际范围一致的 `cache.evict_dispatched` 或 `cache.evict_completed`
- **AND** 日志功能不增加额外删除、不创建 key，也不改变底层 Provider 的幂等性

### Requirement: key resolver 回退日志

当 `@Cache` 或单 key `@CacheEvict` 的自定义 key resolver 抛出异常时，系统 SHALL 在沿用现有默认 key 回退行为的同时提交 `warn` 日志，且 MUST NOT 因日志功能改变 resolver 的调用次数、回退结果或异常隔离语义。`allEntries: true` 继续忽略 key 选项，不调用 resolver，也不产生 key 回退日志。

#### Scenario: K01 @Cache key resolver 失败后回退

- **WHEN** `@Cache` 的自定义 key resolver 抛出异常
- **THEN** 系统提交 `warn` 日志且 `event` 为 `cache.key_fallback`
- **AND** 使用 `KeyBuilder.build(cacheName, args)` 的既有结果继续缓存流程

#### Scenario: K02 单 key 淘汰 resolver 失败后回退

- **WHEN** 单 key `@CacheEvict` 的业务方法成功但自定义 key resolver 抛出异常
- **THEN** 系统提交 `warn` 日志且 `event` 为 `cache.key_fallback`
- **AND** 使用默认 key 发起一次删除

#### Scenario: K03 allEntries 不求值 key resolver

- **WHEN** `@CacheEvict` 配置 `allEntries: true` 且同时提供会抛出异常的 key resolver
- **THEN** 系统不调用该 resolver、不提交 `cache.key_fallback`
- **AND** 仍按缓存名称前缀执行全量淘汰

### Requirement: 缓存失败与正常 miss 明确区分

系统 SHALL 为缓存基础设施失败提交 `cache.operation_failed` 事件，并以 `operation` 标识失败阶段。装饰器 MUST 固定采用 fail-open 语义：任何可捕获的 Provider 解析、读取、写入或淘汰失败均不得替换被装饰业务方法的成功结果或原始业务异常。缓存失败 MUST NOT 被记录为正常 miss、命中、写入成功或淘汰完成，也 MUST NOT 触发内存 Provider、其他 Provider、重试或额外缓存操作。

#### Scenario: F01 默认或指定 Provider 不存在

- **WHEN** `@Cache` 在业务执行前或 `@CacheEvict` 在业务成功后无法从注册表取得默认或指定 Provider
- **THEN** 系统提交 `error` 日志且 `event` 为 `cache.operation_failed`、`operation` 为 `provider_resolution`
- **AND** `@Cache` 执行业务方法一次，`@CacheEvict` 保留已完成的业务结果，不执行缓存读写或替代 Provider 操作

#### Scenario: F02 Redis 读取不可用或超时

- **WHEN** `@Cache` 的 Provider 读取因 Redis 不可用、连接超时或其他基础设施异常而同步抛出或异步拒绝
- **THEN** 系统提交 `error` 日志且 `event` 为 `cache.operation_failed`、`operation` 为 `read`
- **AND** 不提交 `cache.miss`、不切换 Provider、不回填本次缓存，执行业务方法一次并保留其成功结果或原始业务异常

#### Scenario: F03 allEntries 扫描或删除失败

- **WHEN** `@CacheEvict(allEntries)` 的业务方法已成功，但 `deleteByPattern` 因任一 SCAN 页面或批量删除失败而同步抛出或异步拒绝
- **THEN** 系统提交 `error` 日志且 `event` 为 `cache.operation_failed`、`operation` 为 `evict`
- **AND** 不提交 `cache.evict_completed`，调用仍返回原业务结果且不重试或切换 Provider

#### Scenario: F04 非等待写入只报告已发起

- **WHEN** `@Cache` 的 Provider `set` 返回 Promise，且该 Promise 随后因 Redis 写入、非法 TTL、序列化或其他缓存异常而拒绝
- **THEN** 装饰器先按既有时序提交 `cache.write_dispatched`，拒绝发生后再提交 `cache.operation_failed` 且 `operation` 为 `write`
- **AND** 装饰器消费该 rejection，不等待、重试或切换 Provider，调用方仍收到原业务结果或原业务异常

#### Scenario: F05 非等待单 key 删除只报告已发起

- **WHEN** 单 key `@CacheEvict` 的 Provider `delete` 返回 Promise 且随后拒绝
- **THEN** 装饰器先按既有时序提交 `cache.evict_dispatched`，拒绝发生后再提交 `cache.operation_failed` 且 `operation` 为 `evict`
- **AND** 装饰器消费该 rejection，不等待、重试或切换 Provider，调用方仍收到原业务结果

#### Scenario: F06 同步写入或单 key 删除失败

- **WHEN** 正常结果回填的 Provider `set` 或单 key Provider `delete` 在调用当下同步抛出异常
- **THEN** 系统提交对应 `write` 或 `evict` 的 `cache.operation_failed`，不提交相应 dispatched 事件
- **AND** 装饰器吞掉缓存异常并保留原业务结果

#### Scenario: F07 异常缓存写入失败

- **WHEN** 业务方法先失败且异常缓存 Provider `set` 随后同步抛出或异步拒绝
- **THEN** 系统提交 `cache.operation_failed` 且 `operation` 为 `write`，异步 rejection 必须被消费
- **AND** 调用方仍收到业务方法产生的原始异常，不收到缓存写入异常

### Requirement: 结构化上下文与敏感信息边界

每条缓存日志 SHALL 至少包含稳定的 `event`、`cacheName`、`methodName` 和 `providerName` 元数据，其中未显式指定 Provider 时 `providerName` 使用稳定的 `default` 标识。事件 MAY 按场景增加 `entryType`、`scope`、`reason`、`phase`、`operation` 或基础设施 `error`；系统 MUST NOT 将方法参数、业务返回值、缓存值、异常缓存中的业务异常内容、错误 codec payload、异常策略回调错误或完整逻辑及物理 cache key 放入缓存日志。Logger 上下文中已有的 `traceId` SHALL 继续由 `@jintianxiayu/logger` 的既有机制关联和脱敏。

#### Scenario: M01 显式与默认 Provider 元数据

- **WHEN** 两次缓存调用分别显式指定 Provider 名称和使用默认 Provider
- **THEN** 对应日志的 `providerName` 分别为显式名称和 `default`
- **AND** 两次日志均包含 `cacheName`、被装饰方法名称和稳定事件值

#### Scenario: M02 参数和值不进入日志

- **WHEN** 方法参数、返回值、缓存值、cache key、业务异常、异常筛选器错误或 codec payload 包含手机号、邮箱、凭证、Unicode、空字符串或循环引用对象
- **THEN** 缓存日志不包含这些参数、值、错误内容或完整 key
- **AND** 日志元数据构造不为输出目的读取或序列化业务返回值、缓存值或 codec payload

#### Scenario: M03 Provider 错误交给 Logger 安全处理

- **WHEN** 缓存基础设施错误需要记录且当前 Logger 配置启用了脱敏或结构化输出
- **THEN** 系统把错误作为 `cache.operation_failed` 的 `error` 元数据提交给同一命名 Logger
- **AND** 错误的规范化、脱敏和最终格式由 `@jintianxiayu/logger` 的既有规则处理

#### Scenario: M04 traceId 自动关联

- **WHEN** 缓存调用发生在已包含 `traceId` 的 LoggerContext 异步调用链中
- **THEN** 缓存日志由命名 Logger 按既有规则关联该 `traceId`
- **AND** 缓存装饰器不新增、覆盖或手工复制 LoggerContext

#### Scenario: M05 策略失败只记录稳定阶段

- **WHEN** 异常筛选器或错误 codec 自身抛出包含敏感数据的异常
- **THEN** `cache.error_cache_failed` 只记录稳定 `phase`，不附加回调异常或原业务异常
- **AND** Logger 的任何故障仍不改变缓存旁路和原错误传播结果

### Requirement: Logger 生命周期与故障隔离

缓存包 MUST NOT 在模块加载时获取命名 Logger，也 MUST NOT 主动调用 `LoggerFactory.init()`、`LoggerFactory.shutdown()`、安装进程信号处理器或持有独立 Logger 运行时。应用负责在首次缓存调用前初始化 Logger，并在退出时统一关闭。获取或写入 Logger 的同步异常 MUST NOT 替换缓存结果、业务结果或触发 Provider 错误重新传播。

#### Scenario: L01 导入缓存包不初始化 Logger

- **WHEN** 应用仅导入 `@jintianxiayu/cache-decorator` 而尚未调用任何装饰方法
- **THEN** 缓存包不调用 `LoggerFactory.getLogger()`、`init()` 或 `shutdown()`

#### Scenario: L02 首次缓存调用使用应用 Logger

- **WHEN** 应用先完成 `LoggerFactory.init()` 再调用任一缓存装饰方法
- **THEN** 缓存包通过 `LoggerFactory.getLogger('@jintianxiayu/cache-decorator')` 取得共享命名 Logger
- **AND** 不创建第二个 LoggerFactory 或 Winston 实例

#### Scenario: L03 Logger 写入失败不影响 cache hit

- **WHEN** 命名 Logger 在记录 cache hit 时同步抛出异常
- **THEN** 装饰器仍返回原缓存值且不执行业务方法
- **AND** Logger 异常不替换缓存结果

#### Scenario: L04 Logger 写入失败不遮蔽 Provider 错误

- **WHEN** Provider 读取失败且命名 Logger 的 `error` 写入也同步抛出异常
- **THEN** Logger 异常与 Provider 异常都不得向调用方传播，装饰器仍执行业务方法一次
- **AND** 调用方收到业务方法的成功结果或原始业务异常，不触发 Provider 降级或缓存回填

### Requirement: 公共 API 与缓存语义保持兼容

`CacheOptions` SHALL 继续只包含可选的 `ttl`、`providerName`、`key` 和 `errorCache`；`CacheEvictOptions` MUST 继续只包含可选的 `key`、`allEntries` 和 `providerName`。固定 fail-open 行为 MUST NOT 新增开关或第二套日志配置。包根导出、`@Cache`、`@CacheEvict`、`CacheProvider` 与 `CacheProviderRegistry` 的公共签名，以及 key、正常 TTL、pending Promise 身份、Provider 选择、Redis 数据协议和既有等待边界 SHALL 保持不变；仅装饰器可观察的 Provider 错误语义按本变更修改。

#### Scenario: A01 既有装饰器调用无需日志选项

- **WHEN** 既有代码按原签名使用 `@Cache(cacheName, options?)` 或 `@CacheEvict(cacheName, options?)`
- **THEN** 代码无需新增 fail-open 或日志参数即可继续通过严格 TypeScript 编译
- **AND** 包根 `.d.ts` 不新增缓存故障策略字段或第二套日志配置

#### Scenario: A02 并发请求继续返回同一 Promise

- **WHEN** 两个相同 key 的调用在首个调用完成前并发进入 `@Cache`，包括 Provider 读取失败后旁路缓存的情况
- **THEN** 两个调用继续取得同一 pending Promise，业务方法和 Provider 读取均只执行一次
- **AND** 故障旁路、异常策略与日志调用不包装或替换该 Promise

#### Scenario: A03 Redis 数据协议保持不变

- **WHEN** 新旧缓存包版本访问相同 Redis database 和物理 key
- **THEN** 逻辑或物理 key、正常 `{ value }` 条目、异常 `{ error }` envelope、JSON 序列化、正常 TTL 和淘汰 pattern 保持不变
- **AND** 不需要迁移、改名或清理存量缓存数据

#### Scenario: A04 Provider 与依赖契约保持不变

- **WHEN** 应用继续使用 Memory、Redis 或自定义 `CacheProvider`，并提供既有 Logger peer
- **THEN** Provider 方法签名、直接调用错误语义、注册方式、连接所有权、Logger peerDependency 和运行时依赖保持不变
- **AND** 本变更不要求 Provider 或第三方客户端新增异常专用方法

### Requirement: Logger peer 依赖契约

发布的 `@jintianxiayu/cache-decorator` SHALL 将兼容的 `@jintianxiayu/logger` 声明为必需 peerDependency，并在仓库开发环境以 workspace devDependency 使用同一 Logger 包。缓存包的公共 `.d.ts` MUST NOT 因内部日志实现暴露 Logger 私有实现类型；Logger 包源码和公共 API MUST NOT 因本能力发生变化。

#### Scenario: P01 消费项目提供兼容 Logger

- **WHEN** workspace 外的严格 TypeScript 消费项目安装缓存包、兼容版本的 `@jintianxiayu/logger` 和 `reflect-metadata`
- **THEN** 包根入口能够导入，既有 Memory、Redis 和自定义 Provider 用法能够编译并运行
- **AND** 缓存日志与应用使用同一 Logger 配置和 LoggerContext

#### Scenario: P02 发布清单包含 Logger peer

- **WHEN** 对缓存包执行发布 dry-run 并检查生成的 package manifest
- **THEN** manifest 包含实际 semver 形式的必需 `@jintianxiayu/logger` peerDependency
- **AND** 不把 workspace 协议原样发布，不把 Logger 声明为缓存包私有的普通 dependency
