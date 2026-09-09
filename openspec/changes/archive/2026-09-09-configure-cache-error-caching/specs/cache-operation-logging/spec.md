## MODIFIED Requirements

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
- **AND** 对应原始错误继续按既有路径传播，不转换为 cache miss、成功或其他 Provider 降级

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

### Requirement: 公共 API 与缓存语义保持兼容

除本变更明确新增的异常缓存策略与默认异常持久化行为外，`CacheOptions` SHALL 继续包含可选的 `ttl`、`providerName` 和 `key`，并新增可选的 `errorCache`；包根 SHALL 导出异常策略与 codec 公共类型。`CacheEvictOptions` MUST 继续只包含可选的 `key`、`allEntries` 和 `providerName`；`@Cache`、`@CacheEvict`、`CacheProvider` 与 `CacheProviderRegistry` 的其余公共签名和包根导出 MUST 保持不变。key、正常 TTL、pending Promise 身份、Provider 选择、业务调用顺序及现有等待边界 SHALL 保持不变。

#### Scenario: A01 既有装饰器调用无需日志选项

- **WHEN** 既有代码按原签名使用 `@Cache(cacheName, options?)` 或 `@CacheEvict(cacheName, options?)`
- **THEN** 代码无需新增日志参数即可继续通过严格 TypeScript 编译；省略 `errorCache` 时业务异常不再持久化
- **AND** 包根 `.d.ts` 只新增异常策略相关类型和 `CacheOptions.errorCache`，不新增第二套日志配置

#### Scenario: A02 并发请求继续返回同一 Promise

- **WHEN** 两个相同 key 的调用在首个调用完成前并发进入 `@Cache`
- **THEN** 两个调用继续取得同一 pending Promise，业务方法和 Provider 读取均不因异常策略或日志重复执行
- **AND** 新增的策略与日志调用不包装或替换该 Promise

#### Scenario: A03 Redis 数据协议保持不变

- **WHEN** 新旧缓存包版本访问相同 Redis database 和物理 key
- **THEN** 逻辑或物理 key、正常 `{ value }` 条目、JSON 序列化、正常 TTL 和淘汰 pattern 保持不变
- **AND** 只有异常 `{ error }` 内容采用本变更定义的版本化表示和旁路规则

#### Scenario: A04 Provider 与依赖契约保持不变

- **WHEN** 应用继续使用 Memory、Redis 或自定义 `CacheProvider`，并提供既有 Logger peer
- **THEN** Provider 方法签名、注册方式、连接所有权、Logger peerDependency 和运行时依赖保持不变
- **AND** 本变更不要求 Provider 或第三方客户端新增异常专用方法
