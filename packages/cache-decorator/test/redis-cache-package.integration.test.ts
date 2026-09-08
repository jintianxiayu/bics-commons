import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
    createPackageTestRoot,
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
        import { LoggerFactory } from '@jintianxiayu/logger';
        import {
            Cache, CacheProviderRegistry, MemoryCacheProvider, RedisCacheProvider, createIoredisCacheClient,
            createNodeRedisCacheClient, type CacheProvider, type RedisCacheClient,
            type IoredisCacheClientSource, type NodeRedisCacheClientSource, type NodeRedisCacheClientOptions,
        } from '@jintianxiayu/cache-decorator';
        const values = new Map<string, string>();
        const client: RedisCacheClient = {
            get: async (key) => values.get(key) ?? null,
            set: async ({ key, value }) => { values.set(key, value); },
            deleteMany: async (keys) => { for (const key of keys) { values.delete(key); } },
            scan: async () => ({ cursor: '0', keys: [...values.keys()] }),
            flushDatabase: async () => { values.clear(); },
        };
        const custom: CacheProvider = {
            get: async () => undefined, set: async () => undefined, delete: async () => undefined,
            clear: async () => undefined, deleteByPattern: async () => undefined,
        };
        export type Sources = IoredisCacheClientSource | NodeRedisCacheClientSource;
        export type Options = NodeRedisCacheClientOptions;
        async function main(): Promise<void> {
            LoggerFactory.init({
                root: { console: { enabled: false }, file: { enabled: false } },
                processErrors: { uncaughtException: false, unhandledRejection: false, exitOnError: false },
            });
            try {
                assert.equal(typeof createIoredisCacheClient, 'function');
                assert.equal(typeof createNodeRedisCacheClient, 'function');
                const memory = new MemoryCacheProvider();
                await memory.set('memory-key', { source: 'memory' });
                assert.deepEqual(await memory.get('memory-key'), { source: 'memory' });
                CacheProviderRegistry.register('memory', memory);
                let calls = 0;
                class Service {
                    @Cache('external-memory', { providerName: 'memory' })
                    getValue(id: number): { id: number } {
                        calls += 1;
                        return { id };
                    }
                }
                const service = new Service();
                assert.deepEqual(await service.getValue(1), { id: 1 });
                assert.deepEqual(await service.getValue(1), { id: 1 });
                assert.equal(calls, 1);

                const redis = new RedisCacheProvider(client);
                await redis.set('redis-key', { source: 'custom-client' });
                assert.deepEqual(await redis.get('redis-key'), { source: 'custom-client' });
                CacheProviderRegistry.register('custom', custom);
                CacheProviderRegistry.setDefault('custom');
                assert.equal(await CacheProviderRegistry.get().get('key'), undefined);
            } finally {
                CacheProviderRegistry.clear();
                await LoggerFactory.shutdown({ timeout: 2_000 });
            }
        }
        main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
    `,
    redis: `
        import assert from 'node:assert/strict';
        import { randomUUID } from 'node:crypto';
        import { createClient } from 'redis';
        import { RedisCacheProvider, createNodeRedisCacheClient } from '@jintianxiayu/cache-decorator';
        const redis = createClient();
        const provider = new RedisCacheProvider(createNodeRedisCacheClient(redis));
        assert.ok(provider instanceof RedisCacheProvider);
        assert.equal(redis.isOpen, false);
        async function runCache(): Promise<void> {
            const url = process.env.CACHE_DECORATOR_TEST_REDIS_URL;
            assert.ok(url);
            const connection = createClient({
                url, disableOfflineQueue: true, socket: { connectTimeout: 1000, reconnectStrategy: false },
            });
            const errors: Error[] = [];
            connection.on('error', (error: Error) => errors.push(error));
            const key = 'cache-consumer:' + randomUUID();
            try {
                await connection.connect();
                const cache = new RedisCacheProvider(createNodeRedisCacheClient(connection));
                await cache.set(key, { source: 'node-redis' }, 30);
                assert.deepEqual(await cache.get(key), { source: 'node-redis' });
                await cache.delete(key);
                assert.equal(await cache.get(key), undefined);
                assert.equal(await connection.ping(), 'PONG');
                assert.deepEqual(errors, []);
            } finally {
                if (connection.isOpen) {
                    try { await connection.del(key); }
                    finally { connection.destroy(); }
                }
            }
        }
        if (process.argv[2] === 'cache') {
            runCache().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
        }
    `,
    ioredis: `
        import assert from 'node:assert/strict';
        import { randomUUID } from 'node:crypto';
        import Redis from 'ioredis';
        import { RedisCacheProvider, createIoredisCacheClient } from '@jintianxiayu/cache-decorator';
        const redis = new Redis({ lazyConnect: true });
        const provider = new RedisCacheProvider(createIoredisCacheClient(redis));
        assert.ok(provider instanceof RedisCacheProvider);
        assert.equal(redis.status, 'wait');
        async function runCache(): Promise<void> {
            const url = process.env.CACHE_DECORATOR_TEST_REDIS_URL;
            assert.ok(url);
            const connection = new Redis(url, {
                lazyConnect: true, enableOfflineQueue: false, connectTimeout: 1000, commandTimeout: 1000,
                retryStrategy: () => null,
            });
            const errors: Error[] = [];
            connection.on('error', (error: Error) => errors.push(error));
            const key = 'cache-consumer:' + randomUUID();
            try {
                await connection.connect();
                const cache = new RedisCacheProvider(createIoredisCacheClient(connection));
                await cache.set(key, { source: 'ioredis' }, 30);
                assert.deepEqual(await cache.get(key), { source: 'ioredis' });
                await cache.delete(key);
                assert.equal(await cache.get(key), undefined);
                assert.equal(await connection.ping(), 'PONG');
                assert.deepEqual(errors, []);
            } finally {
                try { if (connection.status === 'ready') { await connection.del(key); } }
                finally { connection.disconnect(); }
            }
        }
        if (process.argv[2] === 'cache') {
            runCache().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
        }
    `,
};

let root: string;
let consumers: Record<'none' | 'redis' | 'ioredis', PackageConsumer>;

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
    consumers = {
        none: installConsumer({
            root,
            archive,
            loggerArchive,
            client: 'none',
            source: sources.none,
            readmeSource: readReadmeExample('自定义 RedisCacheClient'),
            quickStartSource: readReadmeExample('快速开始', 2),
        }),
        redis: installConsumer({
            root,
            archive,
            loggerArchive,
            client: 'redis',
            source: sources.redis,
            readmeSource: readReadmeExample('node-redis'),
            quickStartSource: readReadmeExample('快速开始', 2),
        }),
        ioredis: installConsumer({
            root,
            archive,
            loggerArchive,
            client: 'ioredis',
            source: sources.ioredis,
            readmeSource: readReadmeExample('ioredis'),
            quickStartSource: readReadmeExample('快速开始', 2),
        }),
    };
});

it('cache-operation-logging/P01 外部严格消费项目显式提供并共享唯一 Logger peer', () => {
    for (const consumer of Object.values(consumers)) {
        const requireFromConsumer = createRequire(join(consumer.directory, 'package.json'));
        const requireFromCache = createRequire(join(consumer.installedPackage, 'package.json'));
        expect(realpathSync(requireFromCache.resolve('@jintianxiayu/logger'))).toBe(
            realpathSync(requireFromConsumer.resolve('@jintianxiayu/logger'))
        );
        expect(consumer.dependencyTree).toContain('"@jintianxiayu/logger"');
        expect(consumer.dependencyTree).toContain('"reflect-metadata"');
    }
});

it('cache-operation-logging/P02 发布 manifest 将 Logger workspace peer 转为实际 semver', () => {
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

afterAll(() => {
    if (root) {
        removePackageTestRoot(root);
    }
});

it('redis-cache-client/P01 不安装 Redis 客户端也能使用非 Redis Provider', () => {
    const consumer = consumers.none;
    expect(clientResolution(consumer)).toEqual({ ioredis: null, redis: null });
    expect(consumer.dependencyTree).not.toContain('"ioredis":');
    expect(consumer.dependencyTree).not.toContain('"redis":');
});

it('redis-cache-client/P02 仅安装 node-redis 的消费项目', () => {
    const consumer = consumers.redis;
    const resolution = clientResolution(consumer);
    expect(resolution.redis?.startsWith(consumer.directory)).toBe(true);
    expect(resolution.ioredis).toBeNull();
    expect(consumer.dependencyTree).toContain('"redis":');
    expect(consumer.dependencyTree).not.toContain('"ioredis":');
});

it('redis-cache-client/P03 仅安装 ioredis 的消费项目', () => {
    const consumer = consumers.ioredis;
    const resolution = clientResolution(consumer);
    expect(resolution.ioredis?.startsWith(consumer.directory)).toBe(true);
    expect(resolution.redis).toBeNull();
    expect(consumer.dependencyTree).toContain('"ioredis":');
    expect(consumer.dependencyTree).not.toContain('"redis":');
});

const redisTest = process.env.CACHE_DECORATOR_TEST_REDIS_URL ? it : it.skip;

redisTest('redis-cache-client/P02 仅 node-redis 的消费项目执行真实缓存操作', () => {
    const consumer = consumers.redis;
    expect(
        runCommand({
            executable: process.execPath,
            args: [join(consumer.directory, 'out/consumer.js'), 'cache'],
            cwd: consumer.directory,
        })
    ).toBe('');
});

redisTest('redis-cache-client/P03 仅 ioredis 的消费项目执行真实缓存操作', () => {
    const consumer = consumers.ioredis;
    expect(
        runCommand({
            executable: process.execPath,
            args: [join(consumer.directory, 'out/consumer.js'), 'cache'],
            cwd: consumer.directory,
        })
    ).toBe('');
});

it('redis-cache-client/P04 公共入口与声明不泄漏第三方客户端', () => {
    const consumer = consumers.none;
    const requireFromConsumer = createRequire(join(consumer.directory, 'package.json'));
    const api: Record<string, unknown> = requireFromConsumer('@jintianxiayu/cache-decorator');
    expect(Object.keys(api).sort()).toEqual(
        [
            'Cache',
            'CacheEvict',
            'CacheProviderRegistry',
            'KeyBuilder',
            'MemoryCacheProvider',
            'PendingCache',
            'RedisCacheProvider',
            'createIoredisCacheClient',
            'createNodeRedisCacheClient',
        ].sort()
    );
    const manifest = JSON.parse(readFileSync(join(consumer.installedPackage, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        expect(manifest[field]?.ioredis).toBeUndefined();
        expect(manifest[field]?.redis).toBeUndefined();
    }
    const dist = join(consumer.installedPackage, 'dist');
    const externalClient = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"](?:ioredis|redis)(?:\/|['"])/;
    for (const entry of readdirSync(dist, { recursive: true })) {
        const name = String(entry);
        if (name.endsWith('.js') || name.endsWith('.d.ts')) {
            expect(readFileSync(join(dist, name), 'utf8')).not.toMatch(externalClient);
        }
    }
});
