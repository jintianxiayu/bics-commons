import 'reflect-metadata';
import { CacheProviderRegistry } from '../core/cache-provider-registry';
import { KeyBuilder } from '../core/key-builder';
import { PendingCache } from '../core/pending-cache';

/**
 * 缓存 key 解析器类型
 * - null: 使用自动生成逻辑
 * - string: 直接作为 key 值的一部分
 * - function: 接收方法参数数组，返回自定义字符串
 */
export type CacheKeyResolver = null | string | ((...args: unknown[]) => string);

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

    /**
     * 自定义缓存 key 生成逻辑
     * - undefined/null: 使用默认逻辑 KeyBuilder.build(cacheName, args)
     * - string: 使用 KeyBuilder.build(cacheName, [key])
     * - function: 调用函数后使用 KeyBuilder.build(cacheName, [result])
     */
    key?: CacheKeyResolver;
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
 * 解析缓存 key
 * @param cacheName 缓存名称
 * @param keyResolver key 解析器
 * @param args 方法参数数组
 * @returns 解析后的缓存 key
 */
function resolveCacheKey(cacheName: string, keyResolver: CacheKeyResolver | undefined, args: unknown[]): string {
    if (keyResolver === undefined || keyResolver === null) {
        return KeyBuilder.build(cacheName, args);
    }
    if (typeof keyResolver === 'string') {
        return KeyBuilder.build(cacheName, [keyResolver]);
    }
    try {
        return KeyBuilder.build(cacheName, [keyResolver(...args)]);
    } catch {
        return KeyBuilder.build(cacheName, args);
    }
}

/**
 * 缓存装饰器
 * 为方法添加声明式缓存功能，支持 TTL 过期和请求合并
 * @param cacheName 缓存名称
 * @param options 配置项
 */
export function Cache(
    cacheName: string,
    options?: CacheOptions
): (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => void {
    return function <T>(_target: object, _propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;

        descriptor.value = function (...args: unknown[]): Promise<T> {
            const cacheKey = resolveCacheKey(cacheName, options?.key, args);

            const pending = pendingCache.get<T>(cacheKey);
            if (pending) {
                return pending;
            }

            const promise = (async () => {
                const provider = CacheProviderRegistry.get(options?.providerName);
                const cached = await provider.get(cacheKey);
                if (cached !== undefined) {
                    const entry = cached as CacheEntry<T>;
                    if ('error' in entry) {
                        throw entry.error;
                    }
                    return entry.value;
                }

                try {
                    const result = (await originalMethod.apply(this, args)) as T;
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
