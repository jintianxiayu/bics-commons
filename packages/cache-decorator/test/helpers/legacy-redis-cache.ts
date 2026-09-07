import Redis from 'ioredis';

/**
 * 使用 0.1.3 的字符串/JSON 与秒级 TTL 协议写入兼容性数据。
 * @param client 由测试创建并持有的 ioredis 连接。
 * @param key 旧版本收到的原始缓存 key。
 * @param value 旧版本支持的字符串或 JSON 可序列化值。
 * @param ttl 可选的秒级 TTL；0 与 undefined 使用普通 SET。
 * @returns 旧版写入命令成功后完成。
 * @throws 无法序列化或 Redis 命令失败时传播错误。
 */
export async function writeLegacyRedisCache(client: Redis, key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof serialized !== 'string') {
        throw new TypeError('Legacy cache fixture value must serialize to a string');
    }
    if (ttl) {
        await client.setex(key, ttl, serialized);
        return;
    }
    await client.set(key, serialized);
}
