import { CacheProvider } from './cache-provider';
import Redis from 'ioredis';

/**
 * Redis 缓存提供者，基于 ioredis 实现
 * 适用于分布式场景，支持跨进程共享缓存
 */
export class RedisCacheProvider implements CacheProvider {
  private redis: Redis;

  constructor(redis?: Redis) {
    this.redis = redis ?? new Redis();
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.redis.get(key);
    if (value === null) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttl) {
      await this.redis.setex(key, ttl, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async clear(): Promise<void> {
    await this.redis.flushdb();
  }

  /**
   * 根据模式删除匹配的键
   * @param pattern Redis 键模式（如 user:*）
   */
  async deleteByPattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}