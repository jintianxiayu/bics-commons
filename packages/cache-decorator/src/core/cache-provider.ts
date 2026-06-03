/**
 * 缓存提供者接口，定义缓存存储后端的统一契约
 * 支持可插拔的缓存实现（Memory、Redis、自定义）
 */
export interface CacheProvider {
    /**
     * 获取缓存值
     * @param key 缓存键
     * @returns 缓存值，不存在或已过期返回 undefined
     */
    get<T>(key: string): T | undefined | Promise<T | undefined>;

    /**
     * 设置缓存值
     * @param key 缓存键
     * @param value 缓存值
     * @param ttl 过期时间（秒），不设置则永不过期
     */
    set<T>(key: string, value: T, ttl?: number): void | Promise<void>;

    /**
     * 删除指定缓存
     * @param key 缓存键
     */
    delete(key: string): void | Promise<void>;

    /**
     * 清除所有缓存
     */
    clear(): void | Promise<void>;

    /**
     * 根据模式删除匹配的缓存键
     * @param pattern glob模式字符串（如 user:*），末尾的 * 作为前缀匹配
     */
    deleteByPattern(pattern: string): void | Promise<void>;
}
