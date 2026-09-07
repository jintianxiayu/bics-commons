import { EventEmitter } from 'node:events';
import { createIoredisCacheClient } from '../src/adapters/ioredis-cache-client';
import { createNodeRedisCacheClient } from '../src/adapters/node-redis-cache-client';
import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { RedisCacheClient } from '../src/core/redis-cache-client';
import { RedisCacheProvider } from '../src/core/redis-cache';

/** 创建由测试持有的连接探针，记录库是否越过连接所有权边界。 */
function createConnectionProbe() {
    const connection = Object.assign(new EventEmitter(), {
        options: Object.freeze({ connectionName: 'application', keyPrefix: 'tenant:' }),
        get: jest.fn((_key: string): Promise<unknown> => Promise.resolve(null)),
        set: jest.fn((_key: string, _value: string): Promise<unknown> => Promise.resolve('OK')),
        setex: jest.fn((_key: string, _ttlSeconds: number, _value: string): Promise<unknown> => Promise.resolve('OK')),
        setEx: jest.fn((_key: string, _ttlSeconds: number, _value: string): Promise<unknown> => Promise.resolve('OK')),
        del: jest.fn((..._keys: Array<string | string[]>): Promise<unknown> => Promise.resolve(1)),
        scan: jest.fn((...args: unknown[]): Promise<unknown> => {
            return Promise.resolve(typeof args[1] === 'string' ? ['0', []] : { cursor: '0', keys: [] });
        }),
        flushdb: jest.fn((): Promise<unknown> => Promise.resolve('OK')),
        flushDb: jest.fn((): Promise<unknown> => Promise.resolve('OK')),
        connect: jest.fn(),
        quit: jest.fn(),
        disconnect: jest.fn(),
        close: jest.fn(),
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
    for (const operation of [
        connection.connect,
        connection.quit,
        connection.disconnect,
        connection.close,
        connection.destroy,
    ]) {
        expect(operation).not.toHaveBeenCalled();
    }
}

interface AdapterCase {
    readonly name: string;
    adapt(connection: ReturnType<typeof createConnectionProbe>): RedisCacheClient;
}

const adapterCases: readonly AdapterCase[] = [
    {
        name: 'ioredis',
        adapt: (connection) => createIoredisCacheClient(connection),
    },
    {
        name: 'node-redis',
        adapt: (connection) => createNodeRedisCacheClient(connection, { keyPrefix: connection.options.keyPrefix }),
    },
];

afterEach(() => CacheProviderRegistry.clear());

describe.each(adapterCases)('$name 连接所有权', ({ adapt }) => {
    it('redis-cache-client/O01 构造与注册不操作连接', () => {
        const connection = createConnectionProbe();
        const options = connection.options;
        const listeners = connection.listeners('error');
        const provider = new RedisCacheProvider(adapt(connection));
        CacheProviderRegistry.register('shared', provider);
        CacheProviderRegistry.setDefault('shared');

        expect(CacheProviderRegistry.get()).toBe(provider);
        expect(connection.options).toBe(options);
        expect(connection.listeners('error')).toEqual(listeners);
        expectCallerOwnership(connection);
        for (const command of [
            connection.get,
            connection.set,
            connection.setex,
            connection.setEx,
            connection.del,
            connection.scan,
            connection.flushdb,
            connection.flushDb,
        ]) {
            expect(command).not.toHaveBeenCalled();
        }
    });

    it('redis-cache-client/O02 多个 Provider 共享连接', async () => {
        const connection = createConnectionProbe();
        const first = new RedisCacheProvider(adapt(connection));
        const second = new RedisCacheProvider(adapt(connection));

        await first.set('first', { value: 1 });
        await second.get('first');
        await first.delete('first');
        await second.deleteByPattern('shared*');
        await first.clear();

        const error = new Error('connection failure');
        connection.get.mockRejectedValueOnce(error);
        await expect(second.get('failed')).rejects.toBe(error);
        await expect(connection.get('application-key')).resolves.toBeNull();
        await expect(connection.set('application-key', 'application-value')).resolves.toBe('OK');
        expectCallerOwnership(connection);
    });
});
