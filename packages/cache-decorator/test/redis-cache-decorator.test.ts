import { createIoredisCacheClient } from '../src/adapters/ioredis-cache-client';
import { createNodeRedisCacheClient } from '../src/adapters/node-redis-cache-client';
import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { IoredisCacheClientSource, NodeRedisCacheClientSource } from '../src/core/redis-cache-client';
import { KeyBuilder } from '../src/core/key-builder';
import { MemoryCacheProvider } from '../src/core/native-cache';
import { RedisCacheProvider } from '../src/core/redis-cache';
import { CacheEvict } from '../src/decorators/cache-evict';
import { Cache, type CacheErrorCodec } from '../src/decorators/cache';

interface SharedRedisState {
    readonly values: Map<string, string>;
    readonly writes: Array<{ readonly key: string; readonly value: string; readonly ttlSeconds?: number }>;
    getError?: unknown;
    setError?: unknown;
    deleteError?: unknown;
    scanError?: unknown;
}

function createSharedRedisState(): SharedRedisState {
    return { values: new Map<string, string>(), writes: [] };
}

/** 创建会模拟 ioredis 透明 keyPrefix 的字符串命令源。 */
function createSharedIoredisSource(state: SharedRedisState, keyPrefix: string): IoredisCacheClientSource {
    const physicalKey = (key: string): string => `${keyPrefix}${key}`;
    return {
        options: Object.freeze({ keyPrefix }),
        get(key: string): Promise<unknown> {
            if (state.getError !== undefined) {
                return Promise.reject(state.getError);
            }
            return Promise.resolve(state.values.get(physicalKey(key)) ?? null);
        },
        set(key: string, value: string): Promise<unknown> {
            if (state.setError !== undefined) {
                return Promise.reject(state.setError);
            }
            const resolvedKey = physicalKey(key);
            state.values.set(resolvedKey, value);
            state.writes.push({ key: resolvedKey, value });
            return Promise.resolve('OK');
        },
        setex(key: string, ttlSeconds: number, value: string): Promise<unknown> {
            if (state.setError !== undefined) {
                return Promise.reject(state.setError);
            }
            const resolvedKey = physicalKey(key);
            state.values.set(resolvedKey, value);
            state.writes.push({ key: resolvedKey, value, ttlSeconds });
            return Promise.resolve('OK');
        },
        del(...keys: string[]): Promise<unknown> {
            if (state.deleteError !== undefined) {
                return Promise.reject(state.deleteError);
            }
            for (const key of keys) {
                state.values.delete(physicalKey(key));
            }
            return Promise.resolve(keys.length);
        },
        scan(..._args: Parameters<IoredisCacheClientSource['scan']>): Promise<unknown> {
            if (state.scanError !== undefined) {
                return Promise.reject(state.scanError);
            }
            return Promise.resolve(['0', []]);
        },
        flushdb(): Promise<unknown> {
            state.values.clear();
            return Promise.resolve('OK');
        },
    };
}

/** 创建接收显式物理 key 的 node-redis 字符串命令源。 */
function createSharedNodeRedisSource(state: SharedRedisState): NodeRedisCacheClientSource {
    return {
        get(key: string): Promise<unknown> {
            if (state.getError !== undefined) {
                return Promise.reject(state.getError);
            }
            return Promise.resolve(state.values.get(key) ?? null);
        },
        set(key: string, value: string): Promise<unknown> {
            if (state.setError !== undefined) {
                return Promise.reject(state.setError);
            }
            state.values.set(key, value);
            state.writes.push({ key, value });
            return Promise.resolve('OK');
        },
        setEx(key: string, ttlSeconds: number, value: string): Promise<unknown> {
            if (state.setError !== undefined) {
                return Promise.reject(state.setError);
            }
            state.values.set(key, value);
            state.writes.push({ key, value, ttlSeconds });
            return Promise.resolve('OK');
        },
        del(keys: string | string[]): Promise<unknown> {
            if (state.deleteError !== undefined) {
                return Promise.reject(state.deleteError);
            }
            const deletedKeys = typeof keys === 'string' ? [keys] : keys;
            for (const key of deletedKeys) {
                state.values.delete(key);
            }
            return Promise.resolve(deletedKeys.length);
        },
        scan(): Promise<unknown> {
            if (state.scanError !== undefined) {
                return Promise.reject(state.scanError);
            }
            return Promise.resolve({ cursor: '0', keys: [] });
        },
        flushDb(): Promise<unknown> {
            state.values.clear();
            return Promise.resolve('OK');
        },
    };
}

