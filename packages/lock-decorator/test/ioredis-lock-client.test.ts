import { createIoredisLockClient } from '../src/adapters/ioredis-lock-client';
import { IoredisLockClientSource } from '../src/core/redis-lock-client';
import { RedisLockProvider } from '../src/core/redis-lock-provider';

const source = {
    set: jest.fn<Promise<unknown>, Parameters<IoredisLockClientSource['set']>>(),
    eval: jest.fn<Promise<unknown>, Parameters<IoredisLockClientSource['eval']>>(),
};
const client = createIoredisLockClient(source);
const request = Object.freeze({ key: 'order:123', value: 'token', ttlMs: 1234 });

beforeEach(() => jest.resetAllMocks());

it('redis-lock-client/A01 ioredis 条件写入成功', async () => {
    source.set.mockResolvedValue('OK');
    await expect(client.setIfAbsent(request)).resolves.toBe(true);
    expect(source.set).toHaveBeenCalledWith(request.key, request.value, 'PX', request.ttlMs, 'NX');
});

it('redis-lock-client/A02 ioredis 条件写入发生竞争', async () => {
    source.set.mockResolvedValue(null);
    await expect(client.setIfAbsent(request)).resolves.toBe(false);
    expect(source.set).toHaveBeenCalledTimes(1);
    expect(source.eval).not.toHaveBeenCalled();
});

it.each([
    { keys: ['first', 'second'], arguments: ['token', '1000'] },
    { keys: [], arguments: [] },
])('redis-lock-client/A03 ioredis 脚本参数与响应保持一致：%j', async (options) => {
    const response = ['original', 1];
    source.eval.mockResolvedValue(response);
    await expect(client.eval({ script: 'return {KEYS, ARGV}', ...options })).resolves.toBe(response);
    expect(source.eval).toHaveBeenCalledWith(
        'return {KEYS, ARGV}',
        options.keys.length,
        ...options.keys,
        ...options.arguments
    );
});

it('redis-lock-client/A07 调用上下文与请求保持不变', async () => {
    source.set.mockImplementation(function (this: IoredisLockClientSource) {
        expect(this).toBe(source);
        return Promise.resolve('OK');
    });
    source.eval.mockImplementation(function (this: IoredisLockClientSource) {
        expect(this).toBe(source);
        return Promise.resolve(1);
    });
    const scriptRequest = Object.freeze({
        script: 'return 1',
        keys: Object.freeze(['first', 'second']),
        arguments: Object.freeze(['token', '1234']),
    });
    await expect(client.setIfAbsent(request)).resolves.toBe(true);
    await expect(client.eval(scriptRequest)).resolves.toBe(1);
    expect(request).toEqual({ key: 'order:123', value: 'token', ttlMs: 1234 });
    expect(scriptRequest).toEqual({ script: 'return 1', keys: ['first', 'second'], arguments: ['token', '1234'] });
});

it.each([undefined, false, 1, 'unexpected', Buffer.from('OK')])(
    'redis-lock-client/A08 非标准 SET 响应明确失败：%s',
    async (response) => {
        source.set.mockResolvedValue(response);
        await expect(client.setIfAbsent(request)).rejects.toThrow(TypeError);
        expect(source.set).toHaveBeenCalledTimes(1);
    }
);

it.each(['', '订单:lock'])('redis-lock-client/L09 key 和 TTL 边界不被适配层改写：%s', async (key) => {
    source.set.mockResolvedValue('OK');
    for (const ttlMs of [1, 2147483648]) {
        await client.setIfAbsent({ key, value: 'token', ttlMs });
        expect(source.set).toHaveBeenLastCalledWith(key, 'token', 'PX', ttlMs, 'NX');
    }
});

it('redis-lock-client/E02 释放命令异常传播', async () => {
    const error = new Error('script unavailable');
    source.eval.mockRejectedValue(error);
    await expect(new RedisLockProvider(client).release('key', 'token')).rejects.toBe(error);
});

it('redis-lock-client/E03 续期命令异常传播', async () => {
    const error = new Error('script timeout');
    source.eval.mockRejectedValue(error);
    await expect(new RedisLockProvider(client).renew('key', 'token', 1000)).rejects.toBe(error);
});
