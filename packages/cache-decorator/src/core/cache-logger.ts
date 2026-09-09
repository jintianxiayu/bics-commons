import { LoggerFactory, type LoggerInterface } from '@jintianxiayu/logger';

const CACHE_LOGGER_NAME = '@jintianxiayu/cache-decorator';

export type CacheLogEvent =
    | 'cache.pending_hit'
    | 'cache.hit'
    | 'cache.miss'
    | 'cache.write_dispatched'
    | 'cache.error_cache_skipped'
    | 'cache.error_cache_failed'
    | 'cache.evict_dispatched'
    | 'cache.evict_completed'
    | 'cache.key_fallback'
    | 'cache.evict_skipped'
    | 'cache.operation_failed';

type CacheLogLevel = 'debug' | 'warn' | 'error';

interface CacheLogDefinition {
    readonly level: CacheLogLevel;
    readonly message: string;
}

/** 缓存日志只接受与决策相关的稳定字段，避免业务数据和 cache key 被意外带入输出。 */
export interface CacheLogContext {
    readonly cacheName: string;
    readonly methodName: string;
    readonly providerName: string;
    readonly entryType?: 'value' | 'error';
    readonly scope?: 'key' | 'allEntries';
    readonly reason?:
        | 'resolver_error'
        | 'business_error'
        | 'disabled'
        | 'predicate_rejected'
        | 'legacy_entry'
        | 'disabled_entry';
    readonly phase?: 'predicate' | 'encode' | 'decode';
    readonly operation?: 'provider_resolution' | 'read' | 'write' | 'evict';
    readonly error?: unknown;
}

/** 日志定义映射中 K 为稳定事件名，V 为固定的日志级别与无业务数据消息。 */
const CACHE_LOG_DEFINITIONS: Readonly<Record<CacheLogEvent, CacheLogDefinition>> = {
    'cache.pending_hit': { level: 'debug', message: 'Cache pending request reused' },
    'cache.hit': { level: 'debug', message: 'Cache entry hit' },
    'cache.miss': { level: 'debug', message: 'Cache entry missed' },
    'cache.write_dispatched': { level: 'debug', message: 'Cache write dispatched' },
    'cache.error_cache_skipped': { level: 'debug', message: 'Cache error entry skipped' },
    'cache.error_cache_failed': { level: 'warn', message: 'Cache error policy failed' },
    'cache.evict_dispatched': { level: 'debug', message: 'Cache eviction dispatched' },
    'cache.evict_completed': { level: 'debug', message: 'Cache eviction completed' },
    'cache.key_fallback': { level: 'warn', message: 'Cache key resolver failed; using default key' },
    'cache.evict_skipped': { level: 'warn', message: 'Cache eviction skipped after business failure' },
    'cache.operation_failed': { level: 'error', message: 'Cache operation failed' },
};

let cacheLogger: LoggerInterface | undefined;

function getCacheLogger(): LoggerInterface {
    cacheLogger ??= LoggerFactory.getLogger(CACHE_LOGGER_NAME);
    return cacheLogger;
}

/**
 * 按稳定事件定义调用对应 Logger level，不提供 info 分支以防高频缓存事件误入 info。
 * @param logger 应用共享的 cache 命名 Logger。
 * @param definition 当前事件固定的 level 与 message。
 * @param metadata 只包含缓存决策白名单字段的结构化元数据。
 * @returns 无返回值。
 * @throws Logger 同步写入失败时透传给外层安全边界处理。
 */
function writeCacheLog(
    logger: LoggerInterface,
    definition: CacheLogDefinition,
    metadata: CacheLogContext & { readonly event: CacheLogEvent }
): void {
    if (definition.level === 'debug') {
        logger.debug(definition.message, metadata);
        return;
    }
    if (definition.level === 'warn') {
        logger.warn(definition.message, metadata);
        return;
    }
    logger.error(definition.message, metadata);
}

/**
 * 提交一条不会影响缓存或业务结果的结构化日志。
 * @param event 决定固定 message 与 level 的缓存事件。
 * @param context 不包含参数、值或 key 的缓存决策上下文。
 * @returns 无返回值；Logger 获取或同步写入失败时静默结束。
 * @throws 不主动抛出异常。
 */
export function logCacheEvent(event: CacheLogEvent, context: CacheLogContext): void {
    try {
        writeCacheLog(getCacheLogger(), CACHE_LOG_DEFINITIONS[event], { event, ...context });
    } catch (_error) {
        return;
    }
}

/**
 * 将 decorator 配置中的 Provider 名称转换为稳定日志标签。
 * @param providerName 用户显式配置的 Provider 名称。
 * @returns 非空显式名称；缺省或空字符串返回 `default`。
 * @throws 不主动抛出异常。
 */
export function cacheProviderLabel(providerName: string | undefined): string {
    if (providerName === undefined || providerName.length === 0) {
        return 'default';
    }
    return providerName;
}
