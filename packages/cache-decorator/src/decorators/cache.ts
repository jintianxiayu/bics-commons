import 'reflect-metadata';
import {
    decodeCacheError,
    encodeCacheError,
    isCurrentCacheErrorPayload,
    normalizeCacheErrorPolicy,
    type CacheErrorCodec,
    type CacheErrorPolicy,
    type NormalizedCacheErrorPolicy,
} from '../core/cache-error';
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

export type { CacheErrorCodec, CacheErrorPolicy };

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

    /**
     * 业务异常缓存策略；省略时不向 Provider 持久化业务异常。
     */
    errorCache?: CacheErrorPolicy;
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

type CacheReadResult<T> =
    | { readonly type: 'value'; readonly value: T }
    | { readonly type: 'error'; readonly error: unknown }
    | { readonly type: 'miss' };

interface BusinessErrorRequest {
    readonly error: unknown;
    readonly errorPolicy: NormalizedCacheErrorPolicy | undefined;
    readonly provider: CacheProvider;
    readonly cacheKey: string;
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
 * 提交异常条目写入；同步 Provider 失败只记录基础设施错误，不遮蔽已经发生的业务异常。
 * @param request 异常写入所需 Provider、entry、TTL 和稳定日志上下文。
 * @returns 无返回值；异步写入 Promise 保持既有 fire-and-forget 边界。
 */
function dispatchCacheErrorWrite(request: CacheWriteRequest<never>): void {
    try {
        request.provider.set(request.cacheKey, request.entry, request.ttl);
    } catch (error) {
        logCacheEvent('cache.operation_failed', { ...request.logContext, operation: 'write', error });
        return;
    }
    logCacheEvent('cache.write_dispatched', { ...request.logContext, entryType: 'error' });
}

function isErrorCacheEntry<T>(entry: CacheEntry<T>): entry is ErrorCacheEntry {
    return typeof entry === 'object' && entry !== null && 'error' in entry;
}

/**
 * 按当前异常策略分类 Provider 条目，并只把可成功解码的当前版本异常视为命中。
 * @param entry Provider 返回的缓存联合条目。
 * @param errorPolicy 当前装饰器归一化后的异常策略。
 * @param logContext 当前方法的稳定日志上下文。
 * @returns value/error 命中结果，或需要继续业务流程的 miss。
 */
function resolveCachedEntry<T>(
    entry: CacheEntry<T>,
    errorPolicy: NormalizedCacheErrorPolicy | undefined,
    logContext: CacheLogContext
): CacheReadResult<T> {
    if (!isErrorCacheEntry(entry)) {
        logCacheEvent('cache.hit', { ...logContext, entryType: 'value' });
        return { type: 'value', value: entry.value };
    }
    if (!isCurrentCacheErrorPayload(entry.error)) {
        logCacheEvent('cache.error_cache_skipped', { ...logContext, reason: 'legacy_entry' });
        return { type: 'miss' };
    }
    if (errorPolicy === undefined) {
        logCacheEvent('cache.error_cache_skipped', { ...logContext, reason: 'disabled_entry' });
        return { type: 'miss' };
    }
    try {
        const error = decodeCacheError(entry.error, errorPolicy);
        logCacheEvent('cache.hit', { ...logContext, entryType: 'error' });
        return { type: 'error', error };
    } catch (_error) {
        logCacheEvent('cache.error_cache_failed', { ...logContext, phase: 'decode' });
        return { type: 'miss' };
    }
}

/**
 * 按固定顺序评估筛选器、编码异常并发起独立 TTL 写入，任何策略失败都保留原业务异常。
 * @param request 本次业务异常、当前策略、Provider、完整 key 与稳定日志上下文。
 * @returns 无返回值。
 */
function handleBusinessError(request: BusinessErrorRequest): void {
    const { error, errorPolicy, provider, cacheKey, logContext } = request;
    if (errorPolicy === undefined) {
        logCacheEvent('cache.error_cache_skipped', { ...logContext, reason: 'disabled' });
        return;
    }
    if (errorPolicy.shouldCache !== undefined) {
        let accepted: boolean;
        try {
            accepted = errorPolicy.shouldCache(error);
            if (typeof accepted !== 'boolean') {
                throw new TypeError('Cache error shouldCache must return a boolean');
            }
        } catch (_error) {
            logCacheEvent('cache.error_cache_failed', { ...logContext, phase: 'predicate' });
            return;
        }
        if (!accepted) {
            logCacheEvent('cache.error_cache_skipped', { ...logContext, reason: 'predicate_rejected' });
            return;
        }
    }

    let entry: ErrorCacheEntry;
    try {
        entry = { error: encodeCacheError(error, errorPolicy) };
    } catch (_error) {
        logCacheEvent('cache.error_cache_failed', { ...logContext, phase: 'encode' });
        return;
    }
    dispatchCacheErrorWrite({ provider, cacheKey, entry, entryType: 'error', ttl: errorPolicy.ttl, logContext });
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
    const errorPolicy = normalizeCacheErrorPolicy(options?.errorCache);
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
                    const cachedResult = resolveCachedEntry(cached, errorPolicy, logContext);
                    if (cachedResult.type === 'value') {
                        return cachedResult.value;
                    }
                    if (cachedResult.type === 'error') {
                        throw cachedResult.error;
                    }
                }
                logCacheEvent('cache.miss', logContext);

                let result: T;
                try {
                    result = (await originalMethod.apply(this, args)) as T;
                } catch (error) {
                    handleBusinessError({ error, errorPolicy, provider, cacheKey, logContext });
                    throw error;
                }
                dispatchCacheWrite({
                    provider,
                    cacheKey,
                    entry: { value: result },
                    entryType: 'value',
                    ttl: options?.ttl,
                    logContext,
                });
                return result;
            })();

            pendingCache.set(cacheKey, promise);
            return promise;
        };
    };
}

export { CacheProviderRegistry } from '../core/cache-provider-registry';
