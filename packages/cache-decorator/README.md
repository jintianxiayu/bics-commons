# @bics/cache-decorator

方法缓存装饰器，为 TypeScript 方法提供声明式缓存功能。

## 安装

```bash
npm install @bics/cache-decorator reflect-metadata
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
import { Cache, CacheEvict, CacheProviderRegistry, MemoryCacheProvider } from '@bics/cache-decorator';

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



## API

### @Cache(cacheName, options?)

缓存装饰器。**必须用于 async 方法**。

- `cacheName`: 缓存名称
- `options.ttl`: 过期时间（秒）
- `options.providerName`: 指定 CacheProvider

### @CacheEvict(cacheName, options?)

缓存清除装饰器。**必须用于返回 Promise 的方法**。

- `cacheName`: 缓存名称
- `options.allEntries`: 清除所有条目，默认 false
- `options.providerName`: 指定 CacheProvider

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