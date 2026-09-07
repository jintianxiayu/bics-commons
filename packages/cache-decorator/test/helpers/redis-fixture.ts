import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { createClient } from 'redis';

/** 由测试持有的两种真实 Redis 连接及其精确清理范围。 */
export interface RedisFixture {
    readonly io: Redis;
    readonly node: ReturnType<typeof createClient>;
    readonly database: number;
    readonly errors: Error[];

    /**
     * 分配只属于本夹具的唯一物理 key。
     * @returns 已登记且可由 close 精确清理的 key。
     */
    key(): string;

    /**
     * 登记由本夹具唯一 key 派生的物理 key，供 close 精确清理。
     * @param key 必须位于 cache-decorator-test 测试命名空间内的物理 key。
     * @returns 原 key，便于测试在构造数据时直接使用。
     * @throws key 不属于测试命名空间时拒绝，避免误删外部数据。
     */
    track(key: string): string;

    /**
     * 清理本夹具登记的 key，并关闭本夹具创建的两个连接。
     * @returns 清理与关闭完成后结束；重复调用保持幂等。
     * @throws Redis 清理命令失败时传播原始错误，但仍回收连接。
     */
    close(): Promise<void>;
}

function selectedDatabase(url: string): number {
    const pathname = new URL(url).pathname;
    if (pathname === '' || pathname === '/') {
        return 0;
    }
    const databaseText = pathname.slice(1);
    const database = Number(databaseText);
    if (!Number.isSafeInteger(database) || database < 0 || String(database) !== databaseText) {
        throw new Error('CACHE_DECORATOR_TEST_REDIS_URL must select a valid Redis database number');
    }
    return database;
}

async function createFixture(url: string, database: number): Promise<RedisFixture> {
    const errors: Error[] = [];
    const keys = new Set<string>();
    let closed = false;
    const io = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: 1000,
        commandTimeout: 1000,
        maxRetriesPerRequest: 0,
        retryStrategy: (): null => null,
    });
    const node = createClient({
        url,
        disableOfflineQueue: true,
        socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    io.on('error', (error: Error) => errors.push(error));
    node.on('error', (error: Error) => errors.push(error));
    try {
        await Promise.all([io.connect(), node.connect()]);
    } catch (error) {
        io.disconnect();
        if (node.isOpen) {
            node.destroy();
        }
        throw error;
    }
    return {
        io,
        node,
        database,
        errors,
        /** @inheritdoc */
        key(): string {
            const key = `cache-decorator-test:${randomUUID()}`;
            keys.add(key);
            return key;
        },
        /** @inheritdoc */
        track(key: string): string {
            if (!key.startsWith('cache-decorator-test:')) {
                throw new Error('Redis fixture can only track cache-decorator-test keys');
            }
            keys.add(key);
            return key;
        },
        /** @inheritdoc */
        async close(): Promise<void> {
            if (closed) {
                return;
            }
            closed = true;
            try {
                if (keys.size > 0 && node.isReady) {
                    await node.del([...keys]);
                } else if (keys.size > 0 && io.status === 'ready') {
                    await io.del(...keys);
                }
            } finally {
                if (io.status !== 'end') {
                    io.disconnect();
                }
                if (node.isOpen) {
                    node.destroy();
                }
            }
        },
    };
}

/**
 * 从显式测试 URL 创建两个真实客户端，不回退到默认地址或业务连接。
 * @param url `CACHE_DECORATOR_TEST_REDIS_URL` 提供的专用 Redis 地址。
 * @returns 已完成连接且由测试负责 close 的双客户端夹具。
 * @throws URL、连接或后续清理失败时传播错误。
 */
export async function createRedisFixture(url: string): Promise<RedisFixture> {
    return createFixture(url, selectedDatabase(url));
}

/**
 * 为会执行 FLUSHDB 的场景创建显式非零数据库夹具。
 * @param url `CACHE_DECORATOR_TEST_REDIS_URL` 提供且路径包含非零数据库号的地址。
 * @returns 已连接到明确隔离数据库的双客户端夹具。
 * @throws URL 未显式选择非零数据库时拒绝，避免清理共享或默认数据库。
 */
export async function createIsolatedDatabaseRedisFixture(url: string): Promise<RedisFixture> {
    const database = selectedDatabase(url);
    if (database === 0) {
        throw new Error(
            'Database-level cache tests require CACHE_DECORATOR_TEST_REDIS_URL to select a non-zero database'
        );
    }
    return createFixture(url, database);
}
