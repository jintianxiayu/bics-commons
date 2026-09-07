## Context

动机与发布影响见 [proposal.md](proposal.md)。当前 `RedisLockProvider` 只有三项锁操作：`SET ... PX ... NX` 获取、比较 token 后 `DEL` 释放、比较 token 后 `PEXPIRE` 续期。`LockProviderRegistry`、装饰器和看门狗均通过 `LockProvider` 使用它，不需要感知 Redis 客户端。

现有 Redis 测试仅 mock `set/eval`，并通过 `as any` 构造 Provider，不能证明真实类型、命令协议或包安装隔离。现有包入口集中导出所有实现；移除运行时 import 时也必须检查生成的声明文件。

## Goals / Non-Goals

**Goals:**

- 将参数转换限定在两个小型适配工厂中；Redis 锁协议只保留一份。
- 调用方继续拥有连接，使用哪个 Redis 库就只直接安装哪个库。
- 通过真实类型、Redis 集成和独立消费项目三个边界验证兼容性。

**Non-Goals:**

- 不抽象通用 Redis SDK，不自动检测客户端，不新增 Provider 层级或适配器独立 npm 包。
- 不提供旧构造参数重载，不改变既有重试、看门狗调度、异常优先级或连接重试配置。
- 不承诺 Cluster、Sentinel 专项支持、非默认 RESP 返回类型、多节点共识锁或故障切换期间的强一致性。

## Decisions

### 1. 新增命令边界，保留锁边界

```text
DistributedLock / Watchdog
            |
       LockProvider
            |
    RedisLockProvider
            |
      RedisLockClient
            |
     +------+------+
     |             |
  ioredis       node-redis
  adapter        adapter
```

`LockProvider` 表示完整的锁后端；新增 `RedisLockClient` 只表达 Redis 锁需要的两个原子操作。没有选择为每个客户端重写 `LockProvider`，因为那会重复维护 token 和 Lua；也没有选择完整客户端类型的联合，因为类型联合本身不能转换调用协议。

以下是公共签名，类型只依赖 TypeScript 内建类型。请求字段全部必填、无默认值，无公共泛型；`readonly` 约束适配器不得修改调用方请求。

```typescript
/** 为 Redis 锁提供原子条件写入和脚本执行边界，连接由调用方持有。 */
export interface RedisLockClient {
    /** 原子设置尚不存在的键及其毫秒过期时间；命令异常通过 Promise 拒绝传播。 */
    setIfAbsent(request: {
        readonly key: string;
        readonly value: string;
        readonly ttlMs: number;
    }): Promise<boolean>;

    /** 执行给定脚本并返回原始响应；脚本或连接异常通过 Promise 拒绝传播。 */
    eval(request: {
        readonly script: string;
        readonly keys: readonly string[];
        readonly arguments: readonly string[];
    }): Promise<unknown>;
}

/** 约束 ioredis 适配器实际使用的命令，不泄漏第三方完整客户端类型。 */
export interface IoredisLockClientSource {
    /** 提供 ioredis 的带毫秒过期时间的 NX 写入调用形状。 */
    set(...args: [key: string, value: string, expiry: 'PX', ttlMs: number, condition: 'NX']): Promise<unknown>;
    /** 提供 ioredis 的脚本、键数量和字符串参数调用形状。 */
    eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

/** 约束 node-redis 适配器实际使用的命令，支持默认响应映射。 */
export interface NodeRedisLockClientSource {
    /** 提供 node-redis 的选项对象形式的 NX 写入调用形状。 */
    set(key: string, value: string, options: { PX: number; NX: true }): Promise<unknown>;
    /** 提供 node-redis 的键和参数分组调用形状。 */
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/** 包装调用方持有的 ioredis 客户端，不创建连接；命令错误由返回对象传播。 */
export declare function createIoredisLockClient(client: IoredisLockClientSource): RedisLockClient;

/** 包装调用方持有的 node-redis 客户端，不创建连接；命令错误由返回对象传播。 */
export declare function createNodeRedisLockClient(client: NodeRedisLockClientSource): RedisLockClient;

/** 通过客户端无关的操作边界执行 Redis 锁协议。 */
export declare class RedisLockProvider implements LockProvider {
    constructor(client: RedisLockClient);
    acquire(key: string, ttl: number): Promise<string | null>;
    release(key: string, token: string): Promise<boolean>;
    renew(key: string, token: string, ttl: number): Promise<boolean>;
}
```

