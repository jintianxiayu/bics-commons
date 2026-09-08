import {
    Cache,
    CacheEvict,
    type CacheEvictOptions,
    type CacheKeyResolver,
    type CacheOptions,
    type CacheProvider,
} from '@jintianxiayu/cache-decorator';

type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Assert<Condition extends true> = Condition;
type LegacyMethodDecorator = (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => void;

export type CacheOptionKeysMatch = Assert<Equal<keyof CacheOptions, 'ttl' | 'providerName' | 'key'>>;
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

void provider;
void cacheDecorator;
void evictDecorator;
void invalidLoggingOption;
void invalidDebugOption;
void invalidLoggerOption;