class FakeIoredisCacheClientSource implements IoredisCacheClientSource {
    readonly options = Object.freeze({ keyPrefix: '' });
    readonly writes: Array<{
        readonly key: string;
        readonly value: string;
        readonly ttlSeconds: number | undefined;
    }> = [];
    private readonly values = new Map<string, string>();

    constructor(private readonly events: string[]) {}

    get(key: string): Promise<unknown> {
        this.events.push(`get:${key}`);
        return Promise.resolve(this.values.get(key) ?? null);
    }

    set(key: string, value: string): Promise<unknown> {
        this.events.push(`set:${key}`);
        this.writes.push({ key, value, ttlSeconds: undefined });
        this.values.set(key, value);
        return Promise.resolve('OK');
    }

    setex(key: string, ttlSeconds: number, value: string): Promise<unknown> {
        this.events.push(`setex:${key}`);
        this.writes.push({ key, value, ttlSeconds });
        this.values.set(key, value);
        return Promise.resolve('OK');
    }

    del(...keys: string[]): Promise<unknown> {
        this.events.push(`del:${keys.join(',')}`);
        let deleted = 0;
        for (const key of keys) {
            if (this.values.delete(key)) {
                deleted += 1;
            }
        }
        return Promise.resolve(deleted);
    }

    scan(..._args: Parameters<IoredisCacheClientSource['scan']>): Promise<unknown> {
        return Promise.resolve(['0', []]);
    }

    flushdb(): Promise<unknown> {
        this.values.clear();
        return Promise.resolve('OK');
    }

    seed(key: string, value: string): void {
        this.values.set(key, value);
    }

    raw(key: string): string | undefined {
        return this.values.get(key);
    }
}

beforeEach(() => CacheProviderRegistry.clear());
afterEach(() => CacheProviderRegistry.clear());

it('redis-cache-client/D01 默认 Redis Provider 保持装饰器调用方式', async () => {
    const events: string[] = [];
    const source = new FakeIoredisCacheClientSource(events);
    const provider = new RedisCacheProvider(createIoredisCacheClient(source));
    CacheProviderRegistry.register('redis', provider);
    CacheProviderRegistry.setDefault('redis');
    const cacheKey = KeyBuilder.build('d01-users', [1]);

    class UserService {
        @Cache('d01-users')
        async getUser(id: number): Promise<{ id: number; version: number }> {
            events.push(`business:get:${id}`);
            return { id, version: events.filter((event) => event === `business:get:${id}`).length };
        }

        @CacheEvict('d01-users')
        async updateUser(id: number): Promise<{ id: number; updated: boolean }> {
            events.push(`business:update:${id}`);
            return { id, updated: true };
        }
    }

    const service = new UserService();
    await expect(service.getUser(1)).resolves.toEqual({ id: 1, version: 1 });
    await expect(service.getUser(1)).resolves.toEqual({ id: 1, version: 1 });
    await expect(service.updateUser(1)).resolves.toEqual({ id: 1, updated: true });
    await expect(service.getUser(1)).resolves.toEqual({ id: 1, version: 2 });

    expect(events).toEqual([
        `get:${cacheKey}`,
        'business:get:1',
        `set:${cacheKey}`,
        `get:${cacheKey}`,
        'business:update:1',
        `del:${cacheKey}`,
        `get:${cacheKey}`,
        'business:get:1',
        `set:${cacheKey}`,
    ]);
});

it('redis-cache-client/D02 指定 Provider 名称保持原行为', async () => {
    const events: string[] = [];
    const redisProvider = new RedisCacheProvider(createIoredisCacheClient(new FakeIoredisCacheClientSource(events)));
    const memoryProvider = new MemoryCacheProvider();
    CacheProviderRegistry.register('redis', redisProvider);
    CacheProviderRegistry.register('memory', memoryProvider);
    CacheProviderRegistry.setDefault('memory');
    const redisKey = KeyBuilder.build('d02-orders', ['active']);

    class OrderService {
        redisCalls = 0;
        memoryCalls = 0;

        @Cache('d02-orders', { providerName: 'redis', key: 'active' })
        async getRedisOrder(id: number): Promise<{ id: number; source: string }> {
            this.redisCalls += 1;
            return { id, source: 'redis' };
        }

        @Cache('d02-orders', { providerName: 'memory', key: 'active' })
        async getMemoryOrder(id: number): Promise<{ id: number; source: string }> {
            this.memoryCalls += 1;
            return { id, source: 'memory' };
        }

        @CacheEvict('d02-orders', { providerName: 'redis', key: 'active' })
        async evictRedisOrder(): Promise<string> {
            return 'evicted';
        }
    }

    const service = new OrderService();
    await expect(service.getRedisOrder(1)).resolves.toEqual({ id: 1, source: 'redis' });
    await expect(service.getRedisOrder(2)).resolves.toEqual({ id: 1, source: 'redis' });
    await expect(service.getMemoryOrder(3)).resolves.toEqual({ id: 3, source: 'memory' });
    await expect(service.getMemoryOrder(4)).resolves.toEqual({ id: 3, source: 'memory' });
    await expect(service.evictRedisOrder()).resolves.toBe('evicted');
    await expect(service.getRedisOrder(5)).resolves.toEqual({ id: 5, source: 'redis' });
    await expect(service.getMemoryOrder(6)).resolves.toEqual({ id: 3, source: 'memory' });

    expect(service.redisCalls).toBe(2);
    expect(service.memoryCalls).toBe(1);
    expect(events.filter((event) => event === `get:${redisKey}`)).toHaveLength(3);
    expect(events).toContain(`del:${redisKey}`);
});