`key/value/script` 是原始字符串；`keys/arguments` 可为空数组，适配层按传入顺序执行。`ttlMs/ttl` 使用毫秒；正常加锁调用传入正整数，非法 TTL 的服务器错误继续传播，不增加截断、默认 TTL 或参数修复逻辑。空字符串 key 仍是合法 Redis key；缺少必填字段以及 `null/undefined` 客户端由 TypeScript 严格类型检查拒绝，不承诺对绕过类型检查的任意对象进行运行时认证。

### 2. 两个显式工厂只转换调用和响应

| 操作 | ioredis | node-redis |
| --- | --- | --- |
| 条件写入 | `client.set(key, value, 'PX', ttlMs, 'NX')` | `client.set(key, value, { PX: ttlMs, NX: true })` |
| 脚本执行 | `client.eval(script, keys.length, ...keys, ...arguments)` | `client.eval(script, { keys: [...keys], arguments: [...arguments] })` |

SET 的 `'OK'` 映射为 `true`，`null` 映射为 `false`；其他响应拒绝为 `TypeError`，避免将不兼容响应误判成正常竞争。EVAL 响应原样返回，Provider 延续 `result === 1` 的成功判定。命令拒绝保留原始错误对象，不包装、不记录日志、不降级成成功或未获取锁。

始终通过 `client.set(...)` / `client.eval(...)` 调用以保留 `this`，不拆出未绑定方法。适配器不改写 key、不修改请求或数组、不注册连接监听器，不修改已有连接选项。使用原有命令入口也保留 ioredis 自身对 keyPrefix 的处理；互操作测试必须让两端最终 Redis key 一致。

