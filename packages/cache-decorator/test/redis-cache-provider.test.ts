import { RedisCacheClient } from '../src/core/redis-cache-client';
import { RedisCacheProvider } from '../src/core/redis-cache';

function createClient(): jest.Mocked<RedisCacheClient> {
    const client = {
        get: jest.fn<Promise<string | null>, Parameters<RedisCacheClient['get']>>(),
        set: jest.fn<Promise<void>, Parameters<RedisCacheClient['set']>>(),
        deleteMany: jest.fn<Promise<void>, Parameters<RedisCacheClient['deleteMany']>>(),
        scan: jest.fn<ReturnType<RedisCacheClient['scan']>, Parameters<RedisCacheClient['scan']>>(),
        flushDatabase: jest.fn<Promise<void>, Parameters<RedisCacheClient['flushDatabase']>>(),
    } satisfies jest.Mocked<RedisCacheClient>;
    client.get.mockResolvedValue(null);
    client.set.mockResolvedValue(undefined);
    client.deleteMany.mockResolvedValue(undefined);
    client.scan.mockResolvedValue({ cursor: '0', keys: [] });
    client.flushDatabase.mockResolvedValue(undefined);
    return client;
}

function useStringStorage(client: jest.Mocked<RedisCacheClient>): Map<string, string> {
    const values = new Map<string, string>();
    client.set.mockImplementation(({ key, value }): Promise<void> => {
        values.set(key, value);
        return Promise.resolve();
    });
    client.get.mockImplementation((key): Promise<string | null> => Promise.resolve(values.get(key) ?? null));
    return values;
}

it('redis-cache-client/V01 不存在的 key 返回 cache miss', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);

    await expect(provider.get('missing')).resolves.toBeUndefined();

    expect(client.get).toHaveBeenCalledWith('missing');
    expect(client.set).not.toHaveBeenCalled();
});

it('redis-cache-client/V03 非 JSON 字符串和空字符串保持原值', async () => {
    const client = createClient();
    const values = useStringStorage(client);
    const provider = new RedisCacheProvider(client);

    await provider.set('plain', 'not-json');
    await provider.set('empty', '');

    expect(values).toEqual(
        new Map([
            ['plain', 'not-json'],
            ['empty', ''],
        ])
    );
    await expect(provider.get('plain')).resolves.toBe('not-json');
    await expect(provider.get('empty')).resolves.toBe('');
});

it('redis-cache-client/V04 JSON 文本字符串沿用解析行为', async () => {
    const client = createClient();
    const values = useStringStorage(client);
    const provider = new RedisCacheProvider(client);
    const cases: ReadonlyArray<readonly [string, unknown]> = [
        ['123', 123],
        ['true', true],
        ['null', null],
        ['[1,2]', [1, 2]],
        ['{"status":"open"}', { status: 'open' }],
    ];

    for (const [source, expected] of cases) {
        await provider.set(source, source);
        expect(values.get(source)).toBe(source);
        await expect(provider.get(source)).resolves.toEqual(expected);
    }
});

it('redis-cache-client/V06 缺省 TTL 与零 TTL 永不过期', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);

    await provider.set('default-ttl', 'value');
    await provider.set('zero-ttl', 'value', 0);

    expect(client.set).toHaveBeenNthCalledWith(1, { key: 'default-ttl', value: 'value' });
    expect(client.set).toHaveBeenNthCalledWith(2, { key: 'zero-ttl', value: 'value' });
});

it('redis-cache-client/V07 序列化失败不写入', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const values: readonly unknown[] = [cyclic, undefined, (): void => undefined, Symbol('cache')];

    for (const value of values) {
        await expect(provider.set('key', value)).rejects.toThrow(TypeError);
    }
    expect(client.set).not.toHaveBeenCalled();
});

it('redis-cache-client/V08 key 边界不被 Provider 改写', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);
    const keys = ['', '订单:缓存[*]?'];
    client.get.mockResolvedValue('value');

    for (const key of keys) {
        await provider.set(key, 'value');
        await provider.get(key);
        await provider.delete(key);
    }

    expect(client.set.mock.calls.map(([request]) => request.key)).toEqual(keys);
    expect(client.get.mock.calls.map(([key]) => key)).toEqual(keys);
    expect(client.deleteMany.mock.calls.map(([deletedKeys]) => deletedKeys)).toEqual(keys.map((key) => [key]));
});

it('redis-cache-client/E01 读取异常不是 cache miss', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);
    const error = new Error('GET unavailable');
    client.get.mockRejectedValue(error);

    await expect(provider.get('key')).rejects.toBe(error);
    expect(client.set).not.toHaveBeenCalled();
});

it('redis-cache-client/E02 写入异常传播', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);
    const error = new Error('SET unavailable');
    client.set.mockRejectedValue(error);

    await expect(provider.set('key', { value: true })).rejects.toBe(error);
    expect(client.set).toHaveBeenCalledWith({ key: 'key', value: '{"value":true}' });
});

it('redis-cache-client/E04 非法 TTL 在写入前被拒绝', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);
    const invalidTtls = [-1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const ttl of invalidTtls) {
        await expect(provider.set('key', 'value', ttl)).rejects.toThrow(RangeError);
    }
    expect(client.set).not.toHaveBeenCalled();
});