it('cache-operation-logging/A03 日志改造保持旧版 Redis key、entry、TTL 与淘汰 pattern', async () => {
    const events: string[] = [];
    const source = new FakeIoredisCacheClientSource(events);
    const scan = jest.spyOn(source, 'scan');
    const provider = new RedisCacheProvider(createIoredisCacheClient(source));
    CacheProviderRegistry.register('compat-redis', provider);
    const legacyKey = KeyBuilder.build('compat-users', ['legacy']);
    const freshKey = KeyBuilder.build('compat-users', ['fresh']);
    source.seed(legacyKey, '{"value":{"id":18,"source":"legacy-0.1.3"}}');
    let legacyBusinessCalls = 0;

    class UserService {
        @Cache('compat-users', { providerName: 'compat-redis', key: 'legacy' })
        async getLegacyUser(): Promise<{ id: number; source: string }> {
            legacyBusinessCalls += 1;
            return { id: 0, source: 'business' };
        }

        @Cache('compat-users', { providerName: 'compat-redis', key: 'fresh', ttl: 45 })
        async getFreshUser(): Promise<{ id: number; source: string }> {
            return { id: 19, source: 'current' };
        }

        @CacheEvict('compat-users', { providerName: 'compat-redis', allEntries: true })
        async clearUsers(): Promise<boolean> {
            return true;
        }
    }

    const service = new UserService();
    await expect(service.getLegacyUser()).resolves.toEqual({ id: 18, source: 'legacy-0.1.3' });
    expect(legacyBusinessCalls).toBe(0);
    await expect(service.getFreshUser()).resolves.toEqual({ id: 19, source: 'current' });
    expect(source.raw(freshKey)).toBe('{"value":{"id":19,"source":"current"}}');
    expect(source.writes).toContainEqual({
        key: freshKey,
        value: '{"value":{"id":19,"source":"current"}}',
        ttlSeconds: 45,
    });

    await expect(service.clearUsers()).resolves.toBe(true);
    expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'compat-users*', 'COUNT', 100);
});

it('标准 Error 通过 ioredis/node-redis 双向共享版本化异常条目', async () => {
    const state = createSharedRedisState();
    const keyPrefix = 'cross-client:';
    const ioProvider = new RedisCacheProvider(createIoredisCacheClient(createSharedIoredisSource(state, keyPrefix)));
    const nodeProvider = new RedisCacheProvider(
        createNodeRedisCacheClient(createSharedNodeRedisSource(state), { keyPrefix })
    );
    CacheProviderRegistry.register('cross-io', ioProvider);
    CacheProviderRegistry.register('cross-node', nodeProvider);
    const ioBusinessError = new Error('written by ioredis');
    ioBusinessError.name = 'IoBusinessError';
    const nodeBusinessError = new Error('written by node-redis');
    nodeBusinessError.name = 'NodeBusinessError';
    let ioReaderCalls = 0;
    let nodeReaderCalls = 0;

    class ErrorService {
        @Cache('io-to-node-errors', {
            providerName: 'cross-io',
            key: 'shared',
            errorCache: { ttl: 11 },
        })
        async writeWithIoredis(): Promise<never> {
            throw ioBusinessError;
        }

        @Cache('io-to-node-errors', {
            providerName: 'cross-node',
            key: 'shared',
            errorCache: { ttl: 11 },
        })
        async readWithNodeRedis(): Promise<never> {
            nodeReaderCalls += 1;
            throw new Error('node reader should not run');
        }

        @Cache('node-to-io-errors', {
            providerName: 'cross-node',
            key: 'shared',
            errorCache: { ttl: 13 },
        })
        async writeWithNodeRedis(): Promise<never> {
            throw nodeBusinessError;
        }

        @Cache('node-to-io-errors', {
            providerName: 'cross-io',
            key: 'shared',
            errorCache: { ttl: 13 },
        })
        async readWithIoredis(): Promise<never> {
            ioReaderCalls += 1;
            throw new Error('ioredis reader should not run');
        }
    }

    const service = new ErrorService();
    await expect(service.writeWithIoredis()).rejects.toBe(ioBusinessError);
    await expect(service.readWithNodeRedis()).rejects.toMatchObject({
        name: 'IoBusinessError',
        message: 'written by ioredis',
    });
    await expect(service.writeWithNodeRedis()).rejects.toBe(nodeBusinessError);
    await expect(service.readWithIoredis()).rejects.toMatchObject({
        name: 'NodeBusinessError',
        message: 'written by node-redis',
    });

    expect(nodeReaderCalls).toBe(0);
    expect(ioReaderCalls).toBe(0);
    expect(state.writes.map(({ ttlSeconds }) => ttlSeconds)).toEqual([11, 13]);
    expect([...state.values.keys()]).toEqual(
        expect.arrayContaining([
            `${keyPrefix}${KeyBuilder.build('io-to-node-errors', ['shared'])}`,
            `${keyPrefix}${KeyBuilder.build('node-to-io-errors', ['shared'])}`,
        ])
    );
});

