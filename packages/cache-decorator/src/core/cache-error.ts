/** 异常缓存使用的固定 envelope 类型标识。 */
const CACHE_ERROR_KIND = '@jintianxiayu/cache-decorator/error';

/** 当前异常缓存 envelope 版本。 */
const CACHE_ERROR_VERSION = 1;

/**
 * 异常缓存编解码器，将业务异常转换为可持久化 payload，并在命中时恢复异常语义。
 */
export interface CacheErrorCodec {
    /**
     * 编码本次业务异常。
     * @param error 被装饰业务方法抛出或拒绝的值。
     * @returns 可 JSON 往返的 payload。
     */
    encode(error: unknown): unknown;

    /**
     * 解码缓存中的 payload。
     * @param payload 当前版本 envelope 中的 JSON payload。
     * @returns 命中时应向调用方抛出的值。
     */
    decode(payload: unknown): unknown;
}

/**
 * 业务异常持久化策略；提供该对象即显式启用异常缓存。
 */
export interface CacheErrorPolicy {
    /** 独立于正常结果 TTL 的正整数秒级异常 TTL。 */
    ttl: number;

    /** 返回 true 时允许缓存本次业务异常；省略时接受全部业务异常。 */
    shouldCache?: (error: unknown) => boolean;

    /** 成对提供的异常编解码器；省略时使用标准 Error/JSON 值 codec。 */
    codec?: CacheErrorCodec;
}

/** 装饰器求值时完成校验并绑定默认 codec 的内部策略。 */
export interface NormalizedCacheErrorPolicy {
    readonly ttl: number;
    readonly shouldCache: ((error: unknown) => boolean) | undefined;
    readonly codec: CacheErrorCodec;
}

/** Provider 中异常条目的版本化内容。 */
export interface VersionedCacheErrorPayload {
    readonly kind: typeof CACHE_ERROR_KIND;
    readonly version: typeof CACHE_ERROR_VERSION;
    readonly payload: unknown;
}

interface DefaultErrorPayload {
    readonly type: 'error';
    readonly name: string;
    readonly message: string;
}

interface DefaultValuePayload {
    readonly type: 'value';
    readonly value: unknown;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
    return typeof value === 'object' && value !== null;
}

function isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
}

/**
 * 递归校验值是否可以无损表示为 JSON，拒绝 JSON.stringify 会静默丢弃或改写的结构。
 * @param value 待校验的 payload 或 envelope 节点。
 * @param ancestors 当前递归路径上的对象，用于识别循环引用而不拒绝普通重复引用。
 * @returns 无返回值。
 * @throws 值包含非 JSON 类型、非有限数、稀疏数组、symbol key、特殊对象或循环引用时抛出 TypeError。
 */
function validateJsonValue(value: unknown, ancestors: Set<object>): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Cache error payload numbers must be finite');
        }
        return;
    }
    if (!isRecord(value)) {
        throw new TypeError('Cache error payload must contain only JSON-compatible values');
    }
    if ((!Array.isArray(value) && !isPlainObject(value)) || Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError('Cache error payload must use JSON objects and arrays');
    }
    if (ancestors.has(value)) {
        throw new TypeError('Cache error payload must not contain circular references');
    }

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) {
                if (!Object.prototype.hasOwnProperty.call(value, index)) {
                    throw new TypeError('Cache error payload arrays must not be sparse');
                }
                validateJsonValue(value[index], ancestors);
            }
            return;
        }
        for (const child of Object.values(value)) {
            validateJsonValue(child, ancestors);
        }
    } finally {
        ancestors.delete(value);
    }
}

/**
 * 校验并执行一次 JSON stringify/parse，以统一 Memory、Redis 与自定义 Provider 得到的表示。
 * @param value codec 产生的完整版本化 envelope。
 * @returns JSON 往返后的独立规范化值。
 * @throws 无法安全 JSON 往返时抛出 TypeError 或底层序列化错误。
 */
function normalizeJsonValue(value: unknown): unknown {
    validateJsonValue(value, new Set<object>());
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') {
        throw new TypeError('Cache error payload must serialize to JSON');
    }
    return JSON.parse(serialized) as unknown;
}

