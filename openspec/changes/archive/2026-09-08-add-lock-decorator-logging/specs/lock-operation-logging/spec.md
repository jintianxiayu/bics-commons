## Purpose

为分布式锁获取、竞争重试、续期、业务执行和释放建立稳定且安全的结构化日志契约，使依赖方能够区分正常竞争、锁所有权丢失与基础设施故障，同时保证日志系统异常不会改变锁和业务结果。

## ADDED Requirements

### Requirement: 使用统一命名 Logger 和应用级生命周期

`@jintianxiayu/lock-decorator` SHALL 使用名称 `@jintianxiayu/lock-decorator` 的应用共享 Logger 输出本能力定义的事件。lock 包 MUST NOT 初始化或关闭 Logger、创建独立日志运行时或注册进程退出处理器；日志是否输出、输出目标、格式、level、脱敏及异步上下文 SHALL 由宿主应用的 Logger 配置统一控制。

#### Scenario: 应用配置 lock 命名 Logger
- **WHEN** 应用在第一次锁操作前初始化 Logger，并为 `@jintianxiayu/lock-decorator` 配置输出策略
- **THEN** lock 事件 SHALL 使用该命名 Logger 和应用提供的同一日志运行时

#### Scenario: 导入包和定义装饰器类
- **WHEN** 消费者仅导入 lock 包、求值 `@DistributedLock` 或定义包含该 decorator 的 class，尚未调用被装饰方法
- **THEN** lock 包 MUST NOT 获取 Logger 或触发 Logger 的延迟初始化

#### Scenario: 重复执行锁操作
- **WHEN** 同一进程连续或并发执行多个锁操作
- **THEN** lock 包 SHALL 复用同一命名 Logger，而不是为每次操作创建独立日志运行时

### Requirement: 使用固定事件名和 level

lock 包 SHALL 使用下表中的固定事件名和 level，不得为正常高频锁事件输出 `info`：

| level | event | 含义 |
| --- | --- | --- |
| `debug` | `lock.acquire_started` | 已完成前置解析并开始获取锁 |
| `debug` | `lock.acquire_retry` | 本次锁竞争失败且仍会重试 |
| `debug` | `lock.acquired` | 获取锁成功 |
| `debug` | `lock.watchdog_started` | 因续期间隔小于 TTL 而启动 Watchdog |
| `debug` | `lock.watchdog_skipped` | 因续期间隔不小于 TTL 而不启动 Watchdog |
| `debug` | `lock.renewed` | 一次续期成功 |
| `debug` | `lock.execution_started` | 已持锁并即将调用业务方法 |
| `debug` | `lock.execution_completed` | 业务方法以成功或异常结束 |
| `debug` | `lock.release_started` | Watchdog 已停止并开始释放锁 |
| `debug` | `lock.released` | 释放锁成功 |
| `warn` | `lock.acquire_exhausted` | 锁竞争重试耗尽 |
| `warn` | `lock.ownership_lost` | 续期或释放返回 `false`，当前 token 已不能操作该锁 |
| `error` | `lock.operation_failed` | Provider 解析、key 解析或锁操作抛出异常 |

#### Scenario: 正常流程仅产生 debug 事件
- **WHEN** 获取、续期、业务执行和释放全部成功
- **THEN** 对应事件 SHALL 使用 `debug`，且 MUST NOT 产生 `info`、`warn` 或 `error` 事件

#### Scenario: 可预期竞争或所有权丢失
- **WHEN** 获取重试耗尽，或者续期/释放返回 `false`
- **THEN** 对应事件 SHALL 使用 `warn`，不得将这些布尔结果误报为基础设施异常

#### Scenario: 锁操作抛出异常
- **WHEN** Provider 解析、key 解析、获取、续期或释放抛出异常
- **THEN** lock 包 SHALL 使用 `error` 输出 `lock.operation_failed`，并通过 `operation` 区分失败阶段

### Requirement: 记录锁获取和竞争重试

一次装饰器调用 SHALL 在 key 解析完成后记录一次 `lock.acquire_started`。每次 `LockProvider.acquire()` 返回 `null` 且仍有剩余重试时 SHALL 记录一次 `lock.acquire_retry`；获取成功 SHALL 记录一次 `lock.acquired`；所有尝试耗尽 SHALL 记录一次 `lock.acquire_exhausted` 并继续抛出原有 `LockAcquisitionError`。

