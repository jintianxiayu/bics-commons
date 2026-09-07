## Context

动机与发布影响见 [proposal.md](proposal.md)，行为边界见 [redis-cache-client spec](specs/redis-cache-client/spec.md) 与 [cache-evict-allentries-prefix delta](specs/cache-evict-allentries-prefix/spec.md)。当前 `RedisCacheProvider` 同时承担值序列化、缓存语义和 ioredis 命令调用，并在缺少构造参数时创建无法由调用方管理的连接。ioredis 与 node-redis 在 TTL 写入方法、DEL 参数、SCAN 参数及响应、FLUSHDB 方法名上不同，不能通过一个裸客户端联合类型安全复用。

`CacheProviderRegistry` 和装饰器只依赖 `CacheProvider`，因此客户端差异可以限制在 `RedisCacheProvider` 下方。仓库内 `lock-decorator` 已采用“协议 Provider + 最小客户端接口 + 显式适配工厂”的结构；cache-decorator 沿用该边界，但需要额外处理 JSON、SCAN 和 keyPrefix。本变更只涉及 cache-decorator，一个包即可独立发版。

当前 Redis key 与值是跨进程协议：key 由现有 `KeyBuilder` 或调用方提供，字符串原样写入，其他值使用 JSON，TTL 使用秒。`clear()` 当前执行数据库级 FLUSHDB。设计必须保留这些已发布语义，不能借客户端解耦引入新命名空间或缩小清库范围。

## Goals / Non-Goals

**Goals:**

- 让 Redis 缓存协议只实现一次，并通过显式适配器支持 ioredis 5、node-redis 5 和自定义客户端。
- 让调用方完整拥有连接生命周期，并只安装实际使用的 Redis 客户端。
- 保持成功路径的数据格式、key、TTL、装饰器和注册表契约，修正 keyPrefix 下 pattern 删除无法可靠命中的问题。
- 用真实类型、真实 Redis 和独立消费项目验证类型、命令、互操作与依赖隔离。

**Non-Goals:**

- 不抽象完整 Redis SDK，不自动识别客户端，不新增适配器独立 npm 包。
- 不支持或承诺 Cluster 跨分片扫描、Sentinel 专项切换、自定义 RESP Buffer 映射及 Redis 模块命令。
- 不改变 `CacheProvider`、`CacheProviderRegistry`、key 构造规则、请求合并或错误结果缓存格式。
- 不改变装饰器当前对异步 `provider.set` 和单条 `provider.delete` 的等待行为；该错误时序问题另行处理。
- 不修复 `Error` 对象经 JSON 序列化后丢失非枚举字段的问题，也不把 `clear()` 改为前缀范围清理。

## Decisions

### 1. 在 Redis Provider 下增加最小命令边界

```text
@Cache / @CacheEvict
          |
 CacheProviderRegistry
          |
 RedisCacheProvider        JSON、TTL、miss、SCAN 循环
          |
  RedisCacheClient         规范化字符串命令
       +--+--+
       |     |
   ioredis  node-redis
   adapter   adapter
```

`CacheProvider` 继续表示完整缓存后端；`RedisCacheClient` 只表示 Redis Provider 实际需要的字符串命令。没有让每个适配器直接实现 `CacheProvider`，因为那会复制 JSON、TTL 与多页扫描逻辑；也没有让 Provider 接收完整客户端联合类型，因为联合类型无法消除命令签名和响应差异。

以下为公共签名。请求对象使用只读字段，避免适配器修改调用方输入；匿名请求与响应结构不增加额外导出。所有公共方法都显式声明返回类型。

