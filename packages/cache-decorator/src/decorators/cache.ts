import 'reflect-metadata';
import { cacheProviderLabel, logCacheEvent, type CacheLogContext } from '../core/cache-logger';
import type { CacheProvider } from '../core/cache-provider';
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

interface CacheWriteRequest<T> {
    readonly provider: CacheProvider;
    readonly cacheKey: string;
    readonly entry: CacheEntry<T>;
    readonly entryType: 'value' | 'error';
    readonly ttl: number | undefined;
    readonly logContext: CacheLogContext;
}

const pendingCache = new PendingCache();

/**
 * 获取配置指向的缓存 Provider，并在解析失败时记录原始错误。
 * @param providerName decorator 配置中的 Provider 名称。
 * @param logContext 当前方法的稳定日志上下文。
 * @returns 已注册的缓存 Provider。
 * @throws Provider 注册表抛出的原始错误。
 */
function resolveCacheProvider(providerName: string | undefined, logContext: CacheLogContext): CacheProvider {
    try {
        return CacheProviderRegistry.get(providerName);
    } catch (error) {
        logCacheEvent('cache.operation_failed', { ...logContext, operation: 'provider_resolution', error });
        throw error;
    }
}

/**
 * 保持 fire-and-forget 语义提交缓存写入，仅捕获调用当下可观察的同步失败。
 * @param request 写入所需 Provider、entry 和无业务数据日志上下文。
 * @returns 无返回值；异步写入 Promise 不会被等待或消费。
 * @throws Provider set 同步抛出的原始错误。
 */
function dispatchCacheWrite<T>(request: CacheWriteRequest<T>): void {
    try {
        request.provider.set(request.cacheKey, request.entry, request.ttl);
    } catch (error) {
        logCacheEvent('cache.operation_failed', { ...request.logContext, operation: 'write', error });
        throw error;
    }
    logCacheEvent('cache.write_dispatched', { ...request.logContext, entryType: request.entryType });
}

/**
 * 解析缓存 key
 * @param keyResolver key 解析器
 * @param args 方法参数数组
 * @param logContext 不包含业务参数和值的日志上下文
 * @returns 解析后的缓存 key
 */
function resolveCacheKey(
    keyResolver: CacheKeyResolver | undefined,
    args: unknown[],
    logContext: CacheLogContext
): string {
    if (keyResolver === undefined || keyResolver === null) {
        return KeyBuilder.build(logContext.cacheName, args);
    }
    if (typeof keyResolver === 'string') {
        return KeyBuilder.build(logContext.cacheName, [keyResolver]);
    }
    try {
        return KeyBuilder.build(logContext.cacheName, [keyResolver(...args)]);
    } catch (_error) {
        logCacheEvent('cache.key_fallback', { ...logContext, reason: 'resolver_error' });
        return KeyBuilder.build(logContext.cacheName, args);
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
    return function <T>(_target: object, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        const logContext: CacheLogContext = {
            cacheName,
            methodName: propertyKey,
            providerName: cacheProviderLabel(options?.providerName),
        };

        descriptor.value = function (...args: unknown[]): Promise<T> {
            const cacheKey = resolveCacheKey(options?.key, args, logContext);

            const pending = pendingCache.get<T>(cacheKey);
            if (pending) {
                logCacheEvent('cache.pending_hit', logContext);
                return pending;
            }

            const promise = (async () => {
                const provider = resolveCacheProvider(options?.providerName, logContext);
                let cached: CacheEntry<T> | undefined;
                try {
                    cached = await provider.get<CacheEntry<T>>(cacheKey);
                } catch (error) {
                    logCacheEvent('cache.operation_failed', { ...logContext, operation: 'read', error });
                    throw error;
                }
                if (cached !== undefined) {
                    if ('error' in cached) {
                        logCacheEvent('cache.hit', { ...logContext, entryType: 'error' });
                        throw cached.error;
                    }
                    logCacheEvent('cache.hit', { ...logContext, entryType: 'value' });
                    return cached.value;
                }
                logCacheEvent('cache.miss', logContext);

                try {
                    const result = (await originalMethod.apply(this, args)) as T;
                    dispatchCacheWrite({
                        provider,
                        cacheKey,
                        entry: { value: result },
                        entryType: 'value',
                        ttl: options?.ttl,
                        logContext,
                    });
                    return result;
                } catch (error) {
                    dispatchCacheWrite({
                        provider,
                        cacheKey,
                        entry: { error },
                        entryType: 'error',
                        ttl: options?.ttl,
                        logContext,
                    });
                    throw error;
                }
            })();

            pendingCache.set(cacheKey, promise);
            return promise;
        };
    };
}

export { CacheProviderRegistry } from '../core/cache-provider-registry';