#### Scenario: 首次获取成功
- **WHEN** 第一次 `acquire()` 返回非空 token
- **THEN** 日志顺序 SHALL 为 `lock.acquire_started`、`lock.acquired`，且业务方法随后执行

#### Scenario: 竞争后重试成功
- **WHEN** 前两次 `acquire()` 返回 `null`，第三次返回 token，且配置允许两次重试
- **THEN** SHALL 记录两次带有递增 attempt 的 `lock.acquire_retry`，随后记录一次 `lock.acquired`

#### Scenario: 重试耗尽
- **WHEN** 首次尝试和全部重试均返回 `null`
- **THEN** SHALL 记录一次 `lock.acquire_exhausted`，不记录业务或释放事件，并抛出包含现有 key 与 retryCount 的 `LockAcquisitionError`

#### Scenario: 同一 key 并发或重复获取
- **WHEN** 一个调用持有锁期间，另一个调用使用相同最终 key 获取同一非重入锁
- **THEN** 后者 SHALL 按现有规则记录重试或耗尽事件，不得被日志能力当作同一持有者而绕过竞争

#### Scenario: Redis 不可用或连接超时
- **WHEN** 获取锁的 Provider 因 Redis 不可用、连接超时或命令错误而拒绝 Promise
- **THEN** SHALL 记录 `lock.operation_failed` 且 `operation` 为 `acquire`，原异常 SHALL 原样传播，业务和释放均不得执行

### Requirement: 记录 Watchdog 决策和续期结果

当 `renewInterval < ttl` 时 SHALL 启动 Watchdog 并记录 `lock.watchdog_started`；否则 SHALL 不启动 Watchdog并记录 `lock.watchdog_skipped`。每次续期返回 `true` SHALL 记录 `lock.renewed`；返回 `false` SHALL 记录 `lock.ownership_lost`、停止后续续期，并保持已经开始的业务继续执行。

#### Scenario: 使用缺省续期配置
- **WHEN** decorator 未提供 `ttl` 与 `renewInterval`，获取锁成功
- **THEN** SHALL 使用现有默认值 `30000` 与 `10000` 启动 Watchdog，并在日志元数据中记录对应毫秒值

#### Scenario: 显式禁用 Watchdog
- **WHEN** `renewInterval` 大于或等于 `ttl`
- **THEN** SHALL 记录 `lock.watchdog_skipped`，不调用 `renew()`，业务和释放流程继续按现有规则执行

#### Scenario: 续期成功
- **WHEN** Watchdog 调用 `renew()` 并得到 `true`
- **THEN** SHALL 记录 `lock.renewed` 并允许后续续期继续发生

#### Scenario: 续期返回 false
- **WHEN** Watchdog 调用 `renew()` 并得到 `false`
- **THEN** SHALL 记录 `lock.ownership_lost` 且 `phase` 为 `renew`，停止后续续期，但不得取消或拒绝已经开始的业务 Promise

#### Scenario: 续期 Promise 拒绝
- **WHEN** Watchdog 的 `renew()` Promise 因 Redis 故障或自定义 Provider 异常而拒绝
- **THEN** SHALL 在定时器边界捕获异常，记录 `lock.operation_failed` 且 `operation` 为 `renew`，停止后续续期，并且 MUST NOT 产生 unhandled rejection 或打断已经开始的业务 Promise

#### Scenario: 锁超时后业务完成
- **WHEN** 锁因续期失败或自然到期而丢失，但业务方法稍后正常完成
- **THEN** 业务结果 SHALL 保持不变，结束阶段仍 SHALL 停止 Watchdog 并尝试释放原 token

### Requirement: 记录业务执行与释放结果

获取锁成功后，lock 包 SHALL 在调用业务方法前记录 `lock.execution_started`，并在业务 Promise 成功或拒绝后记录一次 `lock.execution_completed` 及 `outcome`。结束阶段 SHALL 先停止 Watchdog，再记录 `lock.release_started` 并调用一次 `release()`；返回 `true` 时记录 `lock.released`，返回 `false` 时记录 `lock.ownership_lost` 且 `phase` 为 `release`。