接口使用 `{ PX, NX }` 作为 node-redis 5 的调用子集。当前官方实现仍支持这两个字段，同时将其标记为推荐迁移到新选项名称；这里保留该子集以避免只支持较新的 5.x 版本。实施时以锁定的真实版本完成类型验证，不能根据方法名称推断兼容性。参考 [Redis 客户端迁移文档](https://github.com/redis/docs/blob/main/content/develop/clients/nodejs/migration.md)、[node-redis SET 实现](https://github.com/redis/node-redis/blob/master/packages/client/lib/commands/SET.ts) 和 [EVAL 实现](https://github.com/redis/node-redis/blob/master/packages/client/lib/commands/EVAL.ts)。

### 3. Provider 保留数据协议和外部行为

- `acquire` 为每次尝试生成 UUID v4 token，只调用一次 `setIfAbsent`；成功返回 token，竞争失败返回 `null`。
- `release` 使用现有 Lua，传入单一 key 和 token；token 相等时删除，其他情况返回 `false`。
- `renew` 使用现有 Lua，参数为 token 与 `String(ttl)`；token 相等时更新 TTL，其他情况返回 `false`。
- 不新增 key 前缀、token 包装、序列化层或锁元数据；不使用分开的 `GET` 与 `DEL/PEXPIRE` 实现比较更新。
- Redis 错误从三项 Provider 操作传播；`acquire` 拒绝会阻止装饰器执行业务，不把 Redis 不可用当作普通竞争来重试。连接自身的离线队列、重连和超时行为仍由调用方配置，本包不承诺额外的失败时限。

客户端选择不会改变装饰器契约。`@DistributedLock` 继续使用 legacy 装饰器和 `design:returntype` 元数据，在装饰器应用时检查异步返回类型，在方法调用时从默认注册表取得 Provider。运行顺序仍为获取锁及竞争重试、启动看门狗、执行原方法、在 `finally` 中停止看门狗并释放锁。继续依赖 `experimentalDecorators`、`emitDecoratorMetadata` 和 `reflect-metadata`，不加入新的元数据键，也不改变与其他装饰器的组合顺序。

### 4. 安装隔离与文件安排

新增 `src/core/redis-lock-client.ts` 保存三项公共接口，新增 `src/adapters/ioredis-lock-client.ts` 和 `src/adapters/node-redis-lock-client.ts` 保存工厂。更新 `src/core/redis-lock-provider.ts` 和 `src/index.ts`。Provider 单元测试改为 mock `RedisLockClient`；客户端命令形状在各适配器测试中验证。

本包将 ioredis `^5.10.1` 移入 `devDependencies`，增加 `redis` 5.x 开发依赖并锁定实际验证版本；`reflect-metadata` 和 `uuid` 保留原依赖。新增 redis 开发依赖是为了验证真实协议与类型，纯 mock 无法替代。没有选择运行时依赖或必选 peerDependency，因为实现不自行导入、创建客户端；没有选择可选 peerDependency，因为公共接口没有第三方类型引用或运行时加载需求。

源码和生成 `.d.ts` 都不得 import、require 或通过类型引用依赖两个客户端。最小结构接口必须能接收真实客户端实例，类型用例不得通过 `any`、双重断言或放宽严格检查逃避适配；独立消费项目明确设置 `skipLibCheck: false`。

### 5. 验证边界与场景映射

规格场景采用稳定标识；`tasks.md` 为每个标识指定测试文件和用例名。既有用例可承接场景，但必须保留可核对的对应关系，不能把 CLI 的规格格式校验作为测试覆盖证明。

- 单元测试：Provider 协议、适配器参数和响应、调用上下文、错误传播、请求不变性。
- 类型测试：实际 ioredis 与 node-redis 实例无断言传入；自定义 `RedisLockClient` 可用；旧裸客户端构造、缺少必填项及错误工厂配对被拒绝。用 Jest 测试调用 TypeScript 检查测试夹具，保证进入常规测试流程。
- Redis 集成：在专用测试 Redis 上验证两种客户端、并发竞争、TTL、错误 token、过期后重新获取、前缀和旧协议互操作。测试使用唯一 key，只清理自身数据；连接由测试夹具建立和关闭。通过 `LOCK_DECORATOR_TEST_REDIS_URL` 显式配置测试服务，禁止使用生产连接。环境未提供时集成套件可以明确报告跳过，但本变更的集成验收任务不能勾选完成。
- 包消费集成：构建并打包本包，在 workspace 之外创建三个临时消费项目，分别安装 node-redis、ioredis、均不安装；验证运行时入口、公共声明及各自用法。项目不能继承 workspace 的 node_modules 或 NODE_PATH，检查实际依赖树，避免其他包的 ioredis 掩盖泄漏。不安装任一客户端的项目使用自定义 `RedisLockClient/LockProvider`；还应能够仅导入全部适配工厂。
- 既有装饰器、注册表与看门狗测试保留，配合受影响包测试和全仓库 lint、format、build、test 完成回归。

## Risks / Trade-offs

- [公共构造签名破坏] → 以 `0.2.0` 发布，README 提供前后初始化对照；实施范围只准备本包 minor 变更记录，实际发版仍走已有本地发布流程。
- [第三方类型重载随版本变化] → 记录锁文件版本并用真实实例类型检查。测试通过范围限定为本次锁定的 ioredis 5 / node-redis 5 版本；后续扩展客户端版本需再次验证。
- [某些客户端配置改变响应类型] → 支持默认字符串和整数响应；SET 非标准响应抛 `TypeError`，用户可自定义 `RedisLockClient` 显式转换，内置适配器不猜测 Buffer 或自定义映射。
- [连接前缀或数据库不同导致锁不互斥] → 不重写 key，文档说明互操作前提，并覆盖 ioredis keyPrefix 与 node-redis 显式前缀的同键测试。
- [断连行为由连接配置决定] → 以命令 Promise 拒绝传播为契约，不额外启动重试或降级；真实断连测试配置有限超时和禁用离线排队，防止测试悬挂。
- [既有看门狗续期拒绝未捕获，释放异常可能覆盖业务异常] → 记录为范围外限制；本变更不新增异步调度，不把 Provider 的错误传播验收解释为这两类流程问题已修复。
- [本地缺少 Redis 或外部下游名单] → 集成和发布前通知分别保留明确的未完成状态；不能用 mock 结果或未发现依赖来替代证据。

## Migration Plan

1. 实现并完成规格映射、类型、真实 Redis、消费项目和全仓库检查；通过 pnpm 变更记录将本包计划为 minor，版本从当前 `0.1.3` 推进到 `0.2.0`，不批量推进其他包。
2. 发布前由维护者盘点外部消费者并通知构造签名与安装依赖变化。仓库内目前没有其他包依赖本包；外部服务名单尚未提供，作为发布准备事项记录。
3. 下游直接声明所用客户端，复用现有实例并通过相应工厂构造 Provider；注册默认 Provider 和业务装饰器保持原写法。确认 Redis 数据库及有效 key 一致后可分批升级，不需要停机清理旧锁。
4. 回退时让下游锁定 `0.1.3` 并恢复旧构造方式；若需要保留新 API，则发布修订版本。不得以撤回已发布 npm 包作为回退前提。锁值和 TTL 协议未改变，已写入锁无需迁移或删除；本包不新增落盘日志。
