import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { createClient } from 'redis';

/** 由测试持有的真实 Redis 连接与专属 key 清理范围。 */
export interface RedisFixture {
    io: Redis;
    node: ReturnType<typeof createClient>;
    errors: Error[];
    /** 分配本夹具拥有的 key，供结束时精确清理。 */
    key(): string;
    /** 清理本夹具的 key 并关闭测试创建的连接。 */
    close(): Promise<void>;
}

/**
 * 为真实协议测试创建两个客户端，不借用业务连接或全库清理。
 * 先完成连接，再交给测试调用；连接失败时回收两端。
 * key 集合仅记录此夹具分配的 Redis 键，清理不执行 FLUSHDB。
 * @param url 显式配置的专用测试 Redis 地址。
 * @returns 双客户端、错误记录和按所有权清理的夹具。
 * @throws 连接和清理命令错误。
 */
export async function createRedisFixture(url: string): Promise<RedisFixture> {
    const errors: Error[] = [];
    const keys = new Set<string>();
    let closed = false;
    const io = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: 1000,
        commandTimeout: 1000,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
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
        errors,
        /** 为当前用例分配不会与其他夹具冲突的 key。 */
        key(): string {
            const key = `lock-decorator-test:${randomUUID()}`;
            keys.add(key);
            return key;
        },
        /** 先清理专属 key，再无条件回收测试连接。 */
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
