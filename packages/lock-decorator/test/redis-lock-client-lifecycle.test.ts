import { EventEmitter } from 'node:events';
import { createIoredisLockClient } from '../src/adapters/ioredis-lock-client';
import { createNodeRedisLockClient } from '../src/adapters/node-redis-lock-client';
import { RedisLockProvider } from '../src/core/redis-lock-provider';
import { LockProviderRegistry } from '../src/core/lock-provider-registry';

/** 创建由测试持有的连接探针，记录库是否越过连接所有权边界。 */
function createConnectionProbe() {
    const connection = Object.assign(new EventEmitter(), {
        options: Object.freeze({ connectionName: 'application', keyPrefix: 'tenant:' }),
        set: jest.fn().mockResolvedValue('OK'),
        eval: jest.fn().mockResolvedValue(1),
        connect: jest.fn(),
        quit: jest.fn(),
        disconnect: jest.fn(),
        destroy: jest.fn(),
    });
    const errors: Error[] = [];
    connection.on('error', (error: Error) => errors.push(error));
    return connection;
}

/** 断言库未更改连接配置、监听器或建立/关闭连接。 */
function expectCallerOwnership(connection: ReturnType<typeof createConnectionProbe>): void {
    expect(connection.options).toEqual({ connectionName: 'application', keyPrefix: 'tenant:' });
    expect(connection.eventNames()).toEqual(['error']);
    expect(connection.listenerCount('error')).toBe(1);
    for (const operation of [connection.connect, connection.quit, connection.disconnect, connection.destroy]) {
        expect(operation).not.toHaveBeenCalled();
    }
}

afterEach(() => LockProviderRegistry.clear());

describe.each([
    { name: 'ioredis', adapt: createIoredisLockClient },
    { name: 'node-redis', adapt: createNodeRedisLockClient },
])('$name 连接所有权', ({ adapt }) => {
    it('redis-lock-client/O01 构造与注册不操作连接', () => {
        const connection = createConnectionProbe();
        const options = connection.options;
        const listeners = connection.listeners('error');
        const provider = new RedisLockProvider(adapt(connection));
        LockProviderRegistry.register('shared', provider);
        LockProviderRegistry.setDefault('shared');
        expect(LockProviderRegistry.get()).toBe(provider);
        expect(connection.options).toBe(options);
        expect(connection.listeners('error')).toEqual(listeners);
        expectCallerOwnership(connection);
        expect(connection.set).not.toHaveBeenCalled();
        expect(connection.eval).not.toHaveBeenCalled();
    });

    it('redis-lock-client/O02 多个 Provider 共享连接', async () => {
        const connection = createConnectionProbe();
        const first = new RedisLockProvider(adapt(connection));
        const second = new RedisLockProvider(adapt(connection));
        const token = String(await first.acquire('first', 1000));
        await second.acquire('second', 1000);
        await first.renew('first', token, 2000);
        await first.release('first', token);
        const error = new Error('connection failure');
        connection.set.mockRejectedValueOnce(error);
        await expect(second.acquire('failed', 1000)).rejects.toBe(error);
        connection.eval.mockRejectedValueOnce(error);
        await expect(second.renew('second', token, 1000)).rejects.toBe(error);
        connection.eval.mockRejectedValueOnce(error);
        await expect(second.release('second', token)).rejects.toBe(error);
        await expect(connection.set('application-key', 'application-value')).resolves.toBe('OK');
        expectCallerOwnership(connection);
    });
});
