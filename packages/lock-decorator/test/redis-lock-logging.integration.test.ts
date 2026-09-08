jest.mock('@jintianxiayu/logger', () => ({
    LoggerFactory: { getLogger: jest.fn() },
}));

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { LoggerFactory, type LoggerInterface } from '@jintianxiayu/logger';
import { createIoredisLockClient } from '../src/adapters/ioredis-lock-client';
import { createNodeRedisLockClient } from '../src/adapters/node-redis-lock-client';
import { LockProviderRegistry } from '../src/core/lock-provider-registry';
import { RedisLockProvider } from '../src/core/redis-lock-provider';
import { DistributedLock } from '../src/decorators/distributed-lock';
import { LockAcquisitionError } from '../src/errors/lock-acquisition-error';
import { createRedisFixture, type RedisFixture } from './helpers/redis-fixture';

const redisUrl = process.env.LOCK_DECORATOR_TEST_REDIS_URL;
const redisTests = redisUrl ? describe : describe.skip;
const logger: jest.Mocked<LoggerInterface> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
const getLogger = jest.mocked(LoggerFactory.getLogger);

function eventsFor(level: 'debug' | 'warn' | 'error'): string[] {
    return logger[level].mock.calls.map((call) => String((call[1] as { readonly event?: string }).event));
}

redisTests.each(['ioredis', 'node-redis'] as const)('%s 真实 Redis 锁日志', (kind) => {
    let fixture: RedisFixture;
    let provider: RedisLockProvider;

    beforeEach(async () => {
        assert.ok(redisUrl);
        fixture = await createRedisFixture(redisUrl);
        provider = new RedisLockProvider(
            kind === 'ioredis' ? createIoredisLockClient(fixture.io) : createNodeRedisLockClient(fixture.node)
        );
        LockProviderRegistry.register('real-redis', provider);
        LockProviderRegistry.setDefault('real-redis');
        getLogger.mockReturnValue(logger);
        logger.debug.mockReset();
        logger.info.mockReset();
        logger.warn.mockReset();
        logger.error.mockReset();
    });

    afterEach(async () => {
        LockProviderRegistry.clear();
        await fixture?.close();
    });

    it('lock-operation-logging/真实 Redis 成功锁流程', async () => {
        const key = fixture.key();
        class Service {
            @DistributedLock({ key, ttl: 5000, renewInterval: 5000 })
            async run(): Promise<string> {
                return kind;
            }
        }

        await expect(new Service().run()).resolves.toBe(kind);

        expect(eventsFor('debug')).toEqual([
            'lock.acquire_started',
            'lock.acquired',
            'lock.watchdog_skipped',
            'lock.execution_started',
            'lock.execution_completed',
            'lock.release_started',
            'lock.released',
        ]);
        await expect(fixture.node.exists(key)).resolves.toBe(0);
    });

    it('lock-operation-logging/真实 Redis 同 key 竞争', async () => {
        const key = fixture.key();
        const holderToken = await provider.acquire(key, 5000);
        assert.ok(holderToken);
        class Service {
            @DistributedLock({ key, ttl: 5000, renewInterval: 5000 })
            async run(): Promise<string> {
                return 'unsafe';
            }
        }

        await expect(new Service().run()).rejects.toBeInstanceOf(LockAcquisitionError);

        expect(eventsFor('warn')).toContain('lock.acquire_exhausted');
        await expect(fixture.node.get(key)).resolves.toBe(holderToken);
        await expect(provider.release(key, holderToken)).resolves.toBe(true);
    });

    it('lock-operation-logging/真实 Redis TTL 后 ownership_lost', async () => {
        const key = fixture.key();
        class Service {
            @DistributedLock({ key, ttl: 50, renewInterval: 50 })
            async run(): Promise<string> {
                await delay(150);
                return 'completed-after-expiry';
            }
        }

        await expect(new Service().run()).resolves.toBe('completed-after-expiry');

        expect(logger.warn).toHaveBeenCalledWith(
            'Distributed lock ownership lost',
            expect.objectContaining({ event: 'lock.ownership_lost', phase: 'release' })
        );
    });

    it('lock-operation-logging/真实 Redis 连接或命令异常日志', async () => {
        if (kind === 'ioredis') {
            const ended = once(fixture.io, 'end');
            fixture.io.disconnect();
            await ended;
        } else {
            fixture.node.destroy();
        }
        class Service {
            @DistributedLock({ key: fixture.key(), ttl: 1000 })
            async run(): Promise<string> {
                return 'unsafe';
            }
        }

        await expect(new Service().run()).rejects.toBeInstanceOf(Error);

        expect(logger.error).toHaveBeenCalledWith(
            'Distributed lock operation failed',
            expect.objectContaining({ event: 'lock.operation_failed', operation: 'acquire', error: expect.any(Error) })
        );
    });
});
