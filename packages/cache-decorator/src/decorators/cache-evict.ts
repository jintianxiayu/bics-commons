import { cacheProviderLabel, logCacheEvent, type CacheLogContext } from '../core/cache-logger';
import type { CacheProvider } from '../core/cache-provider';
import { CacheProviderRegistry } from '../core/cache-provider-registry';
import { KeyBuilder } from '../core/key-builder';
import type { CacheKeyResolver, CacheOptions } from './cache';

/**
 * @CacheEvict 装饰器配置项
 */
export interface CacheEvictOptions extends Pick<CacheOptions, 'key'> {
    /**
     * 是否清除所有条目，默认为 false
     */
    allEntries?: boolean;

    /**
     * 指定 CacheProvider 名称
     */
    providerName?: string;
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
 * 获取淘汰操作使用的 Provider，并在解析失败时记录原始注册表错误。
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
 * 保持 fire-and-forget 语义发起单 key 删除，只处理调用当下可观察的同步失败。
 * @param provider 当前淘汰使用的 Provider。
 * @param cacheKey 待删除的完整 key；不会进入日志元数据。
 * @param logContext 当前方法的稳定日志上下文。
 * @returns 无返回值；异步删除 Promise 不会被等待或消费。
 * @throws Provider delete 同步抛出的原始错误。
 */
function dispatchCacheDelete(provider: CacheProvider, cacheKey: string, logContext: CacheLogContext): void {
    try {
        provider.delete(cacheKey);
    } catch (error) {
        logCacheEvent('cache.operation_failed', { ...logContext, operation: 'evict', error });
        throw error;
    }
    logCacheEvent('cache.evict_dispatched', { ...logContext, scope: 'key' });
}

/**
 * 缓存清除装饰器
 * 在方法执行后清除对应的缓存条目
 * @param cacheName 缓存名称
 * @param options 配置项
 */
export function CacheEvict(
    cacheName: string,
    options?: CacheEvictOptions
): (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => void {
    return function (_target: object, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        const logContext: CacheLogContext = {
            cacheName,
            methodName: propertyKey,
            providerName: cacheProviderLabel(options?.providerName),
        };

        descriptor.value = async function (...args: unknown[]) {
            let result: unknown;
            try {
                result = await originalMethod.apply(this, args);
            } catch (error) {
                logCacheEvent('cache.evict_skipped', { ...logContext, reason: 'business_error' });
                throw error;
            }

            const provider = resolveCacheProvider(options?.providerName, logContext);

            if (options?.allEntries) {
                try {
                    await provider.deleteByPattern(cacheName + '*');
                } catch (error) {
                    logCacheEvent('cache.operation_failed', { ...logContext, operation: 'evict', error });
                    throw error;
                }
                logCacheEvent('cache.evict_completed', { ...logContext, scope: 'allEntries' });
            } else {
                const cacheKey = resolveCacheKey(options?.key, args, logContext);
                dispatchCacheDelete(provider, cacheKey, logContext);
            }

            return result;
        };
    };
}

export { CacheProviderRegistry } from '../core/cache-provider-registry';
