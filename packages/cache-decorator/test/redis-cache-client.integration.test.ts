import { once } from 'node:events';
import Redis from 'ioredis';
import { createIoredisCacheClient } from '../src/adapters/ioredis-cache-client';
import { createNodeRedisCacheClient } from '../src/adapters/node-redis-cache-client';
import { RedisCacheProvider } from '../src/core/redis-cache';
import { writeLegacyRedisCache } from './helpers/legacy-redis-cache';
import { RedisFixture, createIsolatedDatabaseRedisFixture, createRedisFixture } from './helpers/redis-fixture';

const redisUrl = process.env.CACHE_DECORATOR_TEST_REDIS_URL;
const redisTests = redisUrl ? describe : describe.skip;

interface TestKeyNamespace {
    readonly keyPrefix: string;
    physicalKey(logicalKey: string): string;
}

function createKeyNamespace(fixture: RedisFixture): TestKeyNamespace {
    const keyPrefix = `${fixture.key()}:`;
    return {
        keyPrefix,
        physicalKey(logicalKey: string): string {
            return fixture.track(`${keyPrefix}${logicalKey}`);
        },
    };
}

redisTests('真实 Redis 夹具（需 CACHE_DECORATOR_TEST_REDIS_URL）', () => {
    let fixture: RedisFixture | undefined;

    beforeEach(async () => {
        if (!redisUrl) {
            throw new Error('CACHE_DECORATOR_TEST_REDIS_URL is required');
        }
        fixture = await createRedisFixture(redisUrl);
    });

    afterEach(async () => fixture?.close());

    it('双客户端连接及夹具清理只影响自有唯一 key', async () => {
        if (!redisUrl || !fixture) {
            throw new Error('CACHE_DECORATOR_TEST_REDIS_URL is required');
        }
        const observer = await createRedisFixture(redisUrl);
        const ownKey = fixture.key();
        const otherKey = observer.key();
        try {
            await expect(fixture.io.ping()).resolves.toBe('PONG');
            await expect(fixture.node.ping()).resolves.toBe('PONG');
            await fixture.io.set(ownKey, 'owned');
            await observer.node.set(otherKey, 'untouched');
            await fixture.close();
            await expect(observer.node.get(ownKey)).resolves.toBeNull();
            await expect(observer.node.get(otherKey)).resolves.toBe('untouched');
            expect(fixture.errors).toEqual([]);
        } finally {
            await observer.close();
        }
    });
});