it('兼容自定义 codec 可跨 Redis 客户端恢复领域异常', async () => {
    class DomainError extends Error {
        constructor(readonly code: string) {
            super(`domain:${code}`);
            this.name = 'DomainError';
        }
    }

    const state = createSharedRedisState();
    const keyPrefix = 'custom-codec:';
    const ioProvider = new RedisCacheProvider(createIoredisCacheClient(createSharedIoredisSource(state, keyPrefix)));
    const nodeProvider = new RedisCacheProvider(
        createNodeRedisCacheClient(createSharedNodeRedisSource(state), { keyPrefix })
    );
    CacheProviderRegistry.register('custom-io', ioProvider);
    CacheProviderRegistry.register('custom-node', nodeProvider);
    const codec: CacheErrorCodec = {
        encode(error: unknown): unknown {
            if (!(error instanceof DomainError)) {
                throw new TypeError('unexpected domain error');
            }
            return { code: error.code };
        },
        decode(payload: unknown): unknown {
            if (typeof payload !== 'object' || payload === null || !('code' in payload)) {
                throw new TypeError('invalid domain payload');
            }
            return new DomainError(String(payload.code));
        },
    };
    const businessError = new DomainError('NOT_FOUND');
    const reader = jest.fn();

    class DomainService {
        @Cache('cross-domain-errors', {
            providerName: 'custom-io',
            key: 'shared',
            errorCache: { ttl: 7, codec },
        })
        async write(): Promise<never> {
            throw businessError;
        }

        @Cache('cross-domain-errors', {
            providerName: 'custom-node',
            key: 'shared',
            errorCache: { ttl: 7, codec },
        })
        async read(): Promise<never> {
            reader();
            throw new Error('reader should not run');
        }
    }

    const service = new DomainService();
    await expect(service.write()).rejects.toBe(businessError);
    await expect(service.read()).rejects.toMatchObject({ name: 'DomainError', code: 'NOT_FOUND' });
    expect(reader).not.toHaveBeenCalled();
    expect(JSON.parse(state.writes[0]!.value)).toEqual({
        error: {
            kind: '@jintianxiayu/cache-decorator/error',
            version: 1,
            payload: { code: 'NOT_FOUND' },
        },
    });
});

