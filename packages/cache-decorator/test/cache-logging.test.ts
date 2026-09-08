jest.mock('@jintianxiayu/logger', () => ({
    LoggerFactory: {
        getLogger: jest.fn(),
    },
}));

import { LoggerFactory, type LoggerInterface } from '@jintianxiayu/logger';
import { Cache } from '../src/decorators/cache';
import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { KeyBuilder } from '../src/core/key-builder';
import type { CacheProvider } from '../src/core/cache-provider';

interface ProviderHarness {
    readonly provider: CacheProvider;
    readonly get: jest.Mock<unknown, [string]>;
    readonly set: jest.Mock<unknown, [string, unknown, number?]>;
}

interface CacheLogMetadata {
    readonly event: string;
    readonly cacheName: string;
    readonly methodName: string;
    readonly providerName: string;
    readonly entryType?: string;
    readonly reason?: string;
    readonly operation?: string;
    readonly error?: unknown;
}

interface Deferred<Value> {
    readonly promise: Promise<Value>;
    readonly resolve: (value: Value) => void;
}

const mockLogger: jest.Mocked<LoggerInterface> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
const mockGetLogger = jest.mocked(LoggerFactory.getLogger);

/** 为并发请求测试创建由用例显式完成的 Promise。 */
function createDeferred<Value>(): Deferred<Value> {
    let resolvePromise: ((value: Value) => void) | undefined;
    const promise = new Promise<Value>((resolve) => {
        resolvePromise = resolve;
    });
    if (!resolvePromise) {
        throw new Error('Deferred resolver was not initialized');
    }
    return { promise, resolve: resolvePromise };
}

/** 创建仅记录 decorator 实际调用次数和参数的可插拔 Provider。 */
function createProvider(getResult: unknown): ProviderHarness {
    const get = jest.fn<unknown, [string]>(() => getResult);
    const set = jest.fn<unknown, [string, unknown, number?]>();
    const provider: CacheProvider = {
        get: <Value>(key: string): Value | undefined | Promise<Value | undefined> =>
            get(key) as Value | undefined | Promise<Value | undefined>,
        set: <Value>(key: string, value: Value, ttl?: number): void | Promise<void> =>
            set(key, value, ttl) as void | Promise<void>,
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
    return { provider, get, set };
}

function loggedMetadata(method: jest.Mock): CacheLogMetadata[] {
    return method.mock.calls.map((call) => call[1] as CacheLogMetadata);
}

function events(method: jest.Mock): string[] {
    return loggedMetadata(method).map(({ event }) => event);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogger.mockReturnValue(mockLogger);
    CacheProviderRegistry.clear();
});

afterEach(() => {
    jest.restoreAllMocks();
    CacheProviderRegistry.clear();
});

it('cache-operation-logging/C01 cache-operation-logging/A02 并发调用复用同一 pending Promise', async () => {
    const provider = createProvider(undefined);
    CacheProviderRegistry.register('pending-provider', provider.provider);
    CacheProviderRegistry.setDefault('pending-provider');
    const result = createDeferred<number>();
    const businessMethod = jest.fn(() => result.promise);

    class UserService {
        @Cache('pending-users')
        getUser(id: number): Promise<number> {
            return businessMethod(id);
        }
    }

    const service = new UserService();
    const first = service.getUser(7);
    const second = service.getUser(7);

    expect(second).toBe(first);
    expect(provider.get).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(businessMethod).toHaveBeenCalledTimes(1);
    result.resolve(42);
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);
    expect(events(mockLogger.debug).filter((event) => event === 'cache.pending_hit')).toHaveLength(1);
    expect(events(mockLogger.debug).filter((event) => event === 'cache.miss')).toHaveLength(1);
    expect(events(mockLogger.debug)).not.toContain('cache.hit');
});

