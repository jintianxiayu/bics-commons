# @jintianxiayu/cache-decorator

方法缓存装饰器，为 TypeScript 方法提供声明式缓存功能。

## 安装

```bash
npm install @jintianxiayu/cache-decorator reflect-metadata
```

## 特性

- `@Cache` 装饰器：方法缓存，支持 TTL 过期
- `@CacheEvict` 装饰器：缓存清除
- 可插拔的缓存后端（Memory / Redis / 自定义）
- 请求合并：并发场景下返回同一个 Promise
- 错误结果缓存：防止缓存穿透

## 重要提示

> ⚠️ **@Cache 和 @CacheEvict 装饰器仅适用于返回 Promise 的方法**
>
> 这两个装饰器都会将被装饰的方法替换为异步函数。如果装饰返回非 Promise 的同步方法，调用方会收到 Promise 对象而非期望的返回值，导致难以排查的 bug。
>
> ```typescript
> // ✅ 正确：async 方法或返回 Promise 的方法
> @Cache('data')
> async getData() { ... }
>
> @CacheEvict('data')
> async clearData() { ... }
>
> // ❌ 错误：返回非 Promise 的同步方法不要使用这些装饰器
> @Cache('data')
> getData() { return 'result'; }  // 调用方得到 Promise，不是 'result'
> ```

## 使用示例

```typescript
import 'reflect-metadata';
import { Cache, CacheEvict, CacheProviderRegistry, MemoryCacheProvider } from '@jintianxiayu/cache-decorator';

// 注册默认 Provider
CacheProviderRegistry.register('memory', new MemoryCacheProvider());
CacheProviderRegistry.setDefault('memory');

class UserService {
  @Cache('user-cache', { ttl: 60000 })
  async getUser(id: number) {
    return { id, name: 'test' };
  }

  @CacheEvict('user-cache')
  async updateUser(id: number) {
    return { id, updated: true };
  }
}
```

### 自定义缓存 Key

通过 `key` 选项自定义缓存 key 生成逻辑：

```typescript
class UserService {
  // 使用字符串作为 key，所有调用共享同一缓存
  @Cache('config', { key: 'global-config' })
  async getConfig() {
    return { ... };
  }

  // 使用函数基于参数生成 key
  @Cache('user', { key: (...args) => String(args[0]) })
  async getUser(id: number) {
    return { id };
  }

  // 清除时使用相同的 key 函数
  @CacheEvict('user', { key: (...args) => String(args[0]) })
  async deleteUser(id: number) {
    return { id, deleted: true };
  }
}
```



## API

### @Cache(cacheName, options?)

缓存装饰器。**必须用于 async 方法**。

- `cacheName`: 缓存名称
- `options.ttl`: 过期时间（秒）
- `options.providerName`: 指定 CacheProvider
- `options.key`: 自定义缓存 key，支持以下形式：
  - `undefined/null`: 使用默认逻辑，基于方法参数生成 key
  - `string`: 直接作为 key 值，格式为 `cacheName:keyValue`
  - `function`: 接收方法参数数组，返回自定义字符串

### @CacheEvict(cacheName, options?)

缓存清除装饰器。**必须用于返回 Promise 的方法**。

- `cacheName`: 缓存名称
- `options.allEntries`: 清除该缓存名称下的所有条目（而非所有缓存），默认 false
- `options.providerName`: 指定 CacheProvider
- `options.key`: 自定义缓存 key，与 `@Cache` 行为一致。当 `allEntries: true` 时忽略

### CacheProviderRegistry

全局缓存提供者注册表。

```typescript
CacheProviderRegistry.register('memory', new MemoryCacheProvider());
CacheProviderRegistry.setDefault('memory');
CacheProviderRegistry.get('memory');
```

### MemoryCacheProvider

内存 Map 实现，适用于单机应用。

### RedisCacheProvider

Redis 实现，适用于分布式场景。

```typescript
import Redis from 'ioredis';
const redisProvider = new RedisCacheProvider(new Redis());
```