it('Redis 中 legacy 与禁用的异常条目均旁路为 miss 并由成功结果覆盖', async () => {
    const state = createSharedRedisState();
    const keyPrefix = 'bypass:';
    const nodeProvider = new RedisCacheProvider(
        createNodeRedisCacheClient(createSharedNodeRedisSource(state), { keyPrefix })
    );
    CacheProviderRegistry.register('bypass-node', nodeProvider);
    const legacyKey = KeyBuilder.build('legacy-redis-errors', ['shared']);
    const disabledKey = KeyBuilder.build('disabled-redis-errors', ['shared']);
    state.values.set(`${keyPrefix}${legacyKey}`, JSON.stringify({ error: { message: 'legacy' } }));
    state.values.set(
        `${keyPrefix}${disabledKey}`,
        JSON.stringify({
            error: {
                kind: '@jintianxiayu/cache-decorator/error',
                version: 1,
                payload: { type: 'error', name: 'Error', message: 'cached' },
            },
        })
    );
    const legacyBusiness = jest.fn(() => 'legacy-fresh');
    const disabledBusiness = jest.fn(() => 'disabled-fresh');

    class UserService {
        @Cache('legacy-redis-errors', {
            providerName: 'bypass-node',
            key: 'shared',
            errorCache: { ttl: 5 },
        })
        async readLegacy(): Promise<string> {
            return legacyBusiness();
        }

        @Cache('disabled-redis-errors', { providerName: 'bypass-node', key: 'shared' })
        async readDisabled(): Promise<string> {
            return disabledBusiness();
        }
    }

    const service = new UserService();
    await expect(service.readLegacy()).resolves.toBe('legacy-fresh');
    await expect(service.readDisabled()).resolves.toBe('disabled-fresh');
    expect(legacyBusiness).toHaveBeenCalledTimes(1);
    expect(disabledBusiness).toHaveBeenCalledTimes(1);
    expect(JSON.parse(state.values.get(`${keyPrefix}${legacyKey}`)!)).toEqual({ value: 'legacy-fresh' });
    expect(JSON.parse(state.values.get(`${keyPrefix}${disabledKey}`)!)).toEqual({ value: 'disabled-fresh' });
});

it('不可序列化异常 payload 不向 Redis 发送 SET', async () => {
    const state = createSharedRedisState();
    const keyPrefix = 'invalid-payload:';
    const ioProvider = new RedisCacheProvider(createIoredisCacheClient(createSharedIoredisSource(state, keyPrefix)));
    CacheProviderRegistry.register('invalid-payload-io', ioProvider);
    const businessError = new Error('business failure');
    const cyclicPayload: Record<string, unknown> = {};
    cyclicPayload.self = cyclicPayload;

    class UserService {
        @Cache('invalid-redis-errors', {
            providerName: 'invalid-payload-io',
            errorCache: {
                ttl: 5,
                codec: {
                    encode: (): unknown => cyclicPayload,
                    decode: (payload: unknown): unknown => payload,
                },
            },
        })
        async getUser(): Promise<never> {
            throw businessError;
        }
    }

    await expect(new UserService().getUser()).rejects.toBe(businessError);
    expect(state.writes).toEqual([]);
    expect(state.values).toEqual(new Map());
});

it('Redis GET 失败旁路缓存且不调用异常策略', async () => {
    const state = createSharedRedisState();
    const readError = new Error('GET unavailable');
    state.getError = readError;
    const nodeProvider = new RedisCacheProvider(createNodeRedisCacheClient(createSharedNodeRedisSource(state)));
    CacheProviderRegistry.register('failed-get-node', nodeProvider);
    const shouldCache = jest.fn((_error: unknown): boolean => true);
    const encode = jest.fn((error: unknown): unknown => error);
    const decode = jest.fn((payload: unknown): unknown => payload);
    const businessResult = { id: 22 };
    const businessMethod = jest.fn(() => businessResult);

    class UserService {
        @Cache('failed-get-errors', {
            providerName: 'failed-get-node',
            errorCache: { ttl: 5, shouldCache, codec: { encode, decode } },
        })
        async getUser(): Promise<unknown> {
            return businessMethod();
        }
    }

    await expect(new UserService().getUser()).resolves.toBe(businessResult);
    expect(businessMethod).toHaveBeenCalledTimes(1);
    expect(shouldCache).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
});

it('redis-cache-client/E07 Redis 写入与淘汰命令失败不改变装饰器业务结果', async () => {
    const state = createSharedRedisState();
    state.setError = new Error('SET unavailable');
    state.deleteError = new Error('DEL unavailable');
    state.scanError = new Error('SCAN unavailable');
    const provider = new RedisCacheProvider(createNodeRedisCacheClient(createSharedNodeRedisSource(state)));
    CacheProviderRegistry.register('failed-commands-node', provider);

    class UserService {
        @Cache('failed-set-users', { providerName: 'failed-commands-node' })
        getUser(): string {
            return 'business-read';
        }

        @CacheEvict('failed-delete-users', { providerName: 'failed-commands-node', key: 'user-24' })
        updateUser(): string {
            return 'business-update';
        }

        @CacheEvict('failed-scan-users', { providerName: 'failed-commands-node', allEntries: true })
        clearUsers(): string {
            return 'business-clear';
        }
    }

    const service = new UserService();
    await expect(service.getUser()).resolves.toBe('business-read');
    await expect(service.updateUser()).resolves.toBe('business-update');
    await expect(service.clearUsers()).resolves.toBe('business-clear');
    await Promise.resolve();
    expect(state.writes).toEqual([]);
});
