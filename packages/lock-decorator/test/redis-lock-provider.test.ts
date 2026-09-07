import { RedisLockProvider } from '../src/core/redis-lock-provider';
import { validate, version } from 'uuid';
import { RedisLockClient } from '../src/core/redis-lock-client';

const mockRedisClient = {
    setIfAbsent: jest.fn(),
    eval: jest.fn(),
};

describe('RedisLockProvider', () => {
    let provider: RedisLockProvider;

    beforeEach(() => {
        jest.resetAllMocks();
        provider = new RedisLockProvider(mockRedisClient);
    });

    describe('acquire', () => {
        it('redis-lock-client/L01 获取成功写入 token 和过期时间', async () => {
            mockRedisClient.setIfAbsent.mockResolvedValue(true);

            const token = await provider.acquire('order:12345', 30000);

            expect(token).toBeTruthy();
            expect(typeof token).toBe('string');
            expect(validate(String(token))).toBe(true);
            expect(version(String(token))).toBe(4);
            expect(mockRedisClient.setIfAbsent).toHaveBeenCalledWith({
                key: 'order:12345',
                value: token,
                ttlMs: 30000,
            });
        });

        it('redis-lock-client/L02 重复获取不修改持有者和有效期', async () => {
            mockRedisClient.setIfAbsent.mockResolvedValueOnce(true);
            mockRedisClient.setIfAbsent.mockResolvedValue(false);
            const previous = await provider.acquire('order:12345', 1000);
            const token = await provider.acquire('order:12345', 30000);
            expect(previous).not.toBeNull();
            expect(token).toBeNull();
            expect(mockRedisClient.eval).not.toHaveBeenCalled();
            expect(mockRedisClient.setIfAbsent).toHaveBeenCalledTimes(2);
        });
    });

    describe('release', () => {
        it('redis-lock-client/L03 正确 token 释放及重复释放', async () => {
            mockRedisClient.eval.mockResolvedValueOnce(1).mockResolvedValue(0);

            const result = await provider.release('order:12345', 'correct-token');

            expect(result).toBe(true);
            expect(mockRedisClient.eval).toHaveBeenCalled();
            expect(mockRedisClient.eval).toHaveBeenCalledWith({
                script: expect.any(String),
                keys: ['order:12345'],
                arguments: ['correct-token'],
            });
            await expect(provider.release('order:12345', 'correct-token')).resolves.toBe(false);
        });

        it('redis-lock-client/L04 错误 token 不能释放锁', async () => {
            mockRedisClient.eval.mockResolvedValue(0);

            const result = await provider.release('order:12345', 'wrong-token');

            expect(result).toBe(false);
        });
    });

    describe('renew', () => {
        it('redis-lock-client/L05 正确 token 可以续期', async () => {
            mockRedisClient.eval.mockResolvedValue(1);

            const result = await provider.renew('order:12345', 'correct-token', 30000);

            expect(result).toBe(true);
            expect(mockRedisClient.eval).toHaveBeenCalled();
            expect(mockRedisClient.eval).toHaveBeenCalledWith({
                script: expect.any(String),
                keys: ['order:12345'],
                arguments: ['correct-token', '30000'],
            });
        });

        it('redis-lock-client/L06 错误 token 不能续期', async () => {
            mockRedisClient.eval.mockResolvedValue(0);

            const result = await provider.renew('order:12345', 'wrong-token', 30000);

            expect(result).toBe(false);
        });
    });
});

describe('RedisLockProvider 客户端契约', () => {
    it('redis-lock-client/C01 自定义客户端接入统一 Provider', async () => {
        const client: RedisLockClient = {
            setIfAbsent: async () => true,
            eval: async () => 1,
        };
        const provider = new RedisLockProvider(client);
        const token = await provider.acquire('custom', 1000);
        expect(typeof token).toBe('string');
        await expect(provider.renew('custom', String(token), 2000)).resolves.toBe(true);
        await expect(provider.release('custom', String(token))).resolves.toBe(true);
    });

    it('redis-lock-client/L07 不存在的锁不能释放或续期', async () => {
        const client = { setIfAbsent: jest.fn(), eval: jest.fn().mockResolvedValue(0) };
        const provider = new RedisLockProvider(client);
        await expect(provider.release('missing', 'token')).resolves.toBe(false);
        await expect(provider.renew('missing', 'token', 1000)).resolves.toBe(false);
        expect(client.setIfAbsent).not.toHaveBeenCalled();
    });

    it('redis-lock-client/L08 过期重获后旧 token 失效', async () => {
        const client = { setIfAbsent: jest.fn().mockResolvedValue(true), eval: jest.fn().mockResolvedValue(0) };
        const provider = new RedisLockProvider(client);
        const oldToken = await provider.acquire('same-key', 1000);
        const newToken = await provider.acquire('same-key', 1000);
        expect(newToken).not.toBe(oldToken);
        await expect(provider.release('same-key', String(oldToken))).resolves.toBe(false);
        await expect(provider.renew('same-key', String(oldToken), 1000)).resolves.toBe(false);
        expect(client.eval.mock.calls.map(([request]) => request.arguments[0])).toEqual([oldToken, oldToken]);
    });

    it.each(['', '订单:lock'])('redis-lock-client/L09 key 和 TTL 边界不被适配层改写：%s', async (key) => {
        const client = { setIfAbsent: jest.fn().mockResolvedValue(true), eval: jest.fn().mockResolvedValue(1) };
        const provider = new RedisLockProvider(client);
        for (const ttl of [1, 2147483648]) {
            const token = await provider.acquire(key, ttl);
            expect(client.setIfAbsent).toHaveBeenLastCalledWith({ key, value: token, ttlMs: ttl });
            await provider.renew(key, String(token), ttl);
            expect(client.eval).toHaveBeenLastCalledWith({
                script: expect.any(String),
                keys: [key],
                arguments: [token, String(ttl)],
            });
        }
    });

    it.each([0, '1', null, undefined, true])('仅整数 1 表示脚本成功：%s', async (reply) => {
        const provider = new RedisLockProvider({ setIfAbsent: async () => true, eval: async () => reply });
        await expect(provider.release('key', 'token')).resolves.toBe(false);
        await expect(provider.renew('key', 'token', 1000)).resolves.toBe(false);
    });

    it('redis-lock-client/E02 释放命令异常传播', async () => {
        const error = new Error('release failed');
        const provider = new RedisLockProvider({ setIfAbsent: jest.fn(), eval: jest.fn().mockRejectedValue(error) });
        await expect(provider.release('key', 'token')).rejects.toBe(error);
    });

    it('redis-lock-client/E03 续期命令异常传播', async () => {
        const error = new Error('renew failed');
        const provider = new RedisLockProvider({ setIfAbsent: jest.fn(), eval: jest.fn().mockRejectedValue(error) });
        await expect(provider.renew('key', 'token', 1000)).rejects.toBe(error);
    });
});
