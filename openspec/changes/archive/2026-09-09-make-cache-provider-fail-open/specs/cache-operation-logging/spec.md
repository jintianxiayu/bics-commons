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
- **AND** 装饰器按固定 fail-open 语义保留业务结果或原始业务异常，不把基础设施失败记录为 cache miss、命中、写入成功或淘汰完成

#### Scenario: Logger 配置筛选输出

- **WHEN** 应用通过 `@jintianxiayu/logger` 对名称 `@jintianxiayu/cache-decorator` 配置 level、console 或 file transport
- **THEN** 缓存日志按照该命名 Logger 的既有筛选与路由规则输出
- **AND** 缓存包不维护第二套 level 或 transport 开关

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
