import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
    createPackageTestRoot,
    installWithoutLogger,
    installConsumer,
    PackageConsumer,
    packCurrentPackage,
    packLoggerPackage,
    packageRoot,
    readReadmeExample,
    removePackageTestRoot,
    runCommand,
} from './helpers/package-consumer';

jest.setTimeout(180000);

const sources = {
    none: `
        import assert from 'node:assert/strict';
        import { RedisLockProvider, LockProviderRegistry, DistributedLock, Watchdog, DEFAULT_TTL,
            DEFAULT_RENEW_INTERVAL, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_DELAY, createIoredisLockClient,
            createNodeRedisLockClient, type RedisLockClient, type LockProvider, type DistributedLockOptions,
            type IoredisLockClientSource, type NodeRedisLockClientSource } from '@jintianxiayu/lock-decorator';
        const client: RedisLockClient = { setIfAbsent: async () => true, eval: async () => 1 };
        const custom: LockProvider = { acquire: async () => 'custom-token', release: async () => true, renew: async () => true };
        export type Sources = IoredisLockClientSource | NodeRedisLockClientSource;
        async function main(): Promise<void> {
            assert.equal(typeof createIoredisLockClient, 'function');
            assert.equal(typeof createNodeRedisLockClient, 'function');
            assert.equal(typeof DistributedLock, 'function');
            assert.equal(DEFAULT_TTL, 30000);
            assert.equal(DEFAULT_RENEW_INTERVAL, 10000);
            assert.equal(DEFAULT_RETRY_COUNT, 0);
            assert.equal(DEFAULT_RETRY_DELAY, 100);
            const options: DistributedLockOptions = { key: null, ttl: DEFAULT_TTL, retryCount: 0 };
            assert.equal(options.key, null);
            const provider = new RedisLockProvider(client);
            const token = await provider.acquire('custom-key', 1000);
            assert.ok(token);
            assert.equal(await provider.renew('custom-key', token, 2000), true);
            assert.equal(await provider.release('custom-key', token), true);
            LockProviderRegistry.register('custom', custom);
            LockProviderRegistry.setDefault('custom');
            assert.equal(await LockProviderRegistry.get().acquire('key', 1000), 'custom-token');
            const watchdog = new Watchdog({ provider: custom, key: 'key', token: 'token', ttl: 1000, interval: 500 });
            watchdog.start();
            watchdog.stop();
            LockProviderRegistry.clear();
        }
        main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
    `,
    redis: `
        import assert from 'node:assert/strict';
        import { randomUUID } from 'node:crypto';
        import { createClient } from 'redis';
        import { RedisLockProvider, createNodeRedisLockClient } from '@jintianxiayu/lock-decorator';
        const redis = createClient();
        const provider = new RedisLockProvider(createNodeRedisLockClient(redis));
        assert.ok(provider instanceof RedisLockProvider);
        assert.equal(redis.isOpen, false);
        async function runLock(): Promise<void> {
            const url = process.env.LOCK_DECORATOR_TEST_REDIS_URL;
            assert.ok(url);
            const connection = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 1000, reconnectStrategy: false } });
            const errors: Error[] = [];
            connection.on('error', (error: Error) => errors.push(error));
            const key = 'lock-consumer:' + randomUUID();
            try {
                await connection.connect();
                const lock = new RedisLockProvider(createNodeRedisLockClient(connection));
                const token = await lock.acquire(key, 5000);
                assert.ok(token);
                assert.equal(await lock.renew(key, token, 10000), true);
                assert.equal(await lock.release(key, token), true);
                assert.equal(await connection.ping(), 'PONG');
                assert.deepEqual(errors, []);
            } finally {
                if (connection.isOpen) {
                    try { await connection.del(key); }
                    finally { connection.destroy(); }
                }
            }
        }
        if (process.argv[2] === 'lock') {
            runLock().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
        }
    `,
    ioredis: `
        import assert from 'node:assert/strict';
        import { randomUUID } from 'node:crypto';
        import Redis from 'ioredis';
        import { RedisLockProvider, createIoredisLockClient } from '@jintianxiayu/lock-decorator';
        const redis = new Redis({ lazyConnect: true });
        const provider = new RedisLockProvider(createIoredisLockClient(redis));
        assert.ok(provider instanceof RedisLockProvider);
        assert.equal(redis.status, 'wait');
        async function runLock(): Promise<void> {
            const url = process.env.LOCK_DECORATOR_TEST_REDIS_URL;
            assert.ok(url);
            const connection = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, connectTimeout: 1000, commandTimeout: 1000, retryStrategy: () => null });
            const errors: Error[] = [];
            connection.on('error', (error: Error) => errors.push(error));
            const key = 'lock-consumer:' + randomUUID();
            try {
                await connection.connect();
                const lock = new RedisLockProvider(createIoredisLockClient(connection));
                const token = await lock.acquire(key, 5000);
                assert.ok(token);
                assert.equal(await lock.renew(key, token, 10000), true);
                assert.equal(await lock.release(key, token), true);
                assert.equal(await connection.ping(), 'PONG');
                assert.deepEqual(errors, []);
            } finally {
                try { if (connection.status === 'ready') { await connection.del(key); } }
                finally { connection.disconnect(); }
            }
        }
        if (process.argv[2] === 'lock') {
            runLock().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
        }
    `,
};