redisTests('Redis 客户端数据与互操作协议', () => {
    let fixture: RedisFixture | undefined;
    let ioProvider: RedisCacheProvider;
    let nodeProvider: RedisCacheProvider;

    beforeEach(async () => {
        if (!redisUrl) {
            throw new Error('CACHE_DECORATOR_TEST_REDIS_URL is required');
        }
        fixture = await createRedisFixture(redisUrl);
        ioProvider = new RedisCacheProvider(createIoredisCacheClient(fixture.io));
        nodeProvider = new RedisCacheProvider(createNodeRedisCacheClient(fixture.node));
    });

    afterEach(async () => fixture?.close());

    it('redis-cache-client/V02 JSON 值跨客户端读取', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const values: readonly unknown[] = [{ status: 'open' }, [1, 'two'], true, 42, null];
        for (const value of values) {
            const ioKey = fixture.key();
            const nodeKey = fixture.key();
            await ioProvider.set(ioKey, value);
            await expect(nodeProvider.get(ioKey)).resolves.toEqual(value);
            await nodeProvider.set(nodeKey, value);
            await expect(ioProvider.get(nodeKey)).resolves.toEqual(value);
        }
    });

    it('redis-cache-client/V05 正整数 TTL 按秒传递', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const ioKey = fixture.key();
        const nodeKey = fixture.key();
        await ioProvider.set(ioKey, 'io', 30);
        await nodeProvider.set(nodeKey, 'node', 30);

        const [ioTtl, nodeTtl] = await Promise.all([fixture.node.ttl(ioKey), fixture.io.ttl(nodeKey)]);
        expect(ioTtl).toBeGreaterThan(20);
        expect(ioTtl).toBeLessThanOrEqual(30);
        expect(nodeTtl).toBeGreaterThan(20);
        expect(nodeTtl).toBeLessThanOrEqual(30);
    });

    it('redis-cache-client/V06 缺省 TTL 与零 TTL 永不过期', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const ioKey = fixture.key();
        const nodeKey = fixture.key();
        await ioProvider.set(ioKey, 'io');
        await nodeProvider.set(nodeKey, 'node', 0);

        await expect(fixture.node.ttl(ioKey)).resolves.toBe(-1);
        await expect(fixture.io.ttl(nodeKey)).resolves.toBe(-1);
    });

    it('redis-cache-client/R03 并发写入不提供额外竞争控制', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const key = fixture.key();
        const ioSet = jest.spyOn(fixture.io, 'set');
        const nodeSet = jest.spyOn(fixture.node, 'set');

        await Promise.all([
            ioProvider.set(key, { writer: 'ioredis' }),
            nodeProvider.set(key, { writer: 'node-redis' }),
        ]);

        expect([{ writer: 'ioredis' }, { writer: 'node-redis' }]).toContainEqual(await ioProvider.get(key));
        expect(ioSet).toHaveBeenCalledTimes(1);
        expect(nodeSet).toHaveBeenCalledTimes(1);
        ioSet.mockRestore();
        nodeSet.mockRestore();
    });

    it('redis-cache-client/E05 真实连接不可用时不创建替代连接', async () => {
        if (!redisUrl) {
            throw new Error('CACHE_DECORATOR_TEST_REDIS_URL is required');
        }
        for (const kind of ['ioredis', 'node-redis'] as const) {
            const unavailable = await createRedisFixture(redisUrl);
            const provider = new RedisCacheProvider(
                kind === 'ioredis'
                    ? createIoredisCacheClient(unavailable.io)
                    : createNodeRedisCacheClient(unavailable.node)
            );
            const ioConnect = jest.spyOn(unavailable.io, 'connect');
            const nodeConnect = jest.spyOn(unavailable.node, 'connect');
            try {
                if (kind === 'ioredis') {
                    const ended = once(unavailable.io, 'end');
                    unavailable.io.disconnect();
                    await ended;
                } else {
                    unavailable.node.destroy();
                }
                const started = Date.now();
                await expect(provider.get(unavailable.key())).rejects.toBeInstanceOf(Error);
                expect(Date.now() - started).toBeLessThan(1500);
                expect(ioConnect).not.toHaveBeenCalled();
                expect(nodeConnect).not.toHaveBeenCalled();
            } finally {
                ioConnect.mockRestore();
                nodeConnect.mockRestore();
                await unavailable.close();
            }
        }
    });

    it('redis-cache-client/I01 ioredis 写入后由 node-redis 读取', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const key = fixture.key();
        await ioProvider.set(key, { source: 'ioredis' }, 30);

        await expect(nodeProvider.get(key)).resolves.toEqual({ source: 'ioredis' });
        expect(await fixture.node.ttl(key)).toBeGreaterThan(20);
    });

    it('redis-cache-client/I02 node-redis 写入后由 ioredis 读取', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const key = fixture.key();
        await nodeProvider.set(key, { source: 'node-redis' }, 30);

        await expect(ioProvider.get(key)).resolves.toEqual({ source: 'node-redis' });
        expect(await fixture.io.ttl(key)).toBeGreaterThan(20);
    });

    it('cache-operation-logging/A03 redis-cache-client/I03 新版本读取旧版本缓存', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const stringKey = fixture.key();
        const objectKey = fixture.key();
        await writeLegacyRedisCache(fixture.io, stringKey, 'legacy-string');
        await writeLegacyRedisCache(fixture.io, objectKey, { legacy: true }, 30);

        await expect(nodeProvider.get(stringKey)).resolves.toBe('legacy-string');
        await expect(ioProvider.get(objectKey)).resolves.toEqual({ legacy: true });
    });

    it('cache-evict-allentries-prefix/RedisCacheProvider 使用 SCAN 迭代删除', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const namespace = createKeyNamespace(fixture);
        const provider = new RedisCacheProvider(
            createNodeRedisCacheClient(fixture.node, { keyPrefix: namespace.keyPrefix })
        );
        const matchingKeys = Array.from({ length: 150 }, (_, index) => `name:${index}`);
        const physicalMatchingKeys = matchingKeys.map((key) => namespace.physicalKey(key));
        const otherKey = namespace.physicalKey('order:1');
        await Promise.all([
            ...physicalMatchingKeys.map((key) => fixture.node.set(key, 'value')),
            fixture.node.set(otherKey, 'other'),
        ]);
        const scan = jest.spyOn(fixture.node, 'scan');

        await provider.deleteByPattern('name*');

        expect(scan).toHaveBeenCalled();
        for (const call of scan.mock.calls) {
            expect(call[1]).toEqual({ MATCH: `${namespace.keyPrefix}name*`, COUNT: 100 });
        }
        expect((await fixture.node.mGet(physicalMatchingKeys)).every((value) => value === null)).toBe(true);
        await expect(fixture.node.get(otherKey)).resolves.toBe('other');
        scan.mockRestore();
    });

    it('cache-evict-allentries-prefix/F05 ioredis keyPrefix 下删除逻辑 pattern', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const namespace = createKeyNamespace(fixture);
        const first = namespace.physicalKey('name:1');
        const second = namespace.physicalKey('name:2');
        const other = namespace.physicalKey('order:1');
        const prefixed = new Redis({ ...fixture.io.options, keyPrefix: namespace.keyPrefix, lazyConnect: true });
        prefixed.on('error', (error: Error) => fixture.errors.push(error));
        try {
            await prefixed.connect();
            await fixture.node.mSet({ [first]: 'one', [second]: 'two', [other]: 'other' });
            const provider = new RedisCacheProvider(createIoredisCacheClient(prefixed));

            await provider.deleteByPattern('name*');

            await expect(fixture.node.mGet([first, second])).resolves.toEqual([null, null]);
            await expect(fixture.node.get(other)).resolves.toBe('other');
        } finally {
            if (prefixed.status !== 'end') {
                const ended = once(prefixed, 'end');
                prefixed.disconnect();
                await ended;
            }
        }
    });

    it('cache-evict-allentries-prefix/F07 node-redis 缺省前缀不改写 key', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const namespace = createKeyNamespace(fixture);
        const first = namespace.physicalKey('name:1');
        const second = namespace.physicalKey('name:2');
        const other = namespace.physicalKey('order:1');
        await fixture.node.mSet({ [first]: 'one', [second]: 'two', [other]: 'other' });

        await nodeProvider.deleteByPattern(`${namespace.keyPrefix}name*`);

        await expect(fixture.node.mGet([first, second])).resolves.toEqual([null, null]);
        await expect(fixture.node.get(other)).resolves.toBe('other');
    });

    it('cache-evict-allentries-prefix/F08 node-redis 显式前缀访问同一命名空间', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const namespace = createKeyNamespace(fixture);
        const physicalKey = namespace.physicalKey('name:1');
        const provider = new RedisCacheProvider(
            createNodeRedisCacheClient(fixture.node, { keyPrefix: namespace.keyPrefix })
        );

        await provider.set('name:1', { prefixed: true });
        await expect(fixture.io.get(physicalKey)).resolves.toBe('{"prefixed":true}');
        await expect(provider.get('name:1')).resolves.toEqual({ prefixed: true });
        await provider.deleteByPattern('name*');
        await expect(fixture.io.get(physicalKey)).resolves.toBeNull();
    });
});

redisTests('Redis 数据库级清理（要求 URL 显式选择非零数据库）', () => {
    let fixture: RedisFixture | undefined;

    beforeEach(async () => {
        if (!redisUrl) {
            throw new Error('CACHE_DECORATOR_TEST_REDIS_URL is required');
        }
        fixture = await createIsolatedDatabaseRedisFixture(redisUrl);
    });

    afterEach(async () => fixture?.close());

    it('redis-cache-client/R04 重复清库保持数据库级语义', async () => {
        if (!fixture) {
            throw new Error('Redis fixture is required');
        }
        const cacheKey = fixture.key();
        const businessKey = fixture.key();
        const provider = new RedisCacheProvider(createNodeRedisCacheClient(fixture.node, { keyPrefix: 'ignored:' }));
        await fixture.node.mSet({ [cacheKey]: 'cache', [businessKey]: 'business' });

        await expect(provider.clear()).resolves.toBeUndefined();
        await expect(provider.clear()).resolves.toBeUndefined();

        await expect(fixture.node.mGet([cacheKey, businessKey])).resolves.toEqual([null, null]);
        await expect(fixture.node.dbSize()).resolves.toBe(0);
    });
});
