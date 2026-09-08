## Purpose

定义 `@Cache` 与 `@CacheEvict` 在关键缓存决策节点通过统一命名 Logger 输出结构化日志的行为，使依赖方能够区分命中、未命中、请求合并、回填、淘汰与基础设施失败，同时不改变缓存调用的既有结果和时序。

## Requirements

### Requirement: 固定命名 Logger 与日志级别

缓存装饰器 SHALL 将日志提交给 `@jintianxiayu/logger` 中名称固定为 `@jintianxiayu/cache-decorator` 的 Logger。正常缓存决策 MUST 使用 `debug`，发生降级但调用仍可继续或淘汰因业务失败被跳过时 MUST 使用 `warn`，导致对应缓存操作失败的 Provider 或注册表异常 MUST 使用 `error`；系统 MUST NOT 使用 `info` 记录逐调用缓存事件，也 MUST NOT 使用 `console` 或自行创建其他日志传输。

#### Scenario: 正常缓存决策使用 debug

- **WHEN** 发生 pending 请求复用、缓存命中、缓存未命中、缓存写入已发起、单 key 淘汰已发起或全量淘汰已完成
- **THEN** 系统通过命名 Logger 的 `debug` 方法提交对应结构化日志
- **AND** 不调用该 Logger 的 `info`、`warn` 或 `error` 方法记录同一正常事件

#### Scenario: 可恢复回退与淘汰跳过使用 warn

- **WHEN** 自定义 key resolver 抛出异常并回退默认 key，或 `@CacheEvict` 装饰的业务方法失败而不执行淘汰
- **THEN** 系统通过命名 Logger 的 `warn` 方法提交对应结构化日志
- **AND** 原有回退或异常传播行为保持不变

#### Scenario: 缓存基础设施失败使用 error

- **WHEN** Provider 无法解析、缓存读取失败、同步可观察的写入或单 key 删除调用失败，或等待中的全量淘汰失败
- **THEN** 系统通过命名 Logger 的 `error` 方法提交失败日志
- **AND** 对应原始错误继续按既有路径传播，不转换为 cache miss、成功或其他 Provider 降级

#### Scenario: Logger 配置筛选输出

- **WHEN** 应用通过 `@jintianxiayu/logger` 对名称 `@jintianxiayu/cache-decorator` 配置 level、console 或 file transport
- **THEN** 缓存日志按照该命名 Logger 的既有筛选与路由规则输出
- **AND** 缓存包不维护第二套 level 或 transport 开关

### Requirement: @Cache 缓存决策日志

`@Cache` SHALL 为每次实际发生的关键缓存决策提交一条具有稳定 `event` 的结构化日志。日志 MUST 准确区分 pending 请求复用、Provider 缓存命中、缓存未命中、业务结果回填已发起和业务异常回填已发起，不得把请求合并描述为 Provider 命中，也不得把已发起的写入描述为写入成功。

#### Scenario: C01 并发调用复用 pending 请求

- **WHEN** 相同逻辑 cache key 已存在尚未完成的 pending Promise，后续并发调用复用该 Promise
- **THEN** 后续调用提交 `debug` 日志且 `event` 为 `cache.pending_hit`
- **AND** 该调用不额外提交 `cache.hit` 或 `cache.miss`，不重复读取 Provider、执行业务方法或发起缓存写入

#### Scenario: C02 命中成功缓存条目

- **WHEN** Provider 读取返回成功缓存条目
- **THEN** 系统在返回缓存值前提交 `debug` 日志且 `event` 为 `cache.hit`、`entryType` 为 `value`
- **AND** 不执行被装饰业务方法

#### Scenario: C03 命中异常缓存条目

- **WHEN** Provider 读取返回包含既有业务异常的缓存条目
- **THEN** 系统在重新抛出同一异常前提交 `debug` 日志且 `event` 为 `cache.hit`、`entryType` 为 `error`
- **AND** 不把该异常命中记录为 Provider 基础设施失败，不再次执行被装饰业务方法

#### Scenario: C04 未命中后回填业务结果