let root: string;
let consumers: Record<'none' | 'redis' | 'ioredis', PackageConsumer>;
let missingPeerOutput: string;

/** 在干净 Node 子进程内检查依赖解析，避免 Jest 启动脚本的 NODE_PATH 干扰。 */
function clientResolution(consumer: PackageConsumer): Record<string, string | null> {
    return JSON.parse(
        runCommand({
            executable: process.execPath,
            cwd: consumer.directory,
            args: [
                '-e',
                `
            const results = {};
            for (const name of ['redis', 'ioredis']) {
                try { results[name] = require.resolve(name); }
                catch (error) {
                    if (error.code !== 'MODULE_NOT_FOUND') { throw error; }
                    results[name] = null;
                }
            }
            process.stdout.write(JSON.stringify(results));
        `,
            ],
        })
    );
}

beforeAll(() => {
    root = createPackageTestRoot();
    const archive = packCurrentPackage(root);
    const loggerArchive = packLoggerPackage(root);
    const loggerSource = readReadmeExample('Logger 初始化');
    missingPeerOutput = installWithoutLogger(root, archive);
    consumers = {
        none: installConsumer({
            root,
            archive,
            loggerArchive,
            client: 'none',
            source: sources.none,
            readmeSource: readReadmeExample('自定义 Redis 客户端'),
            loggerSource,
        }),
        redis: installConsumer({
            root,
            archive,
            loggerArchive,
            client: 'redis',
            source: sources.redis,
            readmeSource: readReadmeExample('node-redis'),
            loggerSource,
        }),
        ioredis: installConsumer({
            root,
            archive,
            loggerArchive,
            client: 'ioredis',
            source: sources.ioredis,
            readmeSource: readReadmeExample('ioredis'),
            loggerSource,
        }),
    };
});

it('lock-operation-logging/外部消费项目安装两个包', () => {
    for (const consumer of Object.values(consumers)) {
        const requireFromConsumer = createRequire(join(consumer.directory, 'package.json'));
        const requireFromLock = createRequire(join(consumer.installedPackage, 'package.json'));
        expect(realpathSync(requireFromLock.resolve('@jintianxiayu/logger'))).toBe(
            realpathSync(requireFromConsumer.resolve('@jintianxiayu/logger'))
        );
        expect(consumer.dependencyTree).toContain('"@jintianxiayu/logger"');
    }
});

it('lock-operation-logging/检查发布 manifest', () => {
    const manifest = JSON.parse(readFileSync(join(consumers.none.installedPackage, 'package.json'), 'utf8')) as {
        readonly dependencies?: Record<string, string>;
        readonly peerDependencies?: Record<string, string>;
    };
    const loggerManifest = JSON.parse(readFileSync(join(packageRoot, '../logger/package.json'), 'utf8')) as {
        readonly version: string;
    };
    expect(manifest.peerDependencies?.['@jintianxiayu/logger']).toBe(`^${loggerManifest.version}`);
    expect(manifest.peerDependencies?.['@jintianxiayu/logger']).not.toContain('workspace:');
    expect(manifest.dependencies?.['@jintianxiayu/logger']).toBeUndefined();
});

