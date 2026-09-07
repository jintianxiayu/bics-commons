import { CacheProvider } from './cache-provider';
import { RedisCacheClient } from './redis-cache-client';

/**
 * Redis 缓存提供者，在客户端无关的字符串命令之上维护统一缓存协议。
 * 适用于分布式场景，支持跨进程及跨客户端共享缓存。
 */
export class RedisCacheProvider implements CacheProvider {
    private readonly client: RedisCacheClient;

    /**
     * 创建复用调用方 Redis 连接的缓存提供者。
     * @param client 已适配的最小 Redis 缓存客户端。
     */
    constructor(client: RedisCacheClient) {
        this.client = client;
    }

    /**
     * 按既有协议读取并反序列化缓存值。
     * @param key 未经 Provider 改写的逻辑缓存键。
     * @returns 解析后的业务值；Redis miss 时返回 undefined。
     * @throws GET 命令失败时传播客户端原始错误。
     */
    async get<T>(key: string): Promise<T | undefined> {
        const value = await this.client.get(key);
        if (value === null) {
            return undefined;
        }
        try {
            return JSON.parse(value) as T;
        } catch {
            // 兼容既有协议：不是合法 JSON 的字符串按原值返回。
            return value as unknown as T;
        }
    }

    /**
     * 按既有字符串或 JSON 协议写入缓存值。
     * @param key 未经 Provider 改写的逻辑缓存键。
     * @param value 需要缓存的业务值。
     * @param ttl 可选的正整数秒级 TTL；undefined 或 0 表示永不过期。
     * @returns 写入命令成功后完成。
     * @throws 值不能序列化时抛 TypeError，TTL 非法时抛 RangeError，命令失败时传播原始错误。
     */
    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
        const ttlSeconds = this.normalizeTtl(ttl);
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        if (typeof serialized !== 'string') {
            throw new TypeError('Cache value must serialize to a string');
        }
        if (ttlSeconds === undefined) {
            await this.client.set({ key, value: serialized });
            return;
        }
        await this.client.set({ key, value: serialized, ttlSeconds });
    }

    /**
     * 幂等删除一个逻辑缓存键。
     * @param key 未经 Provider 改写的逻辑缓存键。
     * @returns 删除命令成功后完成。
     * @throws DEL 命令失败时传播客户端原始错误。
     */
    async delete(key: string): Promise<void> {
        await this.client.deleteMany([key]);
    }

    /**
     * 清空客户端当前选择的整个 Redis 数据库。
     * @returns FLUSHDB 命令成功后完成。
     * @throws 清库命令失败时传播客户端原始错误。
     */
    async clear(): Promise<void> {
        await this.client.flushDatabase();
    }

    /**
     * 使用游标扫描并按页删除匹配的逻辑缓存键，避免阻塞 Redis。
     * @param pattern 保留 glob 语义的逻辑 pattern，例如 user:*。
     * @returns 游标归零且所有已扫描页面删除成功后完成。
     * @throws SCAN 或任一页 DEL 失败时传播客户端原始错误，并停止后续页面。
     */
    async deleteByPattern(pattern: string): Promise<void> {
        let cursor = '0';
        do {
            const page = await this.client.scan({ cursor, pattern, count: 100 });
            cursor = page.cursor;
            if (page.keys.length > 0) {
                await this.client.deleteMany(page.keys);
            }
        } while (cursor !== '0');
    }

    private normalizeTtl(ttl: number | undefined): number | undefined {
        if (ttl === undefined || ttl === 0) {
            return undefined;
        }
        if (!Number.isFinite(ttl) || !Number.isInteger(ttl) || ttl < 1) {
            throw new RangeError('Redis cache TTL must be a positive finite integer or zero');
        }
        return ttl;
    }
}
