import { IoredisLockClientSource, RedisLockClient } from '../core/redis-lock-client';

/**
 * 将调用方的 ioredis 连接适配为 Redis 锁操作，不创建或关闭连接。
 * @param client 使用默认响应映射的 ioredis 客户端。
 * @returns 复用该连接的原子操作对象。
 * @throws 返回对象的命令方法传播客户端错误；非标准 SET 响应拒绝为 TypeError。
 */
export function createIoredisLockClient(client: IoredisLockClientSource): RedisLockClient {
    return {
        /** @inheritdoc */
        async setIfAbsent({ key, value, ttlMs }): Promise<boolean> {
            const result = await client.set(key, value, 'PX', ttlMs, 'NX');
            if (result === 'OK') {
                return true;
            }
            if (result === null) {
                return false;
            }
            throw new TypeError('Expected Redis SET to return "OK" or null');
        },
        /** @inheritdoc */
        async eval({ script, keys, arguments: scriptArguments }): Promise<unknown> {
            return client.eval(script, keys.length, ...keys, ...scriptArguments);
        },
    };
}