it('lock-operation-logging/缺少必需 peer', () => {
    expect(missingPeerOutput).toContain('@jintianxiayu/logger');
    expect(missingPeerOutput).toMatch(/missing peer/i);
});

afterAll(() => {
    if (root) {
        removePackageTestRoot(root);
    }
});

it('redis-lock-client/P01 不安装客户端也能使用自定义提供者', () => {
    const consumer = consumers.none;
    expect(clientResolution(consumer)).toEqual({ ioredis: null, redis: null });
    expect(consumer.dependencyTree).not.toContain('"ioredis":');
    expect(consumer.dependencyTree).not.toContain('"redis":');
});

it('redis-lock-client/P02 仅安装 node-redis 的消费项目', () => {
    const consumer = consumers.redis;
    const resolution = clientResolution(consumer);
    expect(resolution.redis?.startsWith(consumer.directory)).toBe(true);
    expect(resolution.ioredis).toBeNull();
    expect(consumer.dependencyTree).toContain('"redis":');
    expect(consumer.dependencyTree).not.toContain('"ioredis":');
});

it('redis-lock-client/P03 仅安装 ioredis 的消费项目', () => {
    const consumer = consumers.ioredis;
    const resolution = clientResolution(consumer);
    expect(resolution.ioredis?.startsWith(consumer.directory)).toBe(true);
    expect(resolution.redis).toBeNull();
    expect(consumer.dependencyTree).toContain('"ioredis":');
    expect(consumer.dependencyTree).not.toContain('"redis":');
});

const redisTest = process.env.LOCK_DECORATOR_TEST_REDIS_URL ? it : it.skip;

redisTest('redis-lock-client/P02 仅 node-redis 的消费项目执行真实锁操作', () => {
    const consumer = consumers.redis;
    expect(
        runCommand({
            executable: process.execPath,
            args: [join(consumer.directory, 'out/consumer.js'), 'lock'],
            cwd: consumer.directory,
        })
    ).toBe('');
});

redisTest('redis-lock-client/P03 仅 ioredis 的消费项目执行真实锁操作', () => {
    const consumer = consumers.ioredis;
    expect(
        runCommand({
            executable: process.execPath,
            args: [join(consumer.directory, 'out/consumer.js'), 'lock'],
            cwd: consumer.directory,
        })
    ).toBe('');
});

it('redis-lock-client/P04 公共入口与声明不泄漏第三方客户端', () => {
    const consumer = consumers.none;
    const requireFromConsumer = createRequire(join(consumer.directory, 'package.json'));
    const api: Record<string, unknown> = requireFromConsumer('@jintianxiayu/lock-decorator');
    expect(Object.keys(api).sort()).toEqual(
        [
            'DistributedLock',
            'LockProviderRegistry',
            'RedisLockProvider',
            'LockAcquisitionError',
            'Watchdog',
            'DEFAULT_TTL',
            'DEFAULT_RENEW_INTERVAL',
            'DEFAULT_RETRY_COUNT',
            'DEFAULT_RETRY_DELAY',
            'createIoredisLockClient',
            'createNodeRedisLockClient',
        ].sort()
    );
    const manifest = JSON.parse(readFileSync(join(consumer.installedPackage, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        expect(manifest[field]?.ioredis).toBeUndefined();
        expect(manifest[field]?.redis).toBeUndefined();
    }
    const dist = join(consumer.installedPackage, 'dist');
    // 只匹配第三方包的 import/from/require，不将本包内的适配器文件名误认为依赖。
    const externalClient = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"](?:ioredis|redis)(?:\/|['"])/;
    for (const entry of readdirSync(dist, { recursive: true })) {
        const name = String(entry);
        if (name.endsWith('.js') || name.endsWith('.d.ts')) {
            expect(readFileSync(join(dist, name), 'utf8')).not.toMatch(externalClient);
        }
    }
});
