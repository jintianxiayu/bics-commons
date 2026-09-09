import {
    Cache,
    CacheEvict,
    type CacheErrorCodec,
    type CacheErrorPolicy,
    type CacheEvictOptions,
    type CacheKeyResolver,
    type CacheOptions,
    type CacheProvider,
} from '@jintianxiayu/cache-decorator';

type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Assert<Condition extends true> = Condition;
type LegacyMethodDecorator = (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => void;

export type CacheOptionKeysMatch = Assert<Equal<keyof CacheOptions, 'ttl' | 'providerName' | 'key' | 'errorCache'>>;
export type CacheErrorPolicyKeysMatch = Assert<Equal<keyof CacheErrorPolicy, 'ttl' | 'shouldCache' | 'codec'>>;
export type CacheErrorCodecKeysMatch = Assert<Equal<keyof CacheErrorCodec, 'encode' | 'decode'>>;
export type CacheEvictOptionKeysMatch = Assert<Equal<keyof CacheEvictOptions, 'key' | 'allEntries' | 'providerName'>>;
export type CacheKeyResolverMatch = Assert<Equal<CacheKeyResolver, null | string | ((...args: unknown[]) => string)>>;

const provider: CacheProvider = {
    get: <Value>(_key: string): Value | undefined => undefined,
    set: <Value>(_key: string, _value: Value, _ttl?: number): void => {
        return;
    },
    delete: (_key: string): void => {
        return;
    },
    clear: (): void => {
        return;
    },
    deleteByPattern: (_pattern: string): void => {
        return;
    },
};

const cacheDecorator: LegacyMethodDecorator = Cache('contract-cache', {
    ttl: 60,
    providerName: 'memory',
    key: (...args: unknown[]) => String(args[0]),
});
const cacheWithoutErrorPolicy: LegacyMethodDecorator = Cache('contract-cache');
const cacheWithErrorTtl: LegacyMethodDecorator = Cache('contract-cache', { errorCache: { ttl: 10 } });
const codec: CacheErrorCodec = {
    encode: (error: unknown): unknown => ({ message: error instanceof Error ? error.message : String(error) }),
    decode: (payload: unknown): unknown => payload,
};
const cacheWithCompleteErrorPolicy: LegacyMethodDecorator = Cache('contract-cache', {
    errorCache: {
        ttl: 5,
        shouldCache: (error: unknown): boolean => error instanceof Error,
        codec,
    },
});
const evictDecorator: LegacyMethodDecorator = CacheEvict('contract-cache', {
    providerName: 'memory',
    key: null,
    allEntries: false,
});

const invalidLoggingOption: CacheOptions = {
    // @ts-expect-error CacheOptions 不提供第二套日志开关。
    logging: true,
};
const invalidDebugOption: CacheOptions = {
    // @ts-expect-error CacheOptions 不提供 debug 开关。
    debug: true,
};
const invalidLoggerOption: CacheEvictOptions = {
    // @ts-expect-error CacheEvictOptions 不接受 Logger 实例或回调。
    logger: undefined,
};
const invalidMissingErrorTtl: CacheOptions = {
    // @ts-expect-error 启用异常缓存时 ttl 必填。
    errorCache: {},
};
const invalidEncodeOnlyCodec: CacheOptions = {
    errorCache: {
        ttl: 5,
        // @ts-expect-error codec 必须同时提供 encode 和 decode。
        codec: { encode: (error: unknown): unknown => error },
    },
};
const invalidDecodeOnlyCodec: CacheOptions = {
    errorCache: {
        ttl: 5,
        // @ts-expect-error codec 必须同时提供 encode 和 decode。
        codec: { decode: (payload: unknown): unknown => payload },
    },
};
const invalidPredicateSignature: CacheOptions = {
    errorCache: {
        ttl: 5,
        // @ts-expect-error 筛选器必须接受 unknown 并同步返回 boolean。
        shouldCache: (_error: string): boolean => true,
    },
};
const invalidEvictErrorPolicy: CacheEvictOptions = {
    // @ts-expect-error CacheEvictOptions 不接受异常缓存策略。
    errorCache: { ttl: 5 },
};

void provider;
void cacheDecorator;
void cacheWithoutErrorPolicy;
void cacheWithErrorTtl;
void cacheWithCompleteErrorPolicy;
void codec;
void evictDecorator;
void invalidLoggingOption;
void invalidDebugOption;
void invalidLoggerOption;
void invalidMissingErrorTtl;
void invalidEncodeOnlyCodec;
void invalidDecodeOnlyCodec;
void invalidPredicateSignature;
void invalidEvictErrorPolicy;
