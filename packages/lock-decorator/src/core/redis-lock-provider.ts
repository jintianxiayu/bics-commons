import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { LockProvider } from './lock-provider';

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
    constructor(private client: Redis) {}

    /** @inheritdoc */
    async acquire(key: string, ttl: number): Promise<string | null> {
        const token = uuidv4();
        const result = await this.client.set(key, token, 'PX', ttl, 'NX');
        return result === 'OK' ? token : null;
    }

    /** @inheritdoc */
    async release(key: string, token: string): Promise<boolean> {
        const result = await this.client.eval(RELEASE_SCRIPT, 1, key, token);
        return result === 1;
    }

    /** @inheritdoc */
    async renew(key: string, token: string, ttl: number): Promise<boolean> {
        const result = await this.client.eval(RENEW_SCRIPT, 1, key, token, ttl);
        return result === 1;
    }
}