#### Scenario: 业务成功且释放成功
- **WHEN** 业务方法成功返回且 `release()` 返回 `true`
- **THEN** SHALL 按顺序记录 execution started、execution completed、release started 和 released，业务返回值保持不变

#### Scenario: 业务异常且释放成功
- **WHEN** 业务 Promise 以原异常拒绝且 `release()` 返回 `true`
- **THEN** `lock.execution_completed` 的 `outcome` SHALL 为 `business_error`，释放仍执行一次，最终仍抛出同一个业务异常对象

#### Scenario: 释放返回 false
- **WHEN** `release()` 因锁已过期、不存在或 token 不匹配而返回 `false`
- **THEN** SHALL 记录 `lock.ownership_lost` 且 `phase` 为 `release`，不得把 `false` 转换为新的异常或改变原业务结果

#### Scenario: 释放命令异常
- **WHEN** `release()` Promise 拒绝
- **THEN** SHALL 记录 `lock.operation_failed` 且 `operation` 为 `release`，并保持当前由释放异常向调用方传播的语义

#### Scenario: 业务与释放同时异常
- **WHEN** 业务 Promise 和随后的 `release()` 都拒绝
- **THEN** SHALL 分别记录业务异常 outcome 与释放 operation failure，并保持当前由释放异常覆盖业务异常的外部行为

### Requirement: 记录前置解析失败且不改变调用顺序

lock 包 SHALL 保持当前先解析默认 Provider、再应用默认选项并解析 key、最后获取锁的顺序。Provider 或 key 解析失败时 SHALL 记录对应 `lock.operation_failed`，原异常 SHALL 原样传播，且后续锁和业务步骤不得执行。

#### Scenario: 默认 Provider 不存在
- **WHEN** 调用被装饰方法时没有已注册的默认 Provider
- **THEN** SHALL 记录 `lock.operation_failed` 且 `operation` 为 `provider_resolution`，原错误原样传播，key resolver、获取和业务均不得执行

#### Scenario: 动态 key resolver 抛错
- **WHEN** 默认 Provider 已解析，但函数式 key resolver 抛出异常
- **THEN** SHALL 记录 `lock.operation_failed` 且 `operation` 为 `key_resolution`，原异常原样传播，获取和业务均不得执行

### Requirement: 日志元数据使用稳定字段白名单

lock 日志元数据 SHALL 以 `event` 作为机器筛选主键，并只能按事件需要包含 `className`、`methodName`、`attempt`、`maxAttempts`、`ttlMs`、`renewIntervalMs`、`retryDelayMs`、`durationMs`、`operation`、`phase`、`reason`、`outcome` 和 `error`。attempt SHALL 从 1 开始，durationMs SHALL 为非负有限数；decorator 使用缺省选项时 SHALL 记录实际生效的默认值。

完整最终 key、token、方法参数、业务返回值、业务异常内容和 key resolver 异常内容 MUST NOT 进入日志。`error` 仅可用于 Provider 解析或 acquire/renew/release 基础设施异常，并 SHALL 交给 Logger 的规范化与脱敏链路；`traceId` SHALL 由应用共享 Logger 的异步上下文自动关联，不得在 lock 元数据中重复写入。

#### Scenario: 动态 key 和业务数据包含敏感信息
- **WHEN** 最终 key、token、方法参数、业务返回值或业务异常包含密码、邮箱或用户标识
- **THEN** 任意 lock 事件的 message 和 metadata MUST NOT 包含这些原始值

#### Scenario: 基础设施异常包含敏感字段
- **WHEN** Provider 异常带有可规范化的嵌套敏感字段
- **THEN** `lock.operation_failed` 可携带该异常，但输出 SHALL 经过应用 Logger 的既有脱敏策略

#### Scenario: 存在 traceId 上下文
- **WHEN** 锁操作发生在应用 Logger 的 traceId 异步上下文内
- **THEN** 每条实际输出的 lock 日志 SHALL 由 Logger 关联相同 traceId，且 lock metadata 本身不得复制 `traceId`

#### Scenario: 省略 decorator 选项
- **WHEN** 使用 `@DistributedLock()` 或显式提供 `undefined`/`null` key
- **THEN** 锁行为 SHALL 继续使用现有默认 key 与默认数字配置，但日志 MUST NOT 输出生成后的完整 key

