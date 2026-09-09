jest.mock('@jintianxiayu/logger', () => ({
    LoggerFactory: {
        getLogger: jest.fn(),
    },
}));

import { LoggerFactory, type LoggerInterface } from '@jintianxiayu/logger';
import type { CacheProvider } from '../src/core/cache-provider';
import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { KeyBuilder } from '../src/core/key-builder';
import { CacheEvict } from '../src/decorators/cache-evict';

interface EvictProviderHarness {
    readonly provider: CacheProvider;
    readonly delete: jest.Mock<unknown, [string]>;
    readonly deleteByPattern: jest.Mock<unknown, [string]>;
}

interface CacheLogMetadata {
    readonly event: string;
    readonly cacheName: string;
    readonly methodName: string;
    readonly providerName: string;
    readonly scope?: string;
    readonly reason?: string;
    readonly operation?: string;
    readonly error?: unknown;
}

const mockLogger: jest.Mocked<LoggerInterface> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
const mockGetLogger = jest.mocked(LoggerFactory.getLogger);

/** 创建可观察单 key 与全量删除调用的测试 Provider。 */
function createProvider(): EvictProviderHarness {
    const deleteEntry = jest.fn<unknown, [string]>();
    const deleteByPattern = jest.fn<unknown, [string]>();
    const provider: CacheProvider = {
        get: <Value>(_key: string): Value | undefined => undefined,
        set: <Value>(_key: string, _value: Value, _ttl?: number): void => {
            return;
        },
        delete: (key: string): void | Promise<void> => deleteEntry(key) as void | Promise<void>,
        clear: (): void => {
            return;
        },
        deleteByPattern: (pattern: string): void | Promise<void> => deleteByPattern(pattern) as void | Promise<void>,
    };
    return { provider, delete: deleteEntry, deleteByPattern };
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

it('cache-operation-logging/E03 业务失败记录 skipped 且完全跳过淘汰准备', async () => {
    const provider = createProvider();
    CacheProviderRegistry.register('skipped-provider', provider.provider);
    const registryGet = jest.spyOn(CacheProviderRegistry, 'get');
    const resolver = jest.fn(() => 'unused-key');
    const businessError = new Error('business update failed');

    class UserService {
        @CacheEvict('skipped-users', { providerName: 'skipped-provider', key: resolver })
        updateUser(): never {
            throw businessError;
        }
    }

    await expect(new UserService().updateUser()).rejects.toBe(businessError);
    expect(registryGet).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(provider.delete).not.toHaveBeenCalled();
    expect(provider.deleteByPattern).not.toHaveBeenCalled();
    expect(loggedMetadata(mockLogger.warn)).toEqual([
        {
            event: 'cache.evict_skipped',
            cacheName: 'skipped-users',
            methodName: 'updateUser',
            providerName: 'skipped-provider',
            reason: 'business_error',
        },
    ]);
    expect(mockLogger.debug).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
});

it('cache-operation-logging/K02 单 key resolver 失败后记录 fallback 并只删除默认 key', async () => {
    const provider = createProvider();
    CacheProviderRegistry.register('fallback-evict-provider', provider.provider);
    const resolver = jest.fn(() => {
        throw new Error('resolver failed with secret');
    });
    const businessResult = { updated: true };

    class UserService {
        @CacheEvict('fallback-evict-users', { providerName: 'fallback-evict-provider', key: resolver })
        updateUser(id: number): { updated: boolean } {
            return { ...businessResult, id };
        }
    }

    const result = await new UserService().updateUser(13);
    expect(result).toEqual({ ...businessResult, id: 13 });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(provider.delete).toHaveBeenCalledWith(KeyBuilder.build('fallback-evict-users', [13]));
    expect(provider.deleteByPattern).not.toHaveBeenCalled();
    expect(loggedMetadata(mockLogger.warn)).toEqual([
        {
            event: 'cache.key_fallback',
            cacheName: 'fallback-evict-users',
            methodName: 'updateUser',
            providerName: 'fallback-evict-provider',
            reason: 'resolver_error',
        },
    ]);
    expect(JSON.stringify(loggedMetadata(mockLogger.warn))).not.toContain('resolver failed with secret');
});

it('cache-operation-logging/K03 allEntries 忽略 resolver 且不记录 fallback', async () => {
    const provider = createProvider();
    CacheProviderRegistry.register('all-entries-provider', provider.provider);
    const resolver = jest.fn(() => {
        throw new Error('must not run');
    });

    class UserService {
        @CacheEvict('all-users', {
            providerName: 'all-entries-provider',
            allEntries: true,
            key: resolver,
        })
        clearUsers(): string {
            return 'cleared';
        }
    }

    await expect(new UserService().clearUsers()).resolves.toBe('cleared');
    expect(resolver).not.toHaveBeenCalled();
    expect(provider.delete).not.toHaveBeenCalled();
    expect(provider.deleteByPattern).toHaveBeenCalledTimes(1);
    expect(provider.deleteByPattern).toHaveBeenCalledWith('all-users*');
    expect(events(mockLogger.warn)).not.toContain('cache.key_fallback');
});

it('cache-operation-logging/E01 单 key 删除返回控制权后记录 dispatched', async () => {
    const provider = createProvider();
    CacheProviderRegistry.register('single-evict-provider', provider.provider);
    const businessResult = { deleted: true };

    class UserService {
        @CacheEvict('single-users', { providerName: 'single-evict-provider', key: 'user-14' })
        deleteUser(): { deleted: boolean } {
            return businessResult;
        }
    }

    await expect(new UserService().deleteUser()).resolves.toBe(businessResult);
    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(provider.deleteByPattern).not.toHaveBeenCalled();
    expect(loggedMetadata(mockLogger.debug)).toEqual([
        {
            event: 'cache.evict_dispatched',
            cacheName: 'single-users',
            methodName: 'deleteUser',
            providerName: 'single-evict-provider',
            scope: 'key',
        },
    ]);
});

it('cache-operation-logging/E02 allEntries 等待删除完成后才记录 completed', async () => {
    let resolveEviction: (() => void) | undefined;
    const evictionPromise = new Promise<void>((resolve) => {
        resolveEviction = resolve;
    });
    const provider = createProvider();
    provider.deleteByPattern.mockReturnValue(evictionPromise);
    CacheProviderRegistry.register('awaited-evict-provider', provider.provider);

    class UserService {
        @CacheEvict('awaited-users', { providerName: 'awaited-evict-provider', allEntries: true })
        clearUsers(): string {
            return 'cleared';
        }
    }

    const operation = new UserService().clearUsers() as unknown as Promise<string>;
    await Promise.resolve();
    expect(provider.deleteByPattern).toHaveBeenCalledWith('awaited-users*');
    expect(events(mockLogger.debug)).not.toContain('cache.evict_completed');

    if (!resolveEviction) {
        throw new Error('Eviction resolver was not initialized');
    }
    resolveEviction();
    await expect(operation).resolves.toBe('cleared');
    expect(loggedMetadata(mockLogger.debug)).toEqual([
        {
            event: 'cache.evict_completed',
            cacheName: 'awaited-users',
            methodName: 'clearUsers',
            providerName: 'awaited-evict-provider',
            scope: 'allEntries',
        },
    ]);
});

it('cache-operation-logging/E04 重复淘汰每次只执行一次实际删除和一次日志', async () => {
    const provider = createProvider();
    CacheProviderRegistry.register('repeat-evict-provider', provider.provider);

    class UserService {
        @CacheEvict('repeat-evict-users', { providerName: 'repeat-evict-provider', key: 'shared' })
        deleteUser(): boolean {
            return true;
        }
    }

    const service = new UserService();
    await service.deleteUser();
    await service.deleteUser();
    expect(provider.delete).toHaveBeenCalledTimes(2);
    expect(events(mockLogger.debug)).toEqual(['cache.evict_dispatched', 'cache.evict_dispatched']);
});

it('cache-operation-logging/F03 allEntries 删除失败记录同一错误且保留业务结果', async () => {
    const evictionError = new Error('redis scan failed');
    const provider = createProvider();
    provider.deleteByPattern.mockRejectedValue(evictionError);
    CacheProviderRegistry.register('failed-all-evict-provider', provider.provider);

    class UserService {
        @CacheEvict('failed-all-users', { providerName: 'failed-all-evict-provider', allEntries: true })
        clearUsers(): boolean {
            return true;
        }
    }

    await expect(new UserService().clearUsers()).resolves.toBe(true);
    expect(provider.deleteByPattern).toHaveBeenCalledTimes(1);
    expect(events(mockLogger.debug)).not.toContain('cache.evict_completed');
    expect(loggedMetadata(mockLogger.error)).toEqual([
        {
            event: 'cache.operation_failed',
            cacheName: 'failed-all-users',
            methodName: 'clearUsers',
            providerName: 'failed-all-evict-provider',
            operation: 'evict',
            error: evictionError,
        },
    ]);
});

it('cache-operation-logging/F03 allEntries 同步删除失败保留业务结果且不报告 completed', async () => {
    const evictionError = new Error('synchronous scan failed');
    const provider = createProvider();
    provider.deleteByPattern.mockImplementation(() => {
        throw evictionError;
    });
    CacheProviderRegistry.register('sync-failed-all-provider', provider.provider);

    class UserService {
        @CacheEvict('sync-failed-all-users', { providerName: 'sync-failed-all-provider', allEntries: true })
        clearUsers(): string {
            return 'business-result';
        }
    }

    await expect(new UserService().clearUsers()).resolves.toBe('business-result');
    expect(events(mockLogger.debug)).not.toContain('cache.evict_completed');
    expect(loggedMetadata(mockLogger.error)).toContainEqual({
        event: 'cache.operation_failed',
        cacheName: 'sync-failed-all-users',
        methodName: 'clearUsers',
        providerName: 'sync-failed-all-provider',
        operation: 'evict',
        error: evictionError,
    });
});

it('cache-operation-logging/F05 异步单 key 删除拒绝被观察但不改变业务结果', async () => {
    let rejectEviction: ((reason?: unknown) => void) | undefined;
    const evictionError = new Error('async delete failed');
    const evictionPromise = new Promise<void>((_resolve, reject) => {
        rejectEviction = reject;
    });
    const thenSpy = jest.spyOn(evictionPromise, 'then');
    const provider = createProvider();
    provider.delete.mockReturnValue(evictionPromise);
    CacheProviderRegistry.register('async-delete-provider', provider.provider);

    class UserService {
        @CacheEvict('async-delete-users', { providerName: 'async-delete-provider', key: 'user-15' })
        deleteUser(): number {
            return 15;
        }
    }

    await expect(new UserService().deleteUser()).resolves.toBe(15);
    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(thenSpy).toHaveBeenCalledTimes(1);
    expect(events(mockLogger.debug)).toEqual(['cache.evict_dispatched']);
    expect(events(mockLogger.debug)).not.toContain('cache.evict_completed');

    if (!rejectEviction) {
        throw new Error('Eviction rejecter was not initialized');
    }
    rejectEviction(evictionError);
    await Promise.resolve();
    expect(loggedMetadata(mockLogger.error)).toContainEqual({
        event: 'cache.operation_failed',
        cacheName: 'async-delete-users',
        methodName: 'deleteUser',
        providerName: 'async-delete-provider',
        operation: 'evict',
        error: evictionError,
    });
});

it('淘汰 Provider 解析失败记录 provider_resolution 且保留业务结果', async () => {
    const registryError = new Error('evict provider missing');
    jest.spyOn(CacheProviderRegistry, 'get').mockImplementation(() => {
        throw registryError;
    });
    const businessMethod = jest.fn(() => 'updated');
    const resolver = jest.fn(() => 'unused-key');

    class UserService {
        @CacheEvict('missing-evict-users', { providerName: 'missing-evict-provider', key: resolver })
        updateUser(): string {
            return businessMethod();
        }
    }

    await expect(new UserService().updateUser()).resolves.toBe('updated');
    expect(businessMethod).toHaveBeenCalledTimes(1);
    expect(resolver).not.toHaveBeenCalled();
    expect(loggedMetadata(mockLogger.error)).toEqual([
        {
            event: 'cache.operation_failed',
            cacheName: 'missing-evict-users',
            methodName: 'updateUser',
            providerName: 'missing-evict-provider',
            operation: 'provider_resolution',
            error: registryError,
        },
    ]);
    expect(mockLogger.debug).not.toHaveBeenCalled();
});

it('同步单 key 删除失败记录 evict operation 且保留业务结果', async () => {
    const evictionError = new Error('synchronous delete failed');
    const provider = createProvider();
    provider.delete.mockImplementation(() => {
        throw evictionError;
    });
    CacheProviderRegistry.register('sync-delete-provider', provider.provider);

    class UserService {
        @CacheEvict('sync-delete-users', { providerName: 'sync-delete-provider' })
        deleteUser(id: number): number {
            return id;
        }
    }

    await expect(new UserService().deleteUser(16)).resolves.toBe(16);
    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(events(mockLogger.debug)).not.toContain('cache.evict_dispatched');
    expect(loggedMetadata(mockLogger.error)).toContainEqual({
        event: 'cache.operation_failed',
        cacheName: 'sync-delete-users',
        methodName: 'deleteUser',
        providerName: 'sync-delete-provider',
        operation: 'evict',
        error: evictionError,
    });
});
