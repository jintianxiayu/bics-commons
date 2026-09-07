import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { LockProvider } from '../../src/core/lock-provider';

// 来自 0.1.3 / 399935812f4aeefaaf38671467459786737ffa67 的协议快照；不引用新 Provider 的脚本。
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

/** 保存变更前的客户端调用及数据协议，独立验证滚动升级互操作。 */
export class LegacyRedisLockProvider implements LockProvider {
    constructor(private readonly client: Redis) {}

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