- **WHEN** Provider 返回 `undefined` 且被装饰业务方法成功完成
- **THEN** 系统先提交 `debug` 日志且 `event` 为 `cache.miss`
- **AND** 调用 Provider 写入业务结果后提交 `debug` 日志且 `event` 为 `cache.write_dispatched`、`entryType` 为 `value`
- **AND** 返回原业务结果

#### Scenario: C05 未命中后回填业务异常

- **WHEN** Provider 返回 `undefined` 且被装饰业务方法以异常拒绝
- **THEN** 系统已经为本次读取提交 `cache.miss` 日志
- **AND** 调用 Provider 写入异常条目后提交 `debug` 日志且 `event` 为 `cache.write_dispatched`、`entryType` 为 `error`
- **AND** 重新抛出同一业务异常，不额外把业务异常记录为缓存基础设施 `error`

#### Scenario: C06 重复调用只记录实际决策

- **WHEN** 同一 key 首次调用 miss 并发起写入，后续调用读取到该条目
- **THEN** 首次调用记录一次 `cache.miss` 和一次 `cache.write_dispatched`，后续每次实际 Provider 命中各记录一次 `cache.hit`
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

系统 SHALL 为缓存基础设施失败提交 `cache.operation_failed` 事件，并以 `operation` 标识失败阶段。读取失败、Provider 解析失败和已等待的淘汰失败 MUST NOT 被记录为正常 miss、命中、写入或淘汰完成；Redis 不可用、连接超时和扫描或批量删除失败 MUST NOT 触发内存 Provider 或其他 Provider 降级。

#### Scenario: F01 默认或指定 Provider 不存在

- **WHEN** 装饰器无法从注册表取得默认或指定 Provider
- **THEN** 系统提交 `error` 日志且 `event` 为 `cache.operation_failed`、`operation` 为 `provider_resolution`
- **AND** 以原始注册表错误拒绝，不执行缓存读写或替代 Provider 操作

#### Scenario: F02 Redis 读取不可用或超时

- **WHEN** Provider 读取因 Redis 不可用或连接超时而拒绝
- **THEN** 系统提交 `error` 日志且 `event` 为 `cache.operation_failed`、`operation` 为 `read`
- **AND** 不提交 `cache.miss`，不执行业务方法，不切换 Provider，并以同一错误拒绝

#### Scenario: F03 allEntries 扫描或删除失败

- **WHEN** `deleteByPattern` 因任一 SCAN 页面或批量删除失败而拒绝
- **THEN** 系统提交 `error` 日志且 `event` 为 `cache.operation_failed`、`operation` 为 `evict`
- **AND** 不提交 `cache.evict_completed`，以同一错误拒绝且不报告完整清理成功

#### Scenario: F04 非等待写入只报告已发起

- **WHEN** `@Cache` 调用返回 Promise 的 Provider `set`，包括该 Promise 随后因 Redis 写入、非法 TTL 或序列化错误而拒绝的情况
- **THEN** 装饰器只保证在同步调用返回控制权后提交 `cache.write_dispatched`
- **AND** 不提交写入完成或写入成功事件，不为获得日志而等待该 Promise、重试或切换 Provider

#### Scenario: F05 非等待单 key 删除只报告已发起

- **WHEN** 单 key `@CacheEvict` 调用返回 Promise 的 Provider `delete`
- **THEN** 装饰器只保证在同步调用返回控制权后提交 `cache.evict_dispatched`
- **AND** 不提交删除完成或删除成功事件，不为获得日志而等待该 Promise、重试或切换 Provider

### Requirement: 结构化上下文与敏感信息边界

每条缓存日志 SHALL 至少包含稳定的 `event`、`cacheName`、`methodName` 和 `providerName` 元数据，其中未显式指定 Provider 时 `providerName` 使用稳定的 `default` 标识。事件 MAY 按场景增加 `entryType`、`scope`、`reason`、`operation` 或 `error`；系统 MUST NOT 将方法参数、业务返回值、缓存值、异常缓存中的业务异常内容或完整逻辑及物理 cache key 放入缓存日志。Logger 上下文中已有的 `traceId` SHALL 继续由 `@jintianxiayu/logger` 的既有机制关联和脱敏。