const defaultCacheErrorCodec: CacheErrorCodec = Object.freeze({
    encode(error: unknown): DefaultErrorPayload | DefaultValuePayload {
        if (error instanceof Error) {
            return { type: 'error', name: error.name, message: error.message };
        }
        return { type: 'value', value: error };
    },
    decode(payload: unknown): unknown {
        if (!isRecord(payload)) {
            throw new TypeError('Default cache error payload must be an object');
        }
        if (payload.type === 'error' && typeof payload.name === 'string' && typeof payload.message === 'string') {
            const error = new Error(payload.message);
            error.name = payload.name;
            return error;
        }
        if (payload.type === 'value' && Object.prototype.hasOwnProperty.call(payload, 'value')) {
            return payload.value;
        }
        throw new TypeError('Default cache error payload has an unsupported shape');
    },
});

/**
 * 在 legacy decorator 求值阶段校验外部异常策略并绑定默认 codec。
 * @param policy 调用方传入的可选异常策略。
 * @returns 禁用状态返回 undefined；启用状态返回不可变的内部策略快照。
 * @throws TTL 非正有限整数时抛 RangeError；筛选器或 codec 结构非法时抛 TypeError。
 */
export function normalizeCacheErrorPolicy(
    policy: CacheErrorPolicy | undefined
): NormalizedCacheErrorPolicy | undefined {
    if (policy === undefined) {
        return undefined;
    }
    if (!isRecord(policy)) {
        throw new TypeError('Cache error policy must be an object');
    }
    const ttl = policy.ttl;
    const shouldCache = policy.shouldCache;
    const configuredCodec = policy.codec;
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || !Number.isInteger(ttl) || ttl < 1) {
        throw new RangeError('Cache error TTL must be a positive finite integer');
    }
    if (shouldCache !== undefined && typeof shouldCache !== 'function') {
        throw new TypeError('Cache error shouldCache must be a function');
    }
    const codec = configuredCodec === undefined ? defaultCacheErrorCodec : configuredCodec;
    if (!isRecord(codec) || typeof codec.encode !== 'function' || typeof codec.decode !== 'function') {
        throw new TypeError('Cache error codec must provide encode and decode functions');
    }
    return Object.freeze({ ttl, shouldCache, codec });
}

/**
 * 将业务异常编码为当前版本且已经 JSON 规范化的 envelope。
 * @param error 本次业务方法产生的原始异常。
 * @param policy 已在 decorator 求值阶段归一化的策略。
 * @returns 可直接交给任意 CacheProvider 的版本化异常内容。
 * @throws codec 或 JSON 往返失败时传播错误。
 */
export function encodeCacheError(error: unknown, policy: NormalizedCacheErrorPolicy): VersionedCacheErrorPayload {
    const envelope = {
        kind: CACHE_ERROR_KIND,
        version: CACHE_ERROR_VERSION,
        payload: policy.codec.encode(error),
    };
    return normalizeJsonValue(envelope) as VersionedCacheErrorPayload;
}

/**
 * 判断 Provider 返回的 error 字段是否为当前版本 envelope。
 * @param value Provider 返回的 error 字段。
 * @returns kind、version 与 payload 完整匹配当前协议时返回 true。
 */
export function isCurrentCacheErrorPayload(value: unknown): value is VersionedCacheErrorPayload {
    return (
        isRecord(value) &&
        value.kind === CACHE_ERROR_KIND &&
        value.version === CACHE_ERROR_VERSION &&
        Object.prototype.hasOwnProperty.call(value, 'payload')
    );
}

/**
 * 使用当前策略解码异常，并拒绝异步或不能安全表示的非 Error 结果。
 * @param envelope 已识别为当前版本的异常内容。
 * @param policy 当前装饰器启用的异常策略。
 * @returns codec 产生的同一个异常结果。
 * @throws codec 抛错或返回不受支持的结果时抛出。
 */
export function decodeCacheError(envelope: VersionedCacheErrorPayload, policy: NormalizedCacheErrorPolicy): unknown {
    const decoded = policy.codec.decode(envelope.payload);
    if (decoded instanceof Error) {
        return decoded;
    }
    validateJsonValue(decoded, new Set<object>());
    return decoded;
}
