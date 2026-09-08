## Context

动机见 [proposal.md](./proposal.md#why)，可观察行为见
[cache-operation-logging spec](./specs/cache-operation-logging/spec.md)。当前 `@Cache` 与 `@CacheEvict` 在 legacy
method decorator 中直接编排 key 解析、请求合并、Provider 获取、缓存读写和业务方法调用；Provider 层无法观察
`pending hit`、业务异常导致的 evict 跳过等装饰器级决策，自定义 Provider 也不应被要求重复实现同一套日志。

当前调用边界并不完全同步：`provider.get()` 与 `deleteByPattern()` 会被 `await`，但 `provider.set()` 和单 key
`provider.delete()` 仅发起调用、不等待返回的 Promise。设计必须保留这些时序、异常和并发语义，因此日志也只能描述
代码实际观察到的状态，不能把“已发起”表述为“已完成”。

`@jintianxiayu/logger` 提供进程级 `LoggerFactory`、命名 Logger、级别过滤、脱敏和 `LoggerContext` 透传。
`LoggerFactory.getLogger()` 在未初始化时会延迟初始化且首次生效的配置不会被后续 `init()` 替换，所以 cache 包不得在模块
加载或 decorator 求值阶段提前获取 Logger；依赖方应在第一次缓存方法调用前完成 Logger 初始化。

| 包 | 本次职责变化 | 依赖的其他包 | 外部依赖 | 是否需要同步发版 |
| --- | --- | --- | --- | --- |
| `@jintianxiayu/cache-decorator` | 在 decorator 编排层记录缓存决策和基础设施失败 | `@jintianxiayu/logger`（required peer；开发期 workspace 依赖） | 既有 `reflect-metadata`、Redis 客户端 peer 由调用方提供 | 是，按 0.x minor 发布；当前版本线对应 `0.2.0` |
| `@jintianxiayu/logger` | 复用现有命名 Logger、配置、脱敏和异步上下文能力；不修改源码或公共契约 | 无新增 | 既有 Winston/YAML 依赖 | 否；cache 发布包的 peer range 由当前 `0.2.0` 生成 `^0.2.0` |

## Goals / Non-Goals

**Goals:**

- 在不改变缓存结果、异常、key、TTL、请求合并及 Provider 调用边界的前提下，为关键决策提供稳定、可筛选的结构化日志。
- 让依赖方只通过 `@jintianxiayu/logger` 的命名 Logger 配置决定日志是否输出和输出到哪里。
- 将日志故障与缓存/业务结果隔离，并通过字段白名单避免缓存数据进入日志。
- 让每个规范 Scenario 都能映射到聚焦测试，尤其覆盖并发、重复调用、Redis 故障和序列化边界。

**Non-Goals:**

- 不在 `CacheOptions` 或 `CacheEvictOptions` 增加 `logging`、`debug`、Logger 实例或回调。
- 不改变 Provider 协议、Redis key/value 格式、TTL、扫描/删除算法，也不增加 metric、tracing span 或管理 API。
- 不等待、重试或补偿当前 fire-and-forget 的 `set()` 与单 key `delete()`，也不承诺观察其异步拒绝。
- 不由 cache 包初始化或关闭 Logger，不注册进程信号，不创建独立 Winston runtime，也不修改 logger 包。

## Decisions

### 1. 在 decorator 编排层记录决策

日志插入 `cache.ts` 和 `cache-evict.ts` 的现有控制流，在内部新增未导出的日志辅助模块。该层是唯一同时知道
`pending hit`、value/error hit、miss、业务方法成败、key resolver fallback 以及 evict 是否被跳过的位置；内置和自定义
Provider 因而获得一致日志。

备选方案是在 `MemoryCacheProvider`、`RedisCacheProvider` 或 Redis adapter 中记录。这只能看到存储调用，无法区分业务决策，
会遗漏自定义 Provider，并可能造成 decorator 与 Provider 双重输出，因此不采用。

执行顺序保持如下：

1. `@Cache` 先解析 key（resolver 失败时记录 fallback），再检查 `PendingCache`；只有实际执行者才获取 Provider 并读取缓存。
2. `get()` 成功返回 `undefined` 后记录 miss；命中 value/error entry 时先记录 hit，再返回 value 或抛出原缓存异常。
3. miss 后执行业务方法；随后调用 `set()`，只有调用同步返回后才记录 `write_dispatched`。业务异常仍按既有逻辑尝试缓存
   error entry 并重新抛出。
4. `@CacheEvict` 先等待业务方法；业务失败时记录 `evict_skipped` 并原样抛出，不解析 key、不获取 Provider、不删除。
5. 业务成功后获取 Provider。`allEntries: true` 等待 `deleteByPattern()` 后记录 `evict_completed`；单 key 调用
   `delete()` 同步返回后记录 `evict_dispatched`。

Provider 获取、`get()`、已等待的 `deleteByPattern()` 以及自定义 Provider 同步抛出的 `set()`/`delete()` 异常会在重新
抛出前记录 `operation_failed`。现有 `@Cache` 的 `try/catch` 边界不移动：若一个同步 `set()` 异常进入既有 error-entry
写入分支，仍维持原有调用和最终异常行为。

### 2. 使用固定命名 Logger 和固定级别，不增加第二套开关

内部 Logger 名称固定为 `@jintianxiayu/cache-decorator`。依赖方通过 logger 配置中的同名 profile 控制级别、console/file
路由、格式、调用位置和脱敏；cache decorator 不再叠加布尔开关。这样同一业务节点在所有依赖方中保持一致语义，也避免
`logging: true` 但 Logger profile 又过滤日志的双重配置歧义。

事件与级别固定为：

| level | `event` | 触发条件 |
| --- | --- | --- |
| `debug` | `cache.pending_hit` | 同一 key 已有执行中的 Promise，本次复用该 Promise |
| `debug` | `cache.hit` | Provider 返回 value entry 或 cached error entry |
| `debug` | `cache.miss` | Provider 成功读取且返回 `undefined` |
| `debug` | `cache.write_dispatched` | value/error entry 的 `set()` 调用已同步返回，但不表示异步完成 |
| `debug` | `cache.evict_dispatched` | 单 key `delete()` 调用已同步返回，但不表示异步完成 |
| `debug` | `cache.evict_completed` | `deleteByPattern()` 已成功完成 |
| `warn` | `cache.key_fallback` | 自定义 key resolver 抛错，回退默认 key |
| `warn` | `cache.evict_skipped` | 被装饰业务方法失败，因此未执行清除 |
| `error` | `cache.operation_failed` | Provider 获取或可同步观察的 Provider 操作失败 |

不使用 `info`：命中、未命中与写入属于高频诊断事件，默认进入 `info` 会给现有应用引入明显日志量；异常降级和真实故障分别
由 `warn`、`error` 表达。备选方案是让每个节点的 level 可配置，但这会扩大公共 API、增加组合测试并破坏跨应用一致性，
因此不采用。

### 3. Logger 惰性获取且所有日志写入故障隔离

内部辅助模块只导出给包内使用的安全写入函数。它在第一次业务方法实际调用、第一次需要写日志时执行
`LoggerFactory.getLogger('@jintianxiayu/cache-decorator')` 并复用所得 `LoggerInterface`；模块 import、decorator factory
求值及 class 定义期间均不获取 Logger，也不调用 `LoggerFactory.init()`/`shutdown()`。

Logger 获取与 `debug`/`warn`/`error` 调用均包在日志辅助模块自己的 `try/catch` 中。Logger 配置无效、runtime 已关闭、
传输写入或诊断通道异常都不得替换缓存命中结果、Provider 异常或业务异常。失败后不使用 `console` 等第二通道兜底，避免递归、
重复输出及绕过 logger 脱敏。

备选方案是模块顶层立即获取 Logger，写法更短但可能在应用配置装载前锁定默认配置；另一个备选方案是让日志错误向外传播，
会使可观察性反过来成为业务可用性依赖。两者均不采用。

### 4. 采用稳定事件名和字段白名单

每条记录使用稳定的人类可读 message，并以 `meta.event` 作为机器筛选主键。公共字段仅包含：

```typescript
interface CacheLogMetadata {
    event: string;
    cacheName: string;
    methodName: string;
    providerName: string;
    entryType?: 'value' | 'error';
    scope?: 'key' | 'allEntries';
    reason?: 'resolver_error' | 'business_error';
    operation?: 'provider_resolution' | 'read' | 'write' | 'evict';
    error?: unknown;
}
```

`providerName` 使用非空显式名称，否则使用稳定标签 `default`，与 Registry 将空字符串视作默认 Provider 的既有行为一致。
`entryType`、`scope`、`reason`、`operation` 只在对应事件出现。只有 Provider 基础设施失败可携带原始 `error`，并交给
logger 的规范化与脱敏链路；cached business error hit、业务方法异常和 resolver 异常不附带异常内容。

字段中禁止加入完整逻辑/物理 cache key、参数、resolver 返回值、缓存 value、业务返回值或 cached error 内容，也不为这些值
计算 hash，避免日志代码触发额外序列化及敏感数据泄露。`traceId` 等关联字段由已有 `LoggerContext` 自动合并；cache 包既不
读取也不创建上下文。

备选方案是记录 key 或参数摘要，虽然排障信息更多，但 key 常由用户标识和参数组成，hash 也可能被字典反推，并会引入序列化
失败与 CPU 成本，因此不采用。

### 5. 对 fire-and-forget 操作只记录 dispatched

`CacheProvider.set()` 与 `delete()` 的公共返回类型允许 `void | Promise<void>`，现有 decorator 不等待返回值。本次不对返回的
Promise 添加 `await` 或 rejection handler；后者即使不改变返回值，也会改变 `unhandledRejection` 的可观察行为。调用同步返回
后只发 `write_dispatched`/`evict_dispatched`，不会发 success/completed；异步 Redis、TTL、序列化拒绝也不伪装成已完成或
被本次日志捕获。同步抛出的自定义 Provider 错误仍可记录 `operation_failed` 并按原控制流传播。

`deleteByPattern()` 本来就被等待，因此可以在成功后发 `evict_completed`，失败则发 `operation_failed` 且不发 completed。
备选方案是统一等待所有写/删操作，可提供更强日志，但会改变延迟、异常传播和业务结果，超出本变更范围。

### 6. 公共 TypeScript 契约保持不变

`src/index.ts` 不新增 Logger 相关导出；以下相关公共签名、字段、默认值与推导行为保持不变：

```typescript
export type CacheKeyResolver = null | string | ((...args: unknown[]) => string);

export interface CacheOptions {
    ttl?: number;
    providerName?: string;
    key?: CacheKeyResolver;
}

export interface CacheEvictOptions extends Pick<CacheOptions, 'key'> {
    allEntries?: boolean;
    providerName?: string;
}

export function Cache(
    cacheName: string,
    options?: CacheOptions
): (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => void;

export function CacheEvict(
    cacheName: string,
    options?: CacheEvictOptions
): (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => void;

export interface CacheProvider {
    get<T>(key: string): T | undefined | Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): void | Promise<void>;
    delete(key: string): void | Promise<void>;
    clear(): void | Promise<void>;
    deleteByPattern(pattern: string): void | Promise<void>;
}
```

`ttl` 缺省时仍由 Provider 按永不过期处理；`providerName` 缺省或为空时仍使用 Registry 默认 Provider；`key` 为
`undefined`/`null` 时仍用默认 KeyBuilder，字符串和函数 resolver 的行为不变；`allEntries` 缺省时仍为 `false`。
decorator 不改变 TypeScript 声明中的原方法类型推导，也不新增 Logger 类型泄漏。

既有异常继续原样传播：未注册 Provider 的普通 `Error`、key 构建异常、`get()` 与已等待清除的 Provider 异常、业务方法异常
及 cached error；Redis Provider 的 `TypeError`/`RangeError` 或命令错误仍服从当前等待边界。新增日志 API 自身异常被隔离，
因此不形成新的对外 throws 契约。

### 7. 保持 TypeScript legacy decorator 与 metadata 语义

本仓库继续使用 `experimentalDecorators` 的 legacy method decorator：decorator expression 按源码从上到下求值、对同一声明的
decorator 按从下到上应用；每个 decorator 在 class 定义期间捕获当时的 `descriptor.value` 并替换它。新增日志位于运行期
wrapper 内，既不改变 factory/application 顺序，也不绕过其他 decorator；多 decorator 组合时仍围绕其应用时获得的下一层
方法执行。

现有 `reflect-metadata` side-effect import 保留，但 `@Cache`、`@CacheEvict` 当前及本次均不定义、读取或覆盖任何 metadata
key（包括 `design:type`、`design:paramtypes`、`design:returntype`）。`emitDecoratorMetadata` 开启与否不影响日志；本设计不迁移
到 Stage-3 decorator，也不扩展当前仅接受 string `propertyKey` 的公共签名。

### 8. 以 required peer + workspace devDependency 集成 Logger

cache 包在 `peerDependencies` 与 `devDependencies` 同时声明 `@jintianxiayu/logger: "workspace:^"`，不放入普通
`dependencies`。peer 使应用提供并共享唯一进程级 Logger runtime/config/context；devDependency 使 monorepo 编译和测试可解析
类型与实现。`pnpm --filter @jintianxiayu/cache-decorator publish --dry-run` 必须确认 workspace protocol 被转换成基于当前 logger `0.2.0` 的有效 semver range（预期
`^0.2.0`），且没有打包第二份 Logger。

这是安装契约和默认日志副作用的 breaking change；对当前 `0.x` 包采用 minor 版本发布。logger 包没有源码或契约变化，不做
同步版本提升。备选的普通 dependency 可能让包管理器安装第二份 Logger，割裂命名配置与 `LoggerContext`，因此不采用；可选
peer 会让缺失 Logger 的安装静默通过却在运行时不可用，也不符合本功能成为标准可观察契约的定位。

### 9. 测试按 Scenario 建立可审计映射

在 decorator 单元测试中 mock `@jintianxiayu/logger`，断言事件、level、顺序、字段白名单与 Logger 故障隔离；保留真实
Memory/Redis Provider 测试验证原缓存语义，并增加类型声明/pack dry-run 检查。并发测试必须断言相同 key 仍返回同一个 Promise
且只有实际执行者产生 miss/read/write 日志；重复调用和重复 evict 分别验证每次真实决策，不以“测试文件存在”代替 Scenario
覆盖。

任务清单将为规范中的 C01-C06、E01-E04、K01-K03、F01-F05、M01-M04、L01-L04、A01-A03、P01-P02 建立显式测试映射，
最终再执行 cache 包测试、全仓 lint、format check、build 和 test。

## Risks / Trade-offs

- [高频 debug 事件带来调用成本与日志量] → 默认由 Logger level 过滤；只构造标量白名单 metadata，不序列化参数、key 或 value，
  README 明确按命名 Logger 开启 debug。
- [Logger 首次获取可能触发延迟初始化并锁定非预期配置] → 仅在首次运行期日志点惰性获取，并把“应用在首次缓存调用前 init”列为
  升级步骤；测试确保 import 与 decorator 求值无初始化副作用。
- [吞掉 Logger 故障会造成观测盲区] → 这是保持 cache/业务可用性的有意取舍；Logger 自身负责正常传输诊断，cache 不绕过其安全
  链路。应用应独立监控 Logger 初始化与传输健康。
- [fire-and-forget Promise 失败无法由本次事件闭环] → 事件明确命名为 `dispatched`，文档禁止把它解释为成功；完整异步失败观测需在
  后续单独变更中重新评估等待和 rejection 语义。
- [新增 required peer 使升级方安装失败或启动顺序不正确] → 发布说明列出 logger 版本、初始化顺序和命名 profile 示例；发布前以
  pack dry-run 检查实际 peer range，并通知已知下游。
- [Provider 错误对象可能包含敏感字段] → 只在基础设施失败时交给 `@jintianxiayu/logger` 的统一规范化/脱敏链路，不拼接进 message，
  其余异常事件不携带 error 内容。
- [日志辅助逻辑意外改变异常或调用顺序] → 对 Logger API 全面故障注入，并以现有测试加 Scenario 对照断言返回值、Promise identity、
  Provider 次数、顺序和原异常对象 identity。

## Migration Plan

1. 在实现前盘点已知 cache 依赖方使用的 Node/logger 版本与 Logger 初始化位置，告知 required peer、日志副作用和 0.x minor
   升级影响。
2. 依赖方先安装兼容的 `@jintianxiayu/logger`，在导入业务模块后也可配置，但必须在第一次缓存方法调用前执行
   `LoggerFactory.init(...)`；通过名为 `@jintianxiayu/cache-decorator` 的 profile 选择是否开放 debug 及输出目标。
3. 发布前运行全量验证与 `pnpm --filter @jintianxiayu/cache-decorator publish --dry-run`，确认 `.d.ts` 无 Logger 配置扩张、peer range 有效且包内没有独立
   Logger runtime。
4. 先在一个依赖方灰度，检查 hit/miss/dispatched/failed 的相对关系、日志量和脱敏结果，再扩大升级范围。

已发布 npm 版本无法撤回。若实现有问题，发布修订版本修复；需要立即降级的依赖方锁定上一版 `0.1.3`。若仅日志量异常，
先通过命名 Logger profile 提高级别或关闭对应 transport，不必改变 cache 配置。回滚不会处理或删除此前日志：已落盘记录继续按
logger 的既有轮转/保留策略管理。此次不改变 Redis key、value、TTL 或其他数据结构，因此没有 Redis 数据迁移或清理步骤。
