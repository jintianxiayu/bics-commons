/**
 * 锁提供者接口，定义分布式锁存储后端的统一契约
 * 支持可插拔的锁实现（Redis、Memory、自定义）
 */
export interface LockProvider {
    /**
     * 获取分布式锁
     * @param key 锁键
     * @param ttl 过期时间（毫秒）
     * @returns 锁 token，成功返回非 null 字符串，失败返回 null
     */
    acquire(key: string, ttl: number): Promise<string | null>;

    /**
     * 释放分布式锁
     * @param key 锁键
     * @param token 锁 token
     * @returns 释放成功返回 true，token 不匹配返回 false
     */
    release(key: string, token: string): Promise<boolean>;

    /**
     * 续期分布式锁
     * @param key 锁键
     * @param token 锁 token
     * @param ttl 新的过期时间（毫秒）
     * @returns 续期成功返回 true，token 不匹配返回 false
     */
    renew(key: string, token: string, ttl: number): Promise<boolean>;
}

/**
 * @DistributedLock 装饰器配置选项
 */
export interface DistributedLockOptions {
    /** 锁键，支持 undefined/null、字符串、函数三种形式 */
    key?: null | string | ((...args: unknown[]) => string);
    /** 锁超时时间（毫秒），默认 30000 */
    ttl?: number;
    /** 看门狗续期间隔（毫秒），默认 10000 */
    renewInterval?: number;
    /** 获取锁重试次数，默认 0 */
    retryCount?: number;
    /** 重试间隔（毫秒），默认 100 */
    retryDelay?: number;
}

export const DEFAULT_TTL = 30000;
export const DEFAULT_RENEW_INTERVAL = 10000;
export const DEFAULT_RETRY_COUNT = 0;
export const DEFAULT_RETRY_DELAY = 100;
