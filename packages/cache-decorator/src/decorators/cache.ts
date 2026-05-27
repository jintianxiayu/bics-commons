import 'reflect-metadata';
import { CacheProviderRegistry } from '../core/cache-provider-registry';
import { KeyBuilder } from '../core/key-builder';
import { PendingCache } from '../core/pending-cache';

/**
 * @Cache 装饰器配置项
 */
export interface CacheOptions {
  /**
   * 过期时间（秒）
   */
  ttl?: number;

  /**
   * 指定 CacheProvider 名称
   */
  providerName?: string;
}

/**
 * 成功缓存条目
 */
interface SuccessCacheEntry<T> {
  value: T;
}

/**
 * 错误缓存条目
 */
interface ErrorCacheEntry {
  error: unknown;
}

/**
 * 缓存条目联合类型
 */
type CacheEntry<T> = SuccessCacheEntry<T> | ErrorCacheEntry;

const pendingCache = new PendingCache();

/**
 * 缓存装饰器
 * 为方法添加声明式缓存功能，支持 TTL 过期和请求合并
 * @param cacheName 缓存名称
 * @param options 配置项
 */
export function Cache(cacheName: string, options?: CacheOptions) {
  return function <T>(
    _target: object,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const cacheKey = KeyBuilder.build(cacheName, args);
      const providerName = options?.providerName;
      const provider = CacheProviderRegistry.get(providerName);

      const cached = await provider.get(cacheKey);
      if (cached !== undefined) {
        const entry = cached as CacheEntry<T>;
        if ('error' in entry) {
          throw entry.error;
        }
        return entry.value;
      }

      const pending = pendingCache.get<T>(cacheKey);
      if (pending) {
        return pending;
      }

      const promise = (async () => {
        try {
          const result = await originalMethod.apply(this, args);
          provider.set(cacheKey, { value: result } as CacheEntry<T>, options?.ttl);
          return result;
        } catch (error) {
          provider.set(cacheKey, { error } as CacheEntry<T>, options?.ttl);
          throw error;
        }
      })();

      pendingCache.set(cacheKey, promise);
      return promise;
    };
  };
}

export { CacheProviderRegistry } from '../core/cache-provider-registry';