it('redis-cache-client/R01 重复删除保持幂等', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);

    await expect(provider.delete('key')).resolves.toBeUndefined();
    await expect(provider.delete('key')).resolves.toBeUndefined();

    expect(client.deleteMany).toHaveBeenCalledTimes(2);
    expect(client.deleteMany).toHaveBeenNthCalledWith(1, ['key']);
    expect(client.deleteMany).toHaveBeenNthCalledWith(2, ['key']);
});

it('redis-cache-client/R02 重复写入由后完成的命令覆盖', async () => {
    const client = createClient();
    useStringStorage(client);
    const provider = new RedisCacheProvider(client);

    await provider.set('key', { version: 1 }, 60);
    await provider.set('key', { version: 2 }, 120);

    await expect(provider.get<{ version: number }>('key')).resolves.toEqual({ version: 2 });
    expect(client.set).toHaveBeenNthCalledWith(1, {
        key: 'key',
        value: '{"version":1}',
        ttlSeconds: 60,
    });
    expect(client.set).toHaveBeenNthCalledWith(2, {
        key: 'key',
        value: '{"version":2}',
        ttlSeconds: 120,
    });
});

it('redis-cache-client/E03 删除或清库异常传播', async () => {
    const deleteClient = createClient();
    const deleteProvider = new RedisCacheProvider(deleteClient);
    const deleteError = new Error('DEL unavailable');
    deleteClient.deleteMany.mockRejectedValue(deleteError);
    const clearClient = createClient();
    const clearProvider = new RedisCacheProvider(clearClient);
    const clearError = new Error('FLUSHDB unavailable');
    clearClient.flushDatabase.mockRejectedValue(clearError);

    await expect(deleteProvider.delete('key')).rejects.toBe(deleteError);
    await expect(clearProvider.clear()).rejects.toBe(clearError);
});

it('cache-evict-allentries-prefix/pattern 末尾 * 作为前缀匹配', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);
    const existingKeys = new Set(['name:1', 'name:2', 'order:1']);
    client.scan.mockResolvedValue({ cursor: '0', keys: ['name:1', 'name:2'] });
    client.deleteMany.mockImplementation((keys): Promise<void> => {
        for (const key of keys) {
            existingKeys.delete(key);
        }
        return Promise.resolve();
    });

    await provider.deleteByPattern('name*');

    expect(client.scan).toHaveBeenCalledWith({ cursor: '0', pattern: 'name*', count: 100 });
    expect(client.deleteMany).toHaveBeenCalledWith(['name:1', 'name:2']);
    expect(existingKeys).toEqual(new Set(['order:1']));
});

it('cache-evict-allentries-prefix/RedisCacheProvider 使用 SCAN 迭代删除', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);
    client.scan
        .mockResolvedValueOnce({ cursor: '7', keys: ['name:1'] })
        .mockResolvedValueOnce({ cursor: '0', keys: ['name:2'] });

    await provider.deleteByPattern('name*');

    expect(client.scan.mock.calls).toEqual([
        [{ cursor: '0', pattern: 'name*', count: 100 }],
        [{ cursor: '7', pattern: 'name*', count: 100 }],
    ]);
    expect(client.deleteMany.mock.calls).toEqual([[['name:1']], [['name:2']]]);
});

it('cache-evict-allentries-prefix/F04 多页、空页与重复 key 均能完成扫描', async () => {
    const client = createClient();
    const provider = new RedisCacheProvider(client);
    client.scan
        .mockResolvedValueOnce({ cursor: '4', keys: ['name:1'] })
        .mockResolvedValueOnce({ cursor: '8', keys: [] })
        .mockResolvedValueOnce({ cursor: '0', keys: ['name:1', 'name:2'] });

    await provider.deleteByPattern('name*');

    expect(client.scan.mock.calls).toEqual([
        [{ cursor: '0', pattern: 'name*', count: 100 }],
        [{ cursor: '4', pattern: 'name*', count: 100 }],
        [{ cursor: '8', pattern: 'name*', count: 100 }],
    ]);
    expect(client.deleteMany.mock.calls).toEqual([[['name:1']], [['name:1', 'name:2']]]);
});

it('cache-evict-allentries-prefix/F09 扫描或批量删除失败时停止并传播', async () => {
    const scanClient = createClient();
    const scanProvider = new RedisCacheProvider(scanClient);
    const scanError = new Error('SCAN unavailable');
    scanClient.scan.mockRejectedValue(scanError);

    await expect(scanProvider.deleteByPattern('name*')).rejects.toBe(scanError);
    expect(scanClient.deleteMany).not.toHaveBeenCalled();

    const deleteClient = createClient();
    const deleteProvider = new RedisCacheProvider(deleteClient);
    const deleteError = new Error('second page DEL unavailable');
    deleteClient.scan
        .mockResolvedValueOnce({ cursor: '5', keys: ['name:1'] })
        .mockResolvedValueOnce({ cursor: '9', keys: ['name:2'] });
    deleteClient.deleteMany.mockResolvedValueOnce(undefined).mockRejectedValueOnce(deleteError);

    await expect(deleteProvider.deleteByPattern('name*')).rejects.toBe(deleteError);
    expect(deleteClient.scan).toHaveBeenCalledTimes(2);
    expect(deleteClient.deleteMany.mock.calls).toEqual([[['name:1']], [['name:2']]]);
});
