import { createRedisFixture, RedisFixture } from './helpers/redis-fixture';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { validate, version } from 'uuid';
import { createIoredisLockClient } from '../src/adapters/ioredis-lock-client';
import { createNodeRedisLockClient } from '../src/adapters/node-redis-lock-client';
import { RedisLockProvider } from '../src/core/redis-lock-provider';
import Redis from 'ioredis';
import { LegacyRedisLockProvider } from './helpers/legacy-redis-lock-provider';

const redisUrl = process.env.LOCK_DECORATOR_TEST_REDIS_URL;
const redisTests = redisUrl ? describe : describe.skip;

redisTests('真实 Redis（需 LOCK_DECORATOR_TEST_REDIS_URL）', () => {
    let fixture: RedisFixture;

    beforeEach(async () => {
        if (!redisUrl) {
            throw new Error('LOCK_DECORATOR_TEST_REDIS_URL is required');
        }
        fixture = await createRedisFixture(redisUrl);
    });

    afterEach(async () => fixture?.close());

    it('双客户端连接及夹具清理只影响自有 key', async () => {
        if (!redisUrl) {
            throw new Error('LOCK_DECORATOR_TEST_REDIS_URL is required');
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

redisTests('Redis 客户端与版本互操作', () => {
    let fixture: RedisFixture;
    let ioProvider: RedisLockProvider;
    let nodeProvider: RedisLockProvider;

    beforeEach(async () => {
        assert.ok(redisUrl);
        fixture = await createRedisFixture(redisUrl);
        ioProvider = new RedisLockProvider(createIoredisLockClient(fixture.io));
        nodeProvider = new RedisLockProvider(createNodeRedisLockClient(fixture.node));
    });

    afterEach(async () => fixture?.close());

    it('redis-lock-client/I01 不同客户端并发竞争同一把锁', async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
            const key = fixture.key();
            const tokens = await Promise.all([ioProvider.acquire(key, 5000), nodeProvider.acquire(key, 5000)]);
            const winners = tokens.filter((token) => token !== null);
            expect(winners).toHaveLength(1);
            await expect(fixture.node.get(key)).resolves.toBe(winners[0]);
            const loser = tokens[0] === null ? ioProvider : nodeProvider;
            await expect(loser.release(key, 'not-the-owner')).resolves.toBe(false);
            await expect(fixture.node.get(key)).resolves.toBe(winners[0]);
        }
    });

    it.each(['ioredis', 'node-redis'])('redis-lock-client/I02 新旧协议双向互斥：%s', async (kind) => {
        const oldProvider = new LegacyRedisLockProvider(fixture.io);
        const newProvider = kind === 'ioredis' ? ioProvider : nodeProvider;
        const key = fixture.key();
        const oldToken = await oldProvider.acquire(key, 5000);
        assert.ok(oldToken);
        await expect(newProvider.acquire(key, 5000)).resolves.toBeNull();
        await expect(newProvider.renew(key, oldToken, 8000)).resolves.toBe(true);
        await expect(oldProvider.release(key, oldToken)).resolves.toBe(true);
        const newToken = await newProvider.acquire(key, 5000);
        assert.ok(newToken);
        await expect(oldProvider.acquire(key, 5000)).resolves.toBeNull();
        await expect(oldProvider.renew(key, newToken, 8000)).resolves.toBe(true);
        await expect(newProvider.release(key, newToken)).resolves.toBe(true);
        await expect(fixture.node.exists(key)).resolves.toBe(0);
    });

    it('redis-lock-client/I03 前缀配置对应同一有效 key', async () => {
        const key = fixture.key();
        const prefix = 'lock-decorator-test:';
        const bareKey = key.slice(prefix.length);
        const prefixed = new Redis({ ...fixture.io.options, keyPrefix: prefix, lazyConnect: true });
        prefixed.on('error', (error: Error) => fixture.errors.push(error));
        try {
            await prefixed.connect();
            const provider = new RedisLockProvider(createIoredisLockClient(prefixed));
            const token = await provider.acquire(bareKey, 5000);
            assert.ok(token);
            await expect(nodeProvider.acquire(key, 5000)).resolves.toBeNull();
            await expect(fixture.node.get(key)).resolves.toBe(token);
            await expect(provider.renew(bareKey, token, 8000)).resolves.toBe(true);
            await expect(provider.release(bareKey, token)).resolves.toBe(true);
            const nextToken = await nodeProvider.acquire(key, 5000);
            assert.ok(nextToken);
            await expect(provider.acquire(bareKey, 5000)).resolves.toBeNull();
            await expect(provider.release(bareKey, nextToken)).resolves.toBe(true);
            await expect(fixture.node.exists(key)).resolves.toBe(0);
        } finally {
            const ended = once(prefixed, 'end');
            prefixed.disconnect();
            await ended;
        }
    });

    it.each(['ioredis', 'node-redis'])('redis-lock-client/O02 多个 Provider 共享连接：%s', async (kind) => {
        const client =
            kind === 'ioredis' ? createIoredisLockClient(fixture.io) : createNodeRedisLockClient(fixture.node);
        const first = new RedisLockProvider(client);
        const second = new RedisLockProvider(client);
        const key = fixture.key();
        const token = await first.acquire(key, 5000);
        assert.ok(token);
        await expect(second.acquire(key, 5000)).resolves.toBeNull();
        await expect(second.renew(key, token, 8000)).resolves.toBe(true);
        await expect(first.release(key, token)).resolves.toBe(true);
        await expect(first.acquire(fixture.key(), 0)).rejects.toBeInstanceOf(Error);
        await expect(fixture.io.ping()).resolves.toBe('PONG');
        await expect(fixture.node.ping()).resolves.toBe('PONG');
    });
});

redisTests.each(['ioredis', 'node-redis'])('%s 真实锁协议', (kind) => {
    let fixture: RedisFixture;
    let provider: RedisLockProvider;
    let key: string;

    beforeEach(async () => {
        assert.ok(redisUrl);
        fixture = await createRedisFixture(redisUrl);
        key = fixture.key();
        provider = new RedisLockProvider(
            kind === 'ioredis' ? createIoredisLockClient(fixture.io) : createNodeRedisLockClient(fixture.node)
        );
    });

    afterEach(async () => fixture?.close());

    it('redis-lock-client/L01 获取成功写入 token 和过期时间', async () => {
        const token = await provider.acquire(key, 5000);
        assert.ok(token);
        expect(validate(token)).toBe(true);
        expect(version(token)).toBe(4);
        await expect(fixture.node.get(key)).resolves.toBe(token);
        const ttl = await fixture.node.pTTL(key);
        expect(ttl).toBeGreaterThan(4000);
        expect(ttl).toBeLessThanOrEqual(5000);
    });

    it('redis-lock-client/L02 重复获取不修改持有者和有效期', async () => {
        const token = await provider.acquire(key, 5000);
        assert.ok(token);
        const before = await fixture.node.pTTL(key);
        await expect(provider.acquire(key, 30000)).resolves.toBeNull();
        await expect(fixture.node.get(key)).resolves.toBe(token);
        const after = await fixture.node.pTTL(key);
        expect(after).toBeGreaterThan(before - 1000);
        expect(after).toBeLessThanOrEqual(before);
    });

    it('redis-lock-client/L03 正确 token 释放及重复释放', async () => {
        const token = await provider.acquire(key, 5000);
        assert.ok(token);
        await expect(provider.release(key, token)).resolves.toBe(true);
        await expect(fixture.node.exists(key)).resolves.toBe(0);
        await expect(provider.release(key, token)).resolves.toBe(false);
    });

    it('redis-lock-client/L04 错误 token 不能释放锁', async () => {
        const token = await provider.acquire(key, 5000);
        assert.ok(token);
        const before = await fixture.node.pTTL(key);
        await expect(provider.release(key, 'wrong')).resolves.toBe(false);
        await expect(fixture.node.get(key)).resolves.toBe(token);
        const after = await fixture.node.pTTL(key);
        expect(after).toBeGreaterThan(before - 1000);
        expect(after).toBeLessThanOrEqual(before);
    });

    it('redis-lock-client/L05 正确 token 可以续期', async () => {
        const token = await provider.acquire(key, 5000);
        assert.ok(token);
        await expect(provider.renew(key, token, 20000)).resolves.toBe(true);
        await expect(fixture.node.get(key)).resolves.toBe(token);
        const ttl = await fixture.node.pTTL(key);
        expect(ttl).toBeGreaterThan(19000);
        expect(ttl).toBeLessThanOrEqual(20000);
    });

    it('redis-lock-client/L06 错误 token 不能续期', async () => {
        const token = await provider.acquire(key, 5000);
        assert.ok(token);
        const before = await fixture.node.pTTL(key);
        await expect(provider.renew(key, 'wrong', 20000)).resolves.toBe(false);
        await expect(fixture.node.get(key)).resolves.toBe(token);
        const after = await fixture.node.pTTL(key);
        expect(after).toBeGreaterThan(before - 1000);
        expect(after).toBeLessThanOrEqual(before);
    });

    it('redis-lock-client/L07 不存在的锁不能释放或续期', async () => {
        await expect(provider.release(key, 'missing')).resolves.toBe(false);
        await expect(provider.renew(key, 'missing', 5000)).resolves.toBe(false);
        await expect(fixture.node.exists(key)).resolves.toBe(0);
    });

    it('redis-lock-client/L08 过期重获后旧 token 失效', async () => {
        const oldToken = await provider.acquire(key, 60);
        assert.ok(oldToken);
        await delay(100);
        await expect(fixture.node.exists(key)).resolves.toBe(0);
        const newToken = await provider.acquire(key, 5000);
        assert.ok(newToken);
        expect(newToken).not.toBe(oldToken);
        const before = await fixture.node.pTTL(key);
        await expect(provider.release(key, oldToken)).resolves.toBe(false);
        await expect(provider.renew(key, oldToken, 20000)).resolves.toBe(false);
        await expect(fixture.node.get(key)).resolves.toBe(newToken);
        const after = await fixture.node.pTTL(key);
        expect(after).toBeGreaterThan(before - 1000);
        expect(after).toBeLessThanOrEqual(before);
    });

    it.each([0, -1, 1.5, NaN])('redis-lock-client/E04 非法加锁 TTL 不被修复或吞掉：%s', async (ttl) => {
        await expect(provider.acquire(key, ttl)).rejects.toBeInstanceOf(Error);
        await expect(fixture.node.exists(key)).resolves.toBe(0);
    });

    it('redis-lock-client/E05 真实连接不可用时无降级成功', async () => {
        const ioConnect = jest.spyOn(fixture.io, 'connect');
        const nodeConnect = jest.spyOn(fixture.node, 'connect');
        if (kind === 'ioredis') {
            const ended = once(fixture.io, 'end');
            fixture.io.disconnect();
            await ended;
        } else {
            fixture.node.destroy();
        }
        const started = Date.now();
        await expect(provider.acquire(key, 1000)).rejects.toBeInstanceOf(Error);
        expect(Date.now() - started).toBeLessThan(1500);
        expect(ioConnect).not.toHaveBeenCalled();
        expect(nodeConnect).not.toHaveBeenCalled();
        ioConnect.mockRestore();
        nodeConnect.mockRestore();
    });
});