```typescript
/** Redis 缓存所需的最小字符串命令边界，连接由调用方持有。 */
export interface RedisCacheClient {
    get(key: string): Promise<string | null>;

    set(request: { readonly key: string; readonly value: string; readonly ttlSeconds?: number }): Promise<void>;

    deleteMany(keys: readonly string[]): Promise<void>;

    scan(request: { readonly cursor: string; readonly pattern: string; readonly count: number }): Promise<{
        readonly cursor: string;
        readonly keys: readonly string[];
    }>;

    flushDatabase(): Promise<void>;
}

/** ioredis 适配器实际使用的结构，不引用第三方声明。 */
export interface IoredisCacheClientSource {
    readonly options: { readonly keyPrefix?: string };
    get(key: string): Promise<unknown>;
    set(key: string, value: string): Promise<unknown>;
    setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
    del(...keys: string[]): Promise<unknown>;
    scan(cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', limit: number): Promise<unknown>;
    flushdb(): Promise<unknown>;
}

/** node-redis 适配器实际使用的结构，不引用第三方声明。 */
export interface NodeRedisCacheClientSource {
    get(key: string): Promise<unknown>;
    set(key: string, value: string): Promise<unknown>;
    setEx(key: string, ttlSeconds: number, value: string): Promise<unknown>;
    del(keys: string | string[]): Promise<unknown>;
    scan(cursor: string, options: { MATCH: string; COUNT: number }): Promise<unknown>;
    flushDb(): Promise<unknown>;
}

/** node-redis 没有透明 keyPrefix，通过适配器显式保持逻辑命名空间。 */
export interface NodeRedisCacheClientOptions {
    readonly keyPrefix?: string;
}

export declare function createIoredisCacheClient(client: IoredisCacheClientSource): RedisCacheClient;

export declare function createNodeRedisCacheClient(
    client: NodeRedisCacheClientSource,
    options?: NodeRedisCacheClientOptions
): RedisCacheClient;

export declare class RedisCacheProvider implements CacheProvider {
    constructor(client: RedisCacheClient);
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    deleteByPattern(pattern: string): Promise<void>;
}
```

`NodeRedisCacheClientOptions.keyPrefix` 可选，缺省为 `''`；它只增加到物理 key，不改变 Provider 接收的逻辑 key。`RedisCacheClient.set.ttlSeconds` 可选，缺省表示普通 SET。`RedisCacheProvider` 不提供构造重载或默认参数。公共泛型仍只存在于 Provider 的 `get<T>/set<T>`；客户端边界固定为字符串，避免把业务类型推导泄漏到适配层。

Provider 在 TTL 不是 `undefined` 或 `0` 时要求其为正有限整数；不满足时在命令前抛 `RangeError`。值无法序列化为字符串时抛 `TypeError`。适配器响应结构不受支持时抛 `TypeError`。客户端 Promise 拒绝保留原始错误对象，不包装成新错误。

### 2. Provider 保留序列化、TTL 与扫描循环

`RedisCacheProvider` 改为保存 `RedisCacheClient`，其外部方法保持现有返回类型：

- `get` 将 `null` 映射为 `undefined`；非 null 字符串先 `JSON.parse`，解析失败时返回原字符串。由此保留合法 JSON 文本字符串会被解析的既有行为。
- `set` 对字符串原样写入，对其他值使用 `JSON.stringify`。若结果不是字符串则拒绝，不把 `undefined` 隐式传给客户端。正整数 TTL 作为 `ttlSeconds` 传递，`undefined` 与 `0` 省略该字段。
- `delete` 调用 `deleteMany([key])`；`deleteMany([])` 在适配器内直接完成，不发送无参数 DEL。
- `deleteByPattern` 从游标 `'0'` 开始，重复调用 `scan({ pattern, count: 100 })`，仅在页面非空时批量删除，直到返回游标 `'0'`。空页和重复 key 均可继续；失败时保留已删除页面并传播错误，调用方可以幂等重试。
- `clear` 始终调用 `flushDatabase`，不受 keyPrefix 影响。

没有选择新的版本化 envelope 或序列化器注入，因为它会改变存量值格式并扩大迁移范围。非法 TTL 的确定性校验只影响此前未定义且由 Redis 客户端偶然处理的错误输入，不改变受支持的成功路径。

### 3. 适配器只转换命令、响应与有效 key

