# @jintianxiayu/cache-decorator

为 TypeScript 异步方法提供声明式缓存、缓存清除、请求合并，以及 Memory、Redis 和自定义缓存后端。

## 安装

基础包不绑定任何 Redis SDK：

```bash
pnpm add @jintianxiayu/cache-decorator reflect-metadata
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
