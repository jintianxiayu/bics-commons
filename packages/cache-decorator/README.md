# @jintianxiayu/cache-decorator

为 TypeScript 异步方法提供声明式缓存、缓存清除、请求合并，以及 Memory、Redis 和自定义缓存后端。

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [异常缓存策略](#异常缓存策略)
- [缓存日志](#缓存日志)
- [Redis](#redis)
- [异常缓存迁移](#异常缓存迁移)
- [API](#api)

## 安装

Logger 是必需的 peer dependency；基础包不绑定任何 Redis SDK：

```bash
pnpm add @jintianxiayu/cache-decorator @jintianxiayu/logger reflect-metadata
```

需要 Redis 时，只安装应用实际使用的客户端：

```bash
pnpm add redis
# 或
pnpm add ioredis
```

## 快速开始

```typescript
import 'reflect-metadata';
import { Cache, CacheEvict, CacheProviderRegistry, MemoryCacheProvider } from '@jintianxiayu/cache-decorator';
import { LoggerFactory } from '@jintianxiayu/logger';

LoggerFactory.init({
    root: {
        level: 'info',
        console: { enabled: true },
        file: { enabled: false },
    },
    loggers: {
        '@jintianxiayu/cache-decorator': {
            level: 'debug',
            console: { enabled: true, format: 'json' },
        },
    },
});

CacheProviderRegistry.register('memory', new MemoryCacheProvider());
CacheProviderRegistry.setDefault('memory');

class UserService {
    @Cache('user-cache', { ttl: 60 })
    async getUser(id: number): Promise<{ id: number; name: string }> {
        return { id, name: 'test' };
    }

    @CacheEvict('user-cache')
    async updateUser(id: number): Promise<{ id: number; updated: boolean }> {
        return { id, updated: true };
    }
}
```

`ttl` 的单位是秒；`undefined` 或 `0` 表示不设置过期时间。

业务异常默认不写入 Provider。只有显式配置 `errorCache` 时才会持久化异常，且异常必须使用独立的有限 TTL。

> `@Cache` 和 `@CacheEvict` 仅适用于返回 Promise 的方法。装饰同步方法会让调用方收到 Promise，而不是原返回值。

### 自定义缓存 Key

`key` 可以是固定字符串或根据方法参数计算的函数：

```typescript
class UserService {
    @Cache('config', { key: 'global-config' })
    async getConfig(): Promise<{ enabled: boolean }> {
        return { enabled: true };
    }

    @Cache('user', { key: (...args: unknown[]) => String(args[0]) })
    async getUser(id: number): Promise<{ id: number }> {
        return { id };
    }

    @CacheEvict('user', { key: (...args: unknown[]) => String(args[0]) })
    async deleteUser(id: number): Promise<{ id: number; deleted: boolean }> {
        return { id, deleted: true };
    }
}
```

## 异常缓存策略

默认关闭异常缓存可以避免数据库、网络、超时、限流等瞬时故障被持续放大。只有能够安全复用的稳定业务异常才应通过白名单筛选器短时缓存：

```typescript
class UserNotFoundError extends Error {}

class UserService {
    @Cache('user', {
        ttl: 300,
        errorCache: {
            ttl: 10,
            shouldCache: (error: unknown): boolean => error instanceof UserNotFoundError,
        },
    })
    async getUser(id: number): Promise<{ id: number }> {
        throw new UserNotFoundError(`User ${id} not found`);
    }
}
```

- `errorCache` 省略时，业务异常不会持久化；相同 key 的执行中调用仍会复用同一个 pending Promise。
- `errorCache.ttl` 必须是大于零的有限整数秒，不能继承正常结果的 `ttl`。非法值会在 legacy decorator 求值时抛出 `RangeError`。
- `shouldCache` 省略时会接受所有业务异常；返回 `false` 或自身抛错时按 fail-closed 跳过写入，并继续抛出原业务异常。
- Provider 解析/读取、key resolver、Logger 和 codec 的故障不会作为业务异常缓存。
- 异常写入沿用 fire-and-forget 边界；同步可观察的 Provider 写入失败不会替换已经发生的业务异常。

默认 codec 会把标准 `Error` 保存为只包含 `name` 和 `message` 的 JSON payload。缓存命中会创建新的 `Error`，不保留原对象身份、`stack`、自定义原型或任意自有属性。非 `Error` 抛出值必须能安全 JSON 往返；`undefined`、函数、symbol、循环引用和非有限数会跳过写入。

错误消息仍可能包含敏感信息。需要脱敏或恢复领域错误类型时，应提供成对的自定义 codec，并确保共享同一 cache key 的所有进程使用兼容协议：

```typescript
import { Cache, type CacheErrorCodec } from '@jintianxiayu/cache-decorator';

class UserNotFoundError extends Error {
    constructor(readonly code: string) {
        super('User not found');
        this.name = 'UserNotFoundError';
    }
}

const userNotFoundCodec: CacheErrorCodec = {
    encode(error: unknown): unknown {
        if (!(error instanceof UserNotFoundError)) {
            throw new TypeError('Unsupported error');
        }
        return { code: error.code };
    },
    decode(payload: unknown): unknown {
        if (typeof payload !== 'object' || payload === null || !('code' in payload)) {
            throw new TypeError('Invalid error payload');
        }
        return new UserNotFoundError(String(payload.code));
    },
};

class UserService {
    @Cache('user', {
        errorCache: {
            ttl: 10,
            shouldCache: (error: unknown): boolean => error instanceof UserNotFoundError,
            codec: userNotFoundCodec,
        },
    })
    async getUser(): Promise<never> {
        throw new UserNotFoundError('USER_NOT_FOUND');
    }
}
```

## 缓存日志

缓存装饰器使用名称固定为 `@jintianxiayu/cache-decorator` 的 Logger。应用必须安装兼容版本的
`@jintianxiayu/logger`，并在第一次调用被装饰方法前完成 `LoggerFactory.init()`；应用退出时仍由应用统一调用
`LoggerFactory.shutdown()`。仅导入包、声明 decorator 或定义 class 不会提前获取 Logger，cache 包也不会自行初始化或关闭
Logger。

日志的 level、console/file transport、格式和脱敏只由同名 Logger profile 控制，不需要也不支持
`CacheOptions.logging`、`debug` 或 Logger 回调。高频正常决策默认使用 `debug`，可恢复回退使用 `warn`，缓存基础设施失败使用
`error`；逐调用事件不使用 `info`。

| level   | event                       | 含义                                                   |
| ------- | --------------------------- | ------------------------------------------------------ |
| `debug` | `cache.pending_hit`         | 复用相同 key 的执行中 Promise                          |
| `debug` | `cache.hit`                 | 命中 value 或当前策略可解码的 error 条目               |
| `debug` | `cache.miss`                | Provider 正常返回未命中或异常条目被安全旁路            |
| `debug` | `cache.write_dispatched`    | `set()` 已同步返回控制权，不表示异步写入成功           |
| `debug` | `cache.error_cache_skipped` | 策略禁用、筛选拒绝或存量异常条目被安全旁路             |
| `debug` | `cache.evict_dispatched`    | 单 key `delete()` 已同步返回控制权，不表示异步删除成功 |
| `debug` | `cache.evict_completed`     | 已等待的 `deleteByPattern()` 正常完成                  |
| `warn`  | `cache.key_fallback`        | 自定义 key resolver 失败，已回退默认 key               |
| `warn`  | `cache.error_cache_failed`  | 异常筛选、encode 或 decode 失败，已 fail-closed        |
| `warn`  | `cache.evict_skipped`       | 业务方法失败，淘汰被跳过                               |
| `error` | `cache.operation_failed`    | Provider 解析或可观察的读取、写入、淘汰操作失败        |

`write_dispatched` 和 `evict_dispatched` 只描述调用已发起。为保持既有时序，decorator 不等待 `set()` 或单 key
`delete()` 返回的 Promise，也不为日志附加 rejection handler；异步失败不会被描述为成功或完成。只有本来就会等待的全量淘汰可记录
`evict_completed`。

每条日志只包含 `event`、`cacheName`、`methodName`、`providerName`，并按事件增加 `entryType`、`scope`、
`reason`、`phase`、`operation` 或基础设施 `error`。日志不会包含方法参数、业务返回值、缓存值、业务异常内容、codec
payload、策略回调错误或完整逻辑/物理 cache key，也不会为日志额外序列化这些值。Provider 错误和现有
`LoggerContext` 的 `traceId` 继续由 Logger 统一规范化、脱敏和关联；cache 包不直接读写 LoggerContext。Logger 自身同步失败会被隔离，不会替换缓存结果、业务结果或原始 Provider 错误。

## Redis

`RedisCacheProvider` 从 0.2.0 起必须接收已经适配的 `RedisCacheClient`。库不会创建、连接、重连或关闭 Redis
连接，也不会修改连接选项与错误监听器；这些生命周期操作始终由应用负责。

### node-redis

```typescript
import { createClient } from 'redis';
import { CacheProviderRegistry, RedisCacheProvider, createNodeRedisCacheClient } from '@jintianxiayu/cache-decorator';

const redis = createClient({ url: process.env.REDIS_URL });

export async function startCache(): Promise<void> {
    redis.on('error', (error: Error) => console.error('Redis error', error));
    await redis.connect();
    const client = createNodeRedisCacheClient(redis, { keyPrefix: 'my-app:' });
    CacheProviderRegistry.register('redis', new RedisCacheProvider(client));
    CacheProviderRegistry.setDefault('redis');
}

export async function stopCache(): Promise<void> {
    if (redis.isOpen) {
        await redis.quit();
    }
}
```

### ioredis

```typescript
import Redis from 'ioredis';
import { CacheProviderRegistry, RedisCacheProvider, createIoredisCacheClient } from '@jintianxiayu/cache-decorator';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    keyPrefix: 'my-app:',
});

export async function startCache(): Promise<void> {
    redis.on('error', (error: Error) => console.error('Redis error', error));
    await redis.connect();
    CacheProviderRegistry.register('redis', new RedisCacheProvider(createIoredisCacheClient(redis)));
    CacheProviderRegistry.setDefault('redis');
}

export function stopCache(): void {
    redis.disconnect();
}
```

### 自定义 RedisCacheClient

其他 Redis SDK 或封装只需实现最小字符串命令接口，不必继承内置适配器：

```typescript
import { CacheProviderRegistry, RedisCacheProvider, type RedisCacheClient } from '@jintianxiayu/cache-decorator';

interface StorageCommands {
    read(key: string): Promise<string | null>;
    write(key: string, value: string, ttlSeconds?: number): Promise<void>;
    remove(keys: readonly string[]): Promise<void>;
    scan(cursor: string, pattern: string, count: number): Promise<{ cursor: string; keys: readonly string[] }>;
    clearDatabase(): Promise<void>;
}

declare const storage: StorageCommands;

const client: RedisCacheClient = {
    get: (key) => storage.read(key),
    set: ({ key, value, ttlSeconds }) => storage.write(key, value, ttlSeconds),
    deleteMany: (keys) => storage.remove(keys),
    scan: ({ cursor, pattern, count }) => storage.scan(cursor, pattern, count),
    flushDatabase: () => storage.clearDatabase(),
};

CacheProviderRegistry.register('redis', new RedisCacheProvider(client));
```

### 前缀与数据兼容

- ioredis 继续使用连接的 `keyPrefix`；适配器会补齐 `SCAN` 不自动处理前缀的差异。
- node-redis 没有透明 `keyPrefix`，应在 `createNodeRedisCacheClient(client, { keyPrefix })` 中传入等价的字面前缀。
- 两种客户端连接同一 database、使用相同最终物理 key 时，可以互读既有缓存。字符串、JSON、miss 映射和秒级 TTL
  格式均与 0.1.3 保持一致，无需重写或清空数据。
- 原始字符串读取时仍会优先尝试 `JSON.parse`；例如缓存文本 `"true"` 会读为布尔值 `true`，这是既有兼容行为。

`deleteByPattern()` 使用 `SCAN COUNT 100` 分页删除。它不是原子快照；并发写入时不承诺一次删除全部匹配项，命令中途失败后可幂等重试。

> **危险：`RedisCacheProvider.clear()` 会执行 `FLUSHDB`，清空连接当前选择的整个 Redis database。**
> `keyPrefix` 不会缩小其范围；共享 database 时不要调用它。

## 异常缓存迁移

异常条目的外层仍是 `{ error }`，内容改为带 kind/version 的 JSON envelope。新版本会旁路所有旧版未版本化异常条目；当前装饰器未启用 `errorCache` 时也会旁路新版异常条目。旁路不会自动删除 key，后续业务成功可用正常 `{ value }` 覆盖，或由调用方使用现有精确淘汰能力清理。

共享 Redis cache key 的系统必须采用两阶段升级：

1. 先把所有读取方升级到包含安全旁路逻辑的新 major，并保持 `errorCache` 省略。
2. 确认所有读取方升级完成、共享 key 的 codec 配置兼容后，再启用有限 TTL 的 `errorCache`。

旧版本可以把新 envelope 解析为普通 JSON，但会按旧逻辑抛出未解码对象；因此混合版本期间不得写入新版异常条目。回滚到旧 major 前，应先停止异常 envelope 写入并精确清理受影响的异常 key，不要默认执行数据库级 `clear()`。

### 异常与支持范围

- Redis 命令拒绝会保留原始错误；不受支持的返回结构会抛出 `TypeError`。
- TTL 必须是正有限整数秒，或使用 `0`/`undefined` 表示永不过期；其他值会在发送命令前抛出 `RangeError`。
- 0.2.x 首版验证 ioredis 5 和 node-redis 5 的普通单实例连接及默认字符串/数字响应。
- Cluster 跨分片扫描、Sentinel 专项切换、自定义 RESP Buffer 映射、自动故障切换和连接管理不在首版支持范围。

### 从 0.1.3 迁移

旧构造方式：

```typescript
const provider = new RedisCacheProvider(redis);
```

新构造方式：

```typescript
const provider = new RedisCacheProvider(createIoredisCacheClient(redis));
```

升级时保留原 database 和物理前缀，并由应用直接声明客户端依赖、先连接、最后自行关闭连接。需要回退时锁定
`@jintianxiayu/cache-decorator@0.1.3` 并恢复旧构造方式；数据格式未改变，不需要清理 Redis。

## API

### @Cache(cacheName, options?)

缓存装饰器，必须用于异步方法。

- `cacheName`：缓存名称。
- `options.ttl`：过期时间，单位为秒。
- `options.providerName`：指定已注册的 `CacheProvider`。
- `options.key`：`undefined`/`null` 使用默认参数 key；字符串使用固定 key；函数根据方法参数返回 key。
- `options.errorCache`：可选异常策略；包含必填正整数秒级 `ttl`，以及可选同步 `shouldCache` 和成对 `codec`。

### @CacheEvict(cacheName, options?)

缓存清除装饰器，必须用于异步方法。

- `options.allEntries`：为 `true` 时删除该缓存名称下的匹配项，而不是执行数据库级 `clear()`。
- `options.providerName`：指定已注册的 `CacheProvider`。
- `options.key`：行为与 `@Cache` 一致；`allEntries: true` 时忽略。

### CacheProviderRegistry

全局 Provider 注册表，使用 `register(name, provider)` 注册，并通过 `setDefault(name)` 选择默认 Provider。

### MemoryCacheProvider

基于进程内 Map 的实现，适用于单进程缓存。

### RedisCacheProvider

维护字符串/JSON、miss、TTL 和扫描删除协议；必须传入 `RedisCacheClient`，可使用内置适配工厂或自定义实现。