| 操作     | ioredis                         | node-redis                               |
| -------- | ------------------------------- | ---------------------------------------- |
| GET      | `client.get(key)`               | `client.get(prefix + key)`               |
| 普通写入 | `client.set(key, value)`        | `client.set(prefix + key, value)`        |
| 秒级写入 | `client.setex(key, ttl, value)` | `client.setEx(prefix + key, ttl, value)` |
| 删除     | `client.del(...keys)`           | `client.del(prefixedKeys)`               |
| 扫描     | tuple 响应 `[cursor, keys]`     | 对象响应 `{ cursor, keys }`              |
| 清库     | `client.flushdb()`              | `client.flushDb()`                       |

ioredis 的普通 key 命令继续接收逻辑 key，由客户端已有 `options.keyPrefix` 自动增加物理前缀。SCAN 的 pattern 不是 key 参数、响应也不会自动去除前缀，因此适配器必须特殊处理。node-redis 没有该透明选项，适配器对所有 key 命令显式应用 `NodeRedisCacheClientOptions.keyPrefix`。

两个适配器使用同一内部前缀辅助逻辑：

1. 精确命令的物理 key 为字面前缀与逻辑 key 的拼接；ioredis 由客户端执行，node-redis 由适配器执行。
2. SCAN 的物理 pattern 为“按 Redis glob 规则转义后的字面前缀 + 原逻辑 pattern”。只转义前缀中的反斜杠、`*`、`?`、`[` 和 `]`，不转义调用方 pattern。
3. 扫描返回的每个物理 key 必须以字面前缀开头；适配器剥离一次前缀后返回逻辑 key。异常响应或不匹配前缀以 `TypeError` 拒绝，避免扩大删除范围。
4. Provider 将逻辑 key 传给 `deleteMany`；ioredis 再由自身增加一次前缀，node-redis 由适配器增加一次，最终均只访问同一个物理 key。

适配器始终以 `client.method(...)` 调用，不能拆出未绑定方法。GET 只接受字符串或 `null`；SET/SETEX 与 FLUSHDB 只接受 `'OK'`；DEL 只接受非负整数；SCAN 分别校验 tuple 或对象、字符串游标和字符串 key 数组。默认 RESP Buffer 或自定义映射不猜测转换，调用方可实现自定义 `RedisCacheClient`。

### 4. 连接生命周期完全归调用方

工厂只闭包引用已存在连接，不调用构造、`connect`、`quit`、`disconnect`、`close`、`destroy`，不注册或删除监听器，不修改客户端 options、离线队列、超时或重连策略。多个 Provider 可以共享同一个适配结果或同一底层连接；Provider 和注册表没有 dispose API。

命令失败时间由调用方连接配置决定。Redis 不可用或超时时，直接 Provider 操作传播客户端原始拒绝，不创建备用连接、不切换 Memory Provider、不记录日志。测试中的断连客户端必须配置有限超时并禁用或限制离线排队，避免测试悬挂。

### 5. 装饰器求值和执行顺序不变

`@Cache` 与 `@CacheEvict` 继续使用 TypeScript legacy method decorator，在类定义阶段替换 descriptor，在实例调用阶段从 `CacheProviderRegistry` 解析 Provider。本变更不新增或读取任何 reflect-metadata key；`@Cache` 现有的 `reflect-metadata` side-effect import 保留，`emitDecoratorMetadata` 的内容不参与客户端选择，仍依赖项目启用 `experimentalDecorators` 的现有编译方式，不采用 stage-3 decorator 语义。

运行顺序保持原样：`@Cache` 先检查进程内 pending，再读取 Provider，miss 后执行原方法并触发现有缓存写入；`@CacheEvict` 先等待原方法成功，`allEntries` 路径等待 pattern 删除，单条路径保持当前删除触发方式。多个装饰器的组合顺序仍由 TypeScript legacy descriptor 应用顺序决定，适配器不新增元数据或包装层。

### 6. 安装隔离、文件安排与验证边界