#### Scenario: M01 显式与默认 Provider 元数据

- **WHEN** 两次缓存调用分别显式指定 Provider 名称和使用默认 Provider
- **THEN** 对应日志的 `providerName` 分别为显式名称和 `default`
- **AND** 两次日志均包含 `cacheName`、被装饰方法名称和稳定事件值

#### Scenario: M02 参数和值不进入日志

- **WHEN** 方法参数、返回值、缓存值或 cache key 包含手机号、邮箱、凭证、Unicode、空字符串或循环引用对象
- **THEN** 缓存日志不包含这些参数、值或完整 key
- **AND** 日志元数据构造不读取或序列化业务返回值及缓存值

#### Scenario: M03 Provider 错误交给 Logger 安全处理

- **WHEN** 缓存基础设施错误需要记录且当前 Logger 配置启用了脱敏或结构化输出
- **THEN** 系统把错误作为 `cache.operation_failed` 的 `error` 元数据提交给同一命名 Logger
- **AND** 错误的规范化、脱敏和最终格式由 `@jintianxiayu/logger` 的既有规则处理

#### Scenario: M04 traceId 自动关联

- **WHEN** 缓存调用发生在已包含 `traceId` 的 LoggerContext 异步调用链中
- **THEN** 缓存日志由命名 Logger 按既有规则关联该 `traceId`
- **AND** 缓存装饰器不新增、覆盖或手工复制 LoggerContext

### Requirement: Logger 生命周期与故障隔离

缓存包 MUST NOT 在模块加载时获取命名 Logger，也 MUST NOT 主动调用 `LoggerFactory.init()`、`LoggerFactory.shutdown()`、安装进程信号处理器或持有独立 Logger 运行时。应用负责在首次缓存调用前初始化 Logger，并在退出时统一关闭。获取或写入 Logger 的同步异常 MUST NOT 替换缓存结果、业务结果或原始缓存异常。

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
- **THEN** 装饰器仍以原始 Provider 错误拒绝
- **AND** Logger 异常不转换为 miss、不触发业务方法或 Provider 降级

### Requirement: 公共 API 与缓存语义保持兼容

日志能力 SHALL 在不新增缓存配置项的前提下工作。`CacheOptions` MUST 继续只包含可选的 `ttl`、`providerName` 和 `key`，`CacheEvictOptions` MUST 继续只包含可选的 `key`、`allEntries` 和 `providerName`；`@Cache`、`@CacheEvict`、`CacheProvider` 与 `CacheProviderRegistry` 的公共签名和包根导出 MUST 保持不变。日志功能 MUST NOT 改变 key、TTL、异常缓存、pending Promise 身份、Provider 选择、业务调用顺序或现有等待边界。

#### Scenario: A01 既有装饰器调用无需日志选项

- **WHEN** 既有代码按原签名使用 `@Cache(cacheName, options?)` 或 `@CacheEvict(cacheName, options?)`
- **THEN** 代码无需新增 `logging`、`debug` 或 logger 参数即可继续通过严格 TypeScript 编译并运行
- **AND** 包根 `.d.ts` 不新增缓存日志配置类型或方法

#### Scenario: A02 并发请求继续返回同一 Promise

- **WHEN** 两个相同 key 的调用在首个调用完成前并发进入 `@Cache`
- **THEN** 两个调用继续取得同一 pending Promise，业务方法和 Provider 读取均不因日志功能重复执行
- **AND** 新增的日志调用不包装或替换该 Promise

#### Scenario: A03 Redis 数据协议保持不变

- **WHEN** 新旧缓存包版本访问相同 Redis database 和物理 key
- **THEN** 日志功能不改变逻辑或物理 key、缓存条目结构、JSON 序列化、TTL 或淘汰 pattern
- **AND** 存量缓存无需迁移、改名或清理

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
