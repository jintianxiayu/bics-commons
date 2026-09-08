## Context

动机见 [proposal.md](./proposal.md#why)，可观察行为见 [lock-operation-logging spec](./specs/lock-operation-logging/spec.md)。当前 `@DistributedLock` 的 legacy method decorator 在运行期依次获取默认 Provider、解析选项和 key、带重试获取锁、按条件启动 `Watchdog`、调用业务方法，并在 `finally` 中停止 Watchdog 和等待释放。只有 decorator 编排层同时知道业务方法、重试、执行结果和释放结果；`Watchdog` 则是唯一能观察定时续期结果的层。

当前 `Watchdog` 在 async `setInterval` 回调中直接等待 `renew()`。Promise 拒绝没有消费者，可能形成 unhandled rejection；本设计将其作为与续期错误日志不可分割的显式行为修正：定时器边界捕获、记录、停止续期，已经开始的业务继续执行。慢获取后剩余租期不足、续期重叠、重复 `start()` 以及业务与释放双失败的合并策略仍是独立问题。

`@jintianxiayu/logger` 的进程级 `LoggerFactory.getLogger()` 会在未初始化时加载默认配置，且首次成功初始化后不会热切换配置。因此 lock 包只能在运行期第一次真正写日志时获取 Logger，应用必须在第一次锁调用前初始化。Logger 的 level 方法是同步入口，仍可能因配置、生命周期或底层同步写入而抛错，必须在 lock 包内部隔离。

| 包 | 本次职责变化 | 依赖的其他包 | 外部依赖 | 是否需要同步发版 |
| --- | --- | --- | --- | --- |
| `@jintianxiayu/lock-decorator` | 在 decorator 编排和 Watchdog 续期边界记录结构化日志，并安全处理续期 Promise 拒绝 | `@jintianxiayu/logger`（required peer；开发期 workspace 依赖） | 既有 `reflect-metadata`、`uuid`；Redis 客户端仍由调用方提供 | 是，0.x minor；当前版本线预计发布为 `0.2.0` |
| `@jintianxiayu/logger` | 复用现有命名 Logger、脱敏和异步上下文，不修改源码或公共契约 | 无新增 | 既有 Winston/YAML 依赖 | 否 |

## Goals / Non-Goals

**Goals:**

- 用稳定事件和字段表达锁获取、竞争、续期、业务执行及释放的真实可观察状态。
- 让内置 Redis Provider 和自定义 Provider 在 decorator 路径获得一致日志，同时保证 Logger 失败不改变原结果、原异常、次数和顺序。
- 在不暴露 key、token 和业务数据的前提下，依靠 class/method 与 LoggerContext traceId 关联一次调用链。
- 捕获 Watchdog 的 renew Promise 拒绝，避免 unhandled rejection，停止后续续期且保持业务继续执行。
- 保持公共 TypeScript 导出、Redis 协议、客户端连接责任和 legacy decorator 行为不变。

**Non-Goals:**

- 不在 `RedisLockProvider`、Redis adapter 或 registry 注册动作中重复记录日志；直接 Provider 调用不提供 decorator 级事件。
- 不增加 `logging` 开关、Logger 实例、回调、key 日志标签或其他 `DistributedLockOptions` 字段。
- 不记录完整 key、key hash、token、方法参数、返回值、业务异常或 resolver 异常内容。
- 不修复慢 acquire 租期有效性、Watchdog single-flight、重复 start/stop、非法选项校验、fencing token 或业务/释放双异常聚合。
- 不改变 Redis key/value/TTL、Lua 脚本、重试等待、Provider 选择和连接生命周期。

## Decisions

### 1. 使用内部安全日志门面

新增仅供包内使用的 `src/core/lock-logger.ts`。该模块定义 `LockLogEvent`、`LockLogContext`、事件到固定 level/message 的映射，以及 `logLockEvent()`。它不会从 `src/index.ts` 导出。

Logger 名称固定为 `@jintianxiayu/lock-decorator`。模块变量仅缓存成功取得的 `LoggerInterface`；`LoggerFactory.getLogger()` 和具体 level 调用位于同一个 `try/catch` 内。获取失败时不写入缓存，使后续事件仍可重试；任何失败均静默返回，不调用 `console`、不创建第二 Logger，也不向锁控制流抛错。

固定 message 使用无业务数据的英文文本：

| event | message |
| --- | --- |
| `lock.acquire_started` | `Distributed lock acquisition started` |
| `lock.acquire_retry` | `Distributed lock acquisition retry scheduled` |
| `lock.acquired` | `Distributed lock acquired` |
| `lock.watchdog_started` | `Distributed lock watchdog started` |
| `lock.watchdog_skipped` | `Distributed lock watchdog skipped` |
| `lock.renewed` | `Distributed lock renewed` |
| `lock.execution_started` | `Distributed lock execution started` |
| `lock.execution_completed` | `Distributed lock execution completed` |
| `lock.release_started` | `Distributed lock release started` |
| `lock.released` | `Distributed lock released` |
| `lock.acquire_exhausted` | `Distributed lock acquisition exhausted` |
| `lock.ownership_lost` | `Distributed lock ownership lost` |
| `lock.operation_failed` | `Distributed lock operation failed` |

`debug` 承载正常和高频事件，`warn` 承载竞争耗尽或布尔返回值表示的所有权丢失，`error` 只承载抛出的异常。不使用 `info`，由应用通过同名 Logger profile 决定是否开启 debug。

备选方案是在各调用点直接获取 Logger。它会重复 level 映射和异常隔离，容易在新节点遗漏安全边界，因此不采用。模块顶层获取 Logger 会抢先锁定默认配置，也不采用。

### 2. 在 decorator 编排层记录一次完整生命周期

日志插入现有 wrapper，不移动实际业务步骤：

```text
LockProviderRegistry.get
  -> resolve options and key
  -> acquire_started
  -> acquire / retry
       -> acquired
       -> acquire_exhausted
       -> operation_failed(acquire)
  -> watchdog_started or watchdog_skipped
  -> execution_started
  -> original method
  -> execution_completed(outcome)
  -> watchdog.stop
  -> release_started
  -> release
       -> released
       -> ownership_lost(release)
       -> operation_failed(release)
```

Provider 和 key 解析分别使用只覆盖该调用的 `try/catch`，记录失败后重新抛出同一异常对象。正常情况下第一次日志仍在 key 成功解析后产生，避免包导入或 decorator 应用阶段触发 Logger。

获取重试内部使用 1-based `attempt`。`lock.acquire_retry` 只在 `acquire()` 返回 `null` 且确实还会等待下一次尝试时输出；最终 `null` 由外层记录一次 exhausted。获取耗时从第一次实际 acquire 前开始，以单调时钟 `performance.now()` 计算非负 `durationMs`。日志不改变 `retryCount + 1` 的现有总尝试语义，也不把 Provider rejection 当成可重试竞争。

业务方法外围增加只用于记录 outcome 的内层 `try/catch`，成功和异常都记录一次 completed；异常分支不传入业务 error，并重新抛出同一对象。既有外层 `finally` 保留，用单独的 release `try/catch` 记录返回值或异常后维持现有传播：release rejection 仍可覆盖业务 rejection，本变更不暗中改成 `AggregateError`。

备选方案是在 `RedisLockProvider` 记录 acquire/release。它无法看到业务执行、重试耗尽和自定义 Provider，而且会与 decorator 重复，因此不采用。

### 3. 在 Watchdog 定时器边界安全观察续期

`Watchdog` 保持现有构造对象和 `start(): void`、`stop(): void` 签名。定时器回调改为启动一个内部 async 续期方法并显式丢弃其已被内部处理的 Promise；该方法按以下规则收敛每次结果：

- `renew()` 返回 `true`：记录 `lock.renewed`，保留定时器。
- `renew()` 返回 `false`：记录 `lock.ownership_lost`、`phase: renew`，调用 `stop()`。
- `renew()` 拒绝：在内部 `catch` 记录 `lock.operation_failed`、`operation: renew` 和基础设施 error，调用 `stop()`，不重新抛出。

Watchdog 使用已有 `ttl` 和 `interval` 生成续期元数据，不记录其 `key` 或 `token`。通过 decorator 创建时，started/skipped 事件包含 class/method；续期事件主要依赖 LoggerContext 的 traceId 关联。直接构造 Watchdog 仍不需要新增日志上下文字段，因而不会改变其公开构造签名。

该调整只消费此前无人处理的定时器 Promise rejection。它不会将锁丢失注入业务 Promise，也不会提前调用 release；业务结束后仍由 decorator 停止 Watchdog 并尝试释放原 token。现有 setInterval 可能产生的慢续期重叠和重复 `start()` 泄漏保持原状，测试不得误报其已修复。

备选方案是 catch 后重新抛出，这仍会产生 unhandled rejection且日志可能来不及刷新；另一个方案是使业务 Promise 因续期失败而拒绝，但当前架构没有安全取消正在执行方法的机制，也违反既有锁丢失后业务继续的语义，因此均不采用。

### 4. 使用最小字段白名单并禁止 key 派生值

内部元数据类型使用全部可选的事件特定字段，调用点只构造所需字段：

```typescript
interface LockLogContext {
    readonly className?: string;
    readonly methodName?: string;
    readonly attempt?: number;
    readonly maxAttempts?: number;
    readonly ttlMs?: number;
    readonly renewIntervalMs?: number;
    readonly retryDelayMs?: number;
    readonly durationMs?: number;
    readonly operation?: 'provider_resolution' | 'key_resolution' | 'acquire' | 'renew' | 'release';
    readonly phase?: 'renew' | 'release';
    readonly reason?: 'resolver_error' | 'watchdog_disabled';
    readonly outcome?: 'success' | 'business_error';
    readonly error?: unknown;
}
```

`event` 由日志门面合并，调用点不能覆盖。className 和 methodName 来自 decorator 定义时的 target/propertyKey；它们不是最终 lock key。基础设施 error 只允许出现在 Provider 解析、acquire、renew、release 的 operation failure；key resolver 和业务 error 仅用 reason/outcome 表达，防止用户输入进入异常消息或 stack。

不记录 key hash。锁 key 常由低熵订单号、用户号等组成，无密钥 hash 仍可能被枚举反推；引入 HMAC 则需要新的密钥配置和公共 API。token 也不用于构造关联 ID，因为自定义 Provider 不保证 token 具有高熵。跨日志关联依赖应用已有 traceId；没有 traceId 时只保留方法和阶段级排障能力。

### 5. 公共 TypeScript 与 legacy decorator 契约保持不变

本变更不修改根入口的任何导出，相关公共签名保持：

```typescript
export interface DistributedLockOptions {
    key?: null | string | ((...args: unknown[]) => string);
    ttl?: number; // 默认 30000
    renewInterval?: number; // 默认 10000
    retryCount?: number; // 默认 0
    retryDelay?: number; // 默认 100
}

export interface LockProvider {
    acquire(key: string, ttl: number): Promise<string | null>;
    release(key: string, token: string): Promise<boolean>;
    renew(key: string, token: string, ttl: number): Promise<boolean>;
}

export function DistributedLock(
    options?: DistributedLockOptions
): (target: object, propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;

export class Watchdog {
    constructor(config: { provider: LockProvider; key: string; token: string; ttl: number; interval: number });
    start(): void;
    stop(): void;
}
```

`LockProviderRegistry`、`RedisLockProvider`、`RedisLockClient`、两个 adapter 工厂、`LockAcquisitionError` 和默认常量的导出与声明同样不变。`@DistributedLock` 仍在 class 定义期间读取 `design:returntype`，拒绝无返回类型 metadata 或非 Promise 方法；运行期日志位于替换后的 wrapper 内，不定义、修改或覆盖任何 reflect-metadata key。

本仓库继续使用 `experimentalDecorators` 的 legacy 语义：decorator expression 自上而下求值、同一声明上的 decorator 自下而上应用，当前 decorator 捕获应用时的 `descriptor.value`。新增日志不改变求值/应用顺序，也不迁移到 Stage-3 decorator。`emitDecoratorMetadata` 仍需让 `design:returntype` 可用；未启用时保持现有 TypeError 行为且不提前获取 Logger。

现有 throws 契约保持：非 async 用法抛出 TypeError；竞争耗尽抛出 LockAcquisitionError；Provider/key resolver/业务/release 异常按当前边界传播。唯一变化是 Watchdog renew Promise rejection 被内部消费，不再成为 unhandled rejection。

### 6. 以 required peer 集成 Logger

lock 包同时声明：

```json
{
    "peerDependencies": {
        "@jintianxiayu/logger": "workspace:^"
    },
    "devDependencies": {
        "@jintianxiayu/logger": "workspace:^"
    }
}
```

peer 让应用提供唯一 Logger runtime/config/context，devDependency 供 monorepo 编译和测试。普通 dependency 可能在不兼容的安装布局中产生第二份进程级单例，因此不采用。发布打包测试必须确认 workspace protocol 被转换为当前 Logger `0.2.0` 对应的 `^0.2.0`，lock 包自身 dependencies 不包含 Logger，应用和包解析到同一真实路径。

README 增加联合安装、应用启动时 init、退出时 shutdown、同名 profile 配置、事件表、敏感字段边界、续期异常新语义及迁移说明。包内不增加第二套 logging 开关。

### 7. 分层验证行为、真实 Logger 和发布契约

验证分为三层：

1. 日志门面单元测试验证惰性缓存、event-level-message 映射、Logger 获取/写入异常隔离和无 console 兜底。
2. decorator/Watchdog 测试使用 mock Provider 与 fake timers 验证事件顺序、attempt、outcome、续期结果、原对象传播和敏感数据缺失；独立进程验证 renew rejection 不触发 unhandledRejection。
3. 真实 Logger fixture 验证 JSON 输出名称、level、traceId、脱敏和配置筛选；打包消费测试验证 required peer、唯一 Logger 解析、README 示例及发布 manifest。存在测试 Redis URL 时，再用真实 Redis 覆盖竞争、TTL/所有权丢失和客户端异常，未配置时明确 skip 而不伪造证据。

测试名称使用 `lock-operation-logging/<场景>` 前缀，使规范 Scenario 与断言可追踪；不得只检查日志调用存在而忽略原锁结果、异常和调用次数。

## Risks / Trade-offs

- [debug 级别包含续期成功，开启后日志量可能较大] → 正常事件固定为 debug，默认由应用 profile 过滤；不增加包内第二开关。
- [Logger 首次获取可能同步加载默认配置并增加首次调用延迟] → 仅运行期惰性获取，并要求应用在首次锁调用前显式 init。
- [Logger 故障被隔离后日志可能静默缺失] → 以锁与业务可用性优先；配置和传输诊断继续由 logger 包自身渠道负责，不使用 console 绕过脱敏。
- [不记录 key 会降低跨请求竞争定位精度] → 依靠 className、methodName 和 traceId；不以可枚举 hash 换取敏感数据风险，未来如需稳定业务标签另行设计显式安全字段。
- [捕获 renew rejection 改变原有进程级失败信号] → 固定输出 error、停止 Watchdog、更新 README 并按 0.x minor 发布；测试验证无 unhandled rejection 且业务继续。
- [现有重叠续期或重复 start 可能造成停止后的在途结果日志] → 明确留在范围外，不以本变更宣称生命周期幂等；后续优化需单独定义状态机和测试。
- [required peer 增加升级负担] → 发布前盘点消费者，明确安装和初始化步骤，并通过 tarball 消费测试验证单例解析。
- [固定事件和字段成为长期运维契约] → 由 delta spec 和精确事件测试约束；未来改名、改 level 或新增敏感字段必须走独立变更。

## Migration Plan

1. 发布前盘点 `@jintianxiayu/lock-decorator` 的下游消费者，通知 required Logger peer、新事件量和 renew rejection 语义。
2. 下游先安装满足 peer 范围的 `@jintianxiayu/logger`，在应用启动阶段 init，在退出阶段统一 shutdown，并按需配置 `@jintianxiayu/lock-decorator` profile。
3. 以 0.x minor 发布 lock 包；新旧版本可同时操作同一 Redis key，无需迁移、清理或改写存量锁。
4. 先在低流量环境启用 warn/error，确认事件、脱敏和告警规则；需要详细诊断时再开启 debug 并观察续期日志量。
5. npm 版本无法撤回。发生问题时发布修订版本关闭或修正日志，或让下游锁定升级前的 lock 版本并恢复旧依赖；已经落盘的日志按现有保留策略处理，Redis 数据无需回滚。
