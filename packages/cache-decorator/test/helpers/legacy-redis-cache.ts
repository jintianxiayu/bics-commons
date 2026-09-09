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

/**
 * 使用旧版普通 JSON 读取规则恢复缓存值，不理解当前版本的异常 envelope。
 * @param client 由测试创建并持有的 ioredis 连接。
 * @param key 旧版本收到的原始缓存 key。
 * @returns miss 时返回 undefined；合法 JSON 返回解析值，其余字符串保持原值。
 * @throws Redis GET 命令失败时传播原始错误。
 */
export async function readLegacyRedisCache(client: Redis, key: string): Promise<unknown> {
    const value = await client.get(key);
    if (value === null) {
        return undefined;
    }
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
}