it('cache-operation-logging/C02 命中 value entry 时记录 hit 并跳过业务方法', async () => {
    const cachedValue = { id: 7, source: 'cache' };
    const provider = createProvider({ value: cachedValue });
    CacheProviderRegistry.register('value-provider', provider.provider);
    const businessMethod = jest.fn();

    class UserService {
        @Cache('value-users', { providerName: 'value-provider' })
        getUser(): unknown {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).resolves.toBe(cachedValue);
    expect(businessMethod).not.toHaveBeenCalled();
    expect(loggedMetadata(mockLogger.debug)).toContainEqual({
        event: 'cache.hit',
        cacheName: 'value-users',
        methodName: 'getUser',
        providerName: 'value-provider',
        entryType: 'value',
    });
});

it('cache-operation-logging/C03 命中 error entry 时记录 hit 并抛出同一异常', async () => {
    const cachedError = new Error('cached business failure');
    const provider = createProvider({ error: cachedError });
    CacheProviderRegistry.register('error-entry-provider', provider.provider);
    const businessMethod = jest.fn();

    class UserService {
        @Cache('error-users', { providerName: 'error-entry-provider' })
        getUser(): unknown {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).rejects.toBe(cachedError);
    expect(businessMethod).not.toHaveBeenCalled();
    expect(loggedMetadata(mockLogger.debug)).toContainEqual({
        event: 'cache.hit',
        cacheName: 'error-users',
        methodName: 'getUser',
        providerName: 'error-entry-provider',
        entryType: 'error',
    });
    expect(mockLogger.error).not.toHaveBeenCalled();
});

it('cache-operation-logging/K01 resolver 失败时记录无敏感数据的 fallback 并使用默认 key', async () => {
    const secretArgument = { phone: '13800138000', token: 'credential' };
    const provider = createProvider({ value: 'cached' });
    CacheProviderRegistry.register('fallback-provider', provider.provider);
    const resolver = jest.fn(() => {
        throw new Error('resolver leaked secret');
    });

    class UserService {
        @Cache('fallback-users', { providerName: 'fallback-provider', key: resolver })
        getUser(_input: unknown): string {
            return 'business';
        }
    }

    await expect(new UserService().getUser(secretArgument)).resolves.toBe('cached');
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(provider.get).toHaveBeenCalledWith(KeyBuilder.build('fallback-users', [secretArgument]));
    const fallback = loggedMetadata(mockLogger.warn).find(({ event }) => event === 'cache.key_fallback');
    expect(fallback).toEqual({
        event: 'cache.key_fallback',
        cacheName: 'fallback-users',
        methodName: 'getUser',
        providerName: 'fallback-provider',
        reason: 'resolver_error',
    });
    expect(JSON.stringify(fallback)).not.toContain('13800138000');
    expect(JSON.stringify(fallback)).not.toContain('credential');
    expect(JSON.stringify(fallback)).not.toContain('resolver leaked secret');
});

it('cache-operation-logging/C04 miss 后回填 value entry 并记录 dispatched', async () => {
    const provider = createProvider(undefined);
    CacheProviderRegistry.register('write-value-provider', provider.provider);
    const businessResult = { id: 8 };
    const businessMethod = jest.fn(() => businessResult);

    class UserService {
        @Cache('write-value-users', { providerName: 'write-value-provider', ttl: 30 })
        getUser(): { id: number } {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).resolves.toBe(businessResult);
    expect(provider.get).toHaveBeenCalledTimes(1);
    expect(businessMethod).toHaveBeenCalledTimes(1);
    expect(provider.set).toHaveBeenCalledWith(expect.any(String), { value: businessResult }, 30);
    expect(events(mockLogger.debug)).toEqual(['cache.miss', 'cache.write_dispatched']);
    expect(loggedMetadata(mockLogger.debug)[1]).toEqual({
        event: 'cache.write_dispatched',
        cacheName: 'write-value-users',
        methodName: 'getUser',
        providerName: 'write-value-provider',
        entryType: 'value',
    });
});

it('cache-operation-logging/C05 业务异常回填 error entry 后抛出同一异常', async () => {
    const provider = createProvider(undefined);
    CacheProviderRegistry.register('write-error-provider', provider.provider);
    const businessError = new Error('business failed');
    const businessMethod = jest.fn(() => {
        throw businessError;
    });

    class UserService {
        @Cache('write-error-users', { providerName: 'write-error-provider' })
        getUser(): never {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).rejects.toBe(businessError);
    expect(provider.get).toHaveBeenCalledTimes(1);
    expect(businessMethod).toHaveBeenCalledTimes(1);
    expect(provider.set).toHaveBeenCalledWith(expect.any(String), { error: businessError }, undefined);
    expect(events(mockLogger.debug)).toEqual(['cache.miss', 'cache.write_dispatched']);
    expect(loggedMetadata(mockLogger.debug)[1]).toEqual({
        event: 'cache.write_dispatched',
        cacheName: 'write-error-users',
        methodName: 'getUser',
        providerName: 'write-error-provider',
        entryType: 'error',
    });
    expect(mockLogger.error).not.toHaveBeenCalled();
});

it('cache-operation-logging/C06 回填后的重复调用命中缓存且不重复执行业务', async () => {
    let storedEntry: unknown;
    const provider = createProvider(undefined);
    provider.get.mockImplementation(() => storedEntry);
    provider.set.mockImplementation((_key, entry) => {
        storedEntry = entry;
    });
    CacheProviderRegistry.register('repeat-provider', provider.provider);
    const businessResult = { id: 9 };
    const businessMethod = jest.fn(() => businessResult);

    class UserService {
        @Cache('repeat-users', { providerName: 'repeat-provider' })
        getUser(): { id: number } {
            return businessMethod();
        }
    }

    const service = new UserService();
    await expect(service.getUser()).resolves.toBe(businessResult);
    await expect(service.getUser()).resolves.toBe(businessResult);

    expect(provider.get).toHaveBeenCalledTimes(2);
    expect(provider.set).toHaveBeenCalledTimes(1);
    expect(businessMethod).toHaveBeenCalledTimes(1);
    expect(events(mockLogger.debug)).toEqual(['cache.miss', 'cache.write_dispatched', 'cache.hit']);
});

it('cache-operation-logging/F04 异步 set 拒绝不会被等待或消费', async () => {
    let rejectWrite: ((reason?: unknown) => void) | undefined;
    const writeError = new Error('async write failed');
    const writePromise = new Promise<void>((_resolve, reject) => {
        rejectWrite = reject;
    });
    const observedWriteFailure = writePromise.catch((error: unknown) => error);
    const thenSpy = jest.spyOn(writePromise, 'then');
    const provider = createProvider(undefined);
    provider.set.mockReturnValue(writePromise);
    CacheProviderRegistry.register('async-write-provider', provider.provider);

    class UserService {
        @Cache('async-write-users', { providerName: 'async-write-provider' })
        getUser(): number {
            return 10;
        }
    }

    await expect(new UserService().getUser()).resolves.toBe(10);
    expect(provider.set).toHaveBeenCalledTimes(1);
    expect(thenSpy).not.toHaveBeenCalled();
    expect(events(mockLogger.debug)).toEqual(['cache.miss', 'cache.write_dispatched']);
    expect(events(mockLogger.debug)).not.toContain('cache.write_completed');

    if (!rejectWrite) {
        throw new Error('Write rejecter was not initialized');
    }
    rejectWrite(writeError);
    await expect(observedWriteFailure).resolves.toBe(writeError);
});

it('cache-operation-logging/F01 Provider 解析失败记录原始注册表异常且不执行业务', async () => {
    const registryError = new Error('provider resolution failed');
    jest.spyOn(CacheProviderRegistry, 'get').mockImplementation(() => {
        throw registryError;
    });
    const businessMethod = jest.fn();

    class UserService {
        @Cache('missing-provider-users', { providerName: 'missing-provider' })
        getUser(): unknown {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).rejects.toBe(registryError);
    expect(businessMethod).not.toHaveBeenCalled();
    expect(events(mockLogger.debug)).toEqual([]);
    expect(loggedMetadata(mockLogger.error)).toEqual([
        {
            event: 'cache.operation_failed',
            cacheName: 'missing-provider-users',
            methodName: 'getUser',
            providerName: 'missing-provider',
            operation: 'provider_resolution',
            error: registryError,
        },
    ]);
});

it('cache-operation-logging/F02 cache-operation-logging/M03 读取失败记录同一错误且不转为 miss', async () => {
    const readError = new Error('redis unavailable');
    const provider = createProvider(Promise.reject(readError));
    CacheProviderRegistry.register('unavailable-provider', provider.provider);
    const businessMethod = jest.fn();

    class UserService {
        @Cache('unavailable-users', { providerName: 'unavailable-provider' })
        getUser(): unknown {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).rejects.toBe(readError);
    expect(provider.get).toHaveBeenCalledTimes(1);
    expect(provider.set).not.toHaveBeenCalled();
    expect(businessMethod).not.toHaveBeenCalled();
    expect(events(mockLogger.debug)).not.toContain('cache.miss');
    expect(loggedMetadata(mockLogger.error)).toEqual([
        {
            event: 'cache.operation_failed',
            cacheName: 'unavailable-users',
            methodName: 'getUser',
            providerName: 'unavailable-provider',
            operation: 'read',
            error: readError,
        },
    ]);
});

it('cache-operation-logging/M01 默认和显式 Provider 使用稳定标签', async () => {
    const defaultProvider = createProvider({ value: 'default-value' });
    const explicitProvider = createProvider({ value: 'explicit-value' });
    CacheProviderRegistry.register('default-provider', defaultProvider.provider);
    CacheProviderRegistry.register('explicit-provider', explicitProvider.provider);
    CacheProviderRegistry.setDefault('default-provider');

    class UserService {
        @Cache('default-users')
        getDefault(): string {
            return 'business';
        }

        @Cache('explicit-users', { providerName: 'explicit-provider' })
        getExplicit(): string {
            return 'business';
        }
    }

    const service = new UserService();
    await expect(service.getDefault()).resolves.toBe('default-value');
    await expect(service.getExplicit()).resolves.toBe('explicit-value');
    expect(loggedMetadata(mockLogger.debug)).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                event: 'cache.hit',
                cacheName: 'default-users',
                methodName: 'getDefault',
                providerName: 'default',
            }),
            expect.objectContaining({
                event: 'cache.hit',
                cacheName: 'explicit-users',
                methodName: 'getExplicit',
                providerName: 'explicit-provider',
            }),
        ])
    );
});

it('cache-operation-logging/M02 参数、key、缓存值和返回值不进入日志元数据', async () => {
    const secretTokens = ['13800138000', 'user@example.com', 'credential-token', '敏感值'];
    const circularArgument: Record<string, unknown> = {
        phone: secretTokens[0],
        email: secretTokens[1],
    };
    circularArgument.self = circularArgument;
    const circularValue: Record<string, unknown> = {
        credential: secretTokens[2],
        unicode: secretTokens[3],
        empty: '',
    };
    circularValue.self = circularValue;
    const valueToJson = jest.fn(() => {
        throw new Error('cache value must not be serialized for logging');
    });
    Object.defineProperty(circularValue, 'toJSON', { value: valueToJson });

    const provider = createProvider(undefined);
    provider.get.mockImplementation((key) => (key.startsWith('sensitive-hit') ? { value: circularValue } : undefined));
    CacheProviderRegistry.register('sensitive-provider', provider.provider);

    class UserService {
        @Cache('sensitive-hit', {
            providerName: 'sensitive-provider',
            key: () => 'credential-token:physical-key',
        })
        getCached(_input: unknown): unknown {
            return 'business';
        }

        @Cache('sensitive-miss', {
            providerName: 'sensitive-provider',
            key: () => 'user@example.com:physical-key',
        })
        getFresh(_input: unknown): unknown {
            return circularValue;
        }
    }

    const service = new UserService();
    await expect(service.getCached(circularArgument)).resolves.toBe(circularValue);
    await expect(service.getFresh(circularArgument)).resolves.toBe(circularValue);

    const metadata = loggedMetadata(mockLogger.debug);
    const serializedMetadata = JSON.stringify(metadata);
    for (const token of secretTokens) {
        expect(serializedMetadata).not.toContain(token);
    }
    expect(metadata.every((item) => !('key' in item) && !('value' in item) && !('args' in item))).toBe(true);
    expect(valueToJson).not.toHaveBeenCalled();
});

it('cache-operation-logging/L03 Logger debug 失败不影响 cache hit', async () => {
    const cachedValue = { id: 11 };
    const provider = createProvider({ value: cachedValue });
    CacheProviderRegistry.register('logger-hit-provider', provider.provider);
    mockLogger.debug.mockImplementationOnce(() => {
        throw new Error('logger debug failed');
    });
    const businessMethod = jest.fn();

    class UserService {
        @Cache('logger-hit-users', { providerName: 'logger-hit-provider' })
        getUser(): unknown {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).resolves.toBe(cachedValue);
    expect(businessMethod).not.toHaveBeenCalled();
});

it('cache-operation-logging/L04 Logger error 失败不遮蔽原始读取异常', async () => {
    const readError = new Error('provider read failed');
    const provider = createProvider(Promise.reject(readError));
    CacheProviderRegistry.register('logger-error-provider', provider.provider);
    mockLogger.error.mockImplementationOnce(() => {
        throw new Error('logger error failed');
    });
    const businessMethod = jest.fn();

    class UserService {
        @Cache('logger-error-users', { providerName: 'logger-error-provider' })
        getUser(): unknown {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).rejects.toBe(readError);
    expect(businessMethod).not.toHaveBeenCalled();
    expect(events(mockLogger.debug)).not.toContain('cache.miss');
});

it('同步 set 失败记录 write operation 并保持既有错误回填控制流', async () => {
    const writeError = new Error('synchronous write failed');
    const provider = createProvider(undefined);
    provider.set.mockImplementationOnce(() => {
        throw writeError;
    });
    CacheProviderRegistry.register('sync-write-provider', provider.provider);

    class UserService {
        @Cache('sync-write-users', { providerName: 'sync-write-provider' })
        getUser(): number {
            return 12;
        }
    }

    await expect(new UserService().getUser()).rejects.toBe(writeError);
    expect(provider.set).toHaveBeenCalledTimes(2);
    expect(provider.set.mock.calls[1]?.[1]).toEqual({ error: writeError });
    expect(loggedMetadata(mockLogger.error)).toContainEqual({
        event: 'cache.operation_failed',
        cacheName: 'sync-write-users',
        methodName: 'getUser',
        providerName: 'sync-write-provider',
        operation: 'write',
        error: writeError,
    });
    expect(loggedMetadata(mockLogger.debug)).toContainEqual(
        expect.objectContaining({ event: 'cache.write_dispatched', entryType: 'error' })
    );
});
