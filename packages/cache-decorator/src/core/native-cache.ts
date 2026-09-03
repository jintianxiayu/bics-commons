import { CacheProvider } from './cache-provider';

/**
 * 缓存条目结构
 */
interface CacheEntry<T> {
    value: T;
    expiresAt: number | null;
}

/**
 * 内存缓存提供者，基于 Map 实现
 * 适用于单机应用，缓存随进程重启清除
 */
export class MemoryCacheProvider implements CacheProvider {
    private cache = new Map<string, CacheEntry<unknown>>();

    get<T>(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value as T;
    }

    set<T>(key: string, value: T, ttl?: number): void {
        const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
        this.cache.set(key, { value, expiresAt });
    }

    delete(key: string): void {
        this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    /**
     * 根据模式删除匹配的缓存键
     * @param pattern glob模式字符串（如 user:*），末尾的 * 作为前缀匹配
     */
    deleteByPattern(pattern: string): void {
        const prefix = pattern.replace(/\*$/, '');
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }
}
