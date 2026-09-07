import { v4 as uuidv4 } from 'uuid';
import { LockProvider } from './lock-provider';
import { RedisLockClient } from './redis-lock-client';

/** 释放锁的 Lua 脚本：校验 token 后删除 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/** 续期锁的 Lua 脚本：校验 token 后重设过期时间 */
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

/**
 * 基于 Redis 的锁提供者实现
 * 使用 SET NX PX 原子设锁，Lua 脚本保证原子操作
 */
export class RedisLockProvider implements LockProvider {
    /**
     * 复用调用方适配后的 Redis 操作，连接生命周期仍归调用方。
     * @param client 客户端无关的原子操作边界。
     */
    constructor(private readonly client: RedisLockClient) {}

    /** @inheritdoc */
    async acquire(key: string, ttl: number): Promise<string | null> {
        const token = uuidv4();
        const acquired = await this.client.setIfAbsent({ key, value: token, ttlMs: ttl });
        return acquired ? token : null;
    }

    /** @inheritdoc */
    async release(key: string, token: string): Promise<boolean> {
        const result = await this.client.eval({ script: RELEASE_SCRIPT, keys: [key], arguments: [token] });
        return result === 1;
    }

    /** @inheritdoc */
    async renew(key: string, token: string, ttl: number): Promise<boolean> {
        const result = await this.client.eval({ script: RENEW_SCRIPT, keys: [key], arguments: [token, String(ttl)] });
        return result === 1;
    }
}