### Requirement: Logger 故障与锁行为隔离

Logger 获取、配置加载、元数据处理或同步写入产生的异常 MUST NOT 替换锁 Provider 异常、业务异常或释放异常，也不得改变成功返回值、重试次数、续期、释放次数和调用顺序。日志故障 MUST NOT 通过 `console` 或独立 Logger 形成第二输出通道。

#### Scenario: 获取 Logger 失败
- **WHEN** 第一次锁事件尝试获取 Logger 时因配置错误或 Logger 生命周期状态而抛出异常
- **THEN** 锁获取、业务和释放 SHALL 继续按原结果执行，Logger 异常不得传播

#### Scenario: level 方法同步抛错
- **WHEN** 命名 Logger 的 `debug`、`warn` 或 `error` 方法同步抛出异常
- **THEN** 当前锁步骤及后续步骤 SHALL 保持原有结果和次数，且不得调用 `console` 兜底

#### Scenario: Logger 已关闭
- **WHEN** 应用已经关闭 Logger 后仍调用被装饰方法
- **THEN** 日志不可写不得阻止该方法按既有锁语义完成或失败

### Requirement: 保持公共 API、锁协议和非法输入语义

本能力 MUST NOT 新增或修改 `src/index.ts` 导出，不得改变 `DistributedLock`、`DistributedLockOptions`、`LockProvider`、`RedisLockClient`、`RedisLockProvider` 或 `Watchdog` 的公共 TypeScript 签名。现有 key 生成、TTL、重试、Redis token、Lua 原子操作、连接生命周期和异常类型 SHALL 保持不变；本能力 MUST NOT 借日志改动新增选项校验、自动修复非法值或改变慢获取、重叠续期、重复 Watchdog start 及业务/释放双失败语义。

#### Scenario: 使用自定义 LockProvider
- **WHEN** decorator 使用已注册的自定义 `LockProvider`
- **THEN** SHALL 产生与内置 Redis Provider 相同的编排层日志，且自定义 Provider 的返回值和异常语义保持不变

#### Scenario: 直接调用底层 Provider
- **WHEN** 消费者绕过 decorator，直接调用 `RedisLockProvider` 或自定义 Provider
- **THEN** 本能力不保证产生 decorator 编排事件，Provider 的既有公共行为保持不变

#### Scenario: 非法或极值选项
- **WHEN** 既有消费者传入零、负数、非有限值或极大 TTL、renewInterval、retryCount、retryDelay
- **THEN** 日志能力 MUST NOT 新增校验、归一化或替换异常，锁实现 SHALL 保持本变更前对该输入的可观察行为

#### Scenario: 新旧版本操作同一 Redis 锁
- **WHEN** 新旧 lock 包版本使用相同最终 key、Redis 数据库和锁协议并存
- **THEN** 两者 SHALL 保持互斥兼容，旧版本不产生本能力日志，新版本产生的日志不得改变 Redis 数据

### Requirement: Logger 作为必需 peer 提供

发布的 `@jintianxiayu/lock-decorator` SHALL 将兼容的 `@jintianxiayu/logger` 声明为必需 `peerDependency`，不得在普通 `dependencies` 中安装第二份 Logger。开发和测试环境 SHALL 能通过 workspace 开发依赖解析 Logger；发布 manifest MUST 包含有效 semver 范围而不是 workspace protocol。

#### Scenario: 外部消费项目安装两个包
- **WHEN** 干净消费项目安装发布后的 lock 包和满足 peer 范围的 Logger
- **THEN** lock 包与应用 SHALL 解析到同一个 Logger 实例，并共享 Logger 配置和异步上下文

#### Scenario: 检查发布 manifest
- **WHEN** 对 lock 包执行发布 dry-run 或安装其打包产物
- **THEN** manifest 中 Logger peer SHALL 为基于当前 Logger 版本转换的普通 semver，且普通 dependencies 中不得包含 Logger

#### Scenario: 缺少必需 peer
- **WHEN** 消费项目升级 lock 包但未提供兼容 Logger
- **THEN** 包管理器 SHALL 将其报告为未满足的必需 peer，迁移文档 SHALL 指示应用安装并初始化 Logger