新增 `src/core/redis-cache-client.ts` 保存四项公共接口，新增 `src/adapters/ioredis-cache-client.ts`、`src/adapters/node-redis-cache-client.ts` 和内部前缀辅助文件；更新 `src/core/redis-cache.ts` 与 `src/index.ts`。Provider 测试使用 `RedisCacheClient` fake；两个客户端的命令形状在独立适配器测试中验证。

包清单将 ioredis `^5.10.1` 移入 `devDependencies`，并增加 `redis` 5.x 开发依赖。适配器源码只导入仓库内结构接口，JavaScript、`.d.ts` 和 package manifest 均不得产生客户端运行时或类型依赖。没有选择 optional peerDependency，因为包既不 import 客户端也不需要包管理器验证其存在，声明 peer 反而会扩大下游安装和告警面。

验证分为四层：

- 单元测试覆盖 Provider 数据语义、适配器命令/响应、前缀、异常、幂等和调用上下文。
- 类型测试使用真实 ioredis/node-redis 类型并验证负例，不允许 `any`、双重断言或 `skipLibCheck` 掩盖问题。
- 专用 Redis 集成测试覆盖双向读写、TTL、删除、清库、多页扫描、前缀、断连和 `0.1.3` 数据兼容；测试使用独立数据库或隔离 Redis，绝不连接生产资源。
- 包消费测试构建 tarball，在 workspace 外分别验证无客户端、仅 ioredis、仅 node-redis 三个项目的安装树、严格编译、入口导入和真实运行，防止 workspace 依赖提升掩盖泄漏。

## Risks / Trade-offs

- [构造签名破坏现有调用] → 以 `0.2.0` 发布，README 提供前后初始化与连接关闭示例；发布前盘点并通知外部消费者。
- [第三方命令重载随版本变化] → 锁定实际验证的 ioredis 5 与 node-redis 5 版本，用真实实例完成严格类型和运行测试；其他版本不在首版承诺内。
- [前缀含 glob 字符时误匹配或扩大删除] → 仅对字面前缀做集中转义，校验每个扫描结果的物理前缀，并覆盖特殊字符测试。
- [SCAN 不是快照且失败会留下部分删除] → 保持 Redis 游标语义，按页幂等删除并传播原始错误；文档不承诺与并发写入之间的原子全删。
- [clear 会删除共享数据库中的非缓存 key] → 明确保留既有数据库级语义，README 强警示，集成测试只使用专用数据库；命名空间清理另立变更。
- [装饰器未等待部分异步写删错误] → 明确为范围外既有行为，本变更只对直接 Provider/adapter 调用承诺异常传播，不宣称修复端到端错误时序。
- [合法 JSON 文本字符串读取后类型变化] → 保留已发布优先 JSON 解析规则并加入兼容测试，不在解耦变更中迁移序列化格式。
- [外部下游名单未知] → 发布任务保留人工盘点和通知检查点，未确认前不执行 `0.2.0` 发布。

## Migration Plan

1. 实现接口、适配器和 Provider，完成规格到测试映射、真实 Redis、消费项目及全仓库检查；新增本包 minor changeset，不直接发布。
2. README 分别给出 ioredis 与 node-redis 安装、连接、适配、注册和调用方关闭连接示例，并警示 `clear()` 范围及首版支持边界。
3. 发布前盘点外部消费者并通知：ioredis 用户把裸连接包装为 `createIoredisCacheClient(redis)`；node-redis 用户直接安装 `redis`、先完成连接，再用 `createNodeRedisCacheClient(client, { keyPrefix })`；应用关闭阶段自行关闭连接。
4. 下游保持原 Redis database、逻辑 key 和等价物理前缀后分批升级。新旧版本可共用存量 key，无需停机扫描、重写或清理数据。
5. 回退时让下游锁定 `0.1.3` 并恢复旧构造方式，或在 `0.2.x` 发布修订版本；已发布 npm 版本不可作为可撤回资产处理。缓存格式未变化，不需要数据回滚；本包不新增落盘日志。
