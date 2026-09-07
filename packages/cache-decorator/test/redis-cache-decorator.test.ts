import { createIoredisCacheClient } from '../src/adapters/ioredis-cache-client';
import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { IoredisCacheClientSource } from '../src/core/redis-cache-client';
import { KeyBuilder } from '../src/core/key-builder';
import { MemoryCacheProvider } from '../src/core/native-cache';
import { RedisCacheProvider } from '../src/core/redis-cache';
import { CacheEvict } from '../src/decorators/cache-evict';
import { Cache } from '../src/decorators/cache';

class FakeIoredisCacheClientSource implements IoredisCacheClientSource {
    readonly options = Object.freeze({ keyPrefix: '' });
    private readonly values = new Map<string, string>();

    constructor(private readonly events: string[]) {}

    get(key: string): Promise<unknown> {
        this.events.push(`get:${key}`);
        return Promise.resolve(this.values.get(key) ?? null);
    }

    set(key: string, value: string): Promise<unknown> {
        this.events.push(`set:${key}`);
        this.values.set(key, value);
        return Promise.resolve('OK');
    }

    setex(key: string, _ttlSeconds: number, value: string): Promise<unknown> {
        this.events.push(`setex:${key}`);
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
