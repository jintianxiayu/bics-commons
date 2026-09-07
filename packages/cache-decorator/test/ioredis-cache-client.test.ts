import { createIoredisCacheClient } from '../src/adapters/ioredis-cache-client';
import { IoredisCacheClientSource } from '../src/core/redis-cache-client';

function createSource(keyPrefix?: string): jest.Mocked<IoredisCacheClientSource> {
    const source = {
        options: Object.freeze({ keyPrefix }),
        get: jest.fn<Promise<unknown>, Parameters<IoredisCacheClientSource['get']>>(),
        set: jest.fn<Promise<unknown>, Parameters<IoredisCacheClientSource['set']>>(),
        setex: jest.fn<Promise<unknown>, Parameters<IoredisCacheClientSource['setex']>>(),
        del: jest.fn<Promise<unknown>, Parameters<IoredisCacheClientSource['del']>>(),
        scan: jest.fn<Promise<unknown>, Parameters<IoredisCacheClientSource['scan']>>(),
        flushdb: jest.fn<Promise<unknown>, Parameters<IoredisCacheClientSource['flushdb']>>(),
    } satisfies jest.Mocked<IoredisCacheClientSource>;
    return source;
}

it('redis-cache-client/A01 ioredis 无 TTL 写入成功', async () => {
    const source = createSource();
    const client = createIoredisCacheClient(source);
    const request = Object.freeze({ key: 'order:1', value: '{"status":"open"}' });
    source.set.mockResolvedValue('OK');

    await expect(client.set(request)).resolves.toBeUndefined();

    expect(source.set).toHaveBeenCalledWith(request.key, request.value);
    expect(source.setex).not.toHaveBeenCalled();
});

it('redis-cache-client/A02 ioredis 带 TTL 写入成功', async () => {
    const source = createSource();
    const client = createIoredisCacheClient(source);
    const request = Object.freeze({ key: 'order:2', value: 'paid', ttlSeconds: 60 });
    source.setex.mockResolvedValue('OK');

    await expect(client.set(request)).resolves.toBeUndefined();

    expect(source.setex).toHaveBeenCalledWith(request.key, request.ttlSeconds, request.value);
    expect(source.set).not.toHaveBeenCalled();
});

it('redis-cache-client/A05 GET 响应规范化', async () => {
    const source = createSource();
    const client = createIoredisCacheClient(source);
    source.get.mockResolvedValueOnce('cached').mockResolvedValueOnce(null);

    await expect(client.get('present')).resolves.toBe('cached');
    await expect(client.get('missing')).resolves.toBeNull();

    expect(source.get).toHaveBeenNthCalledWith(1, 'present');
    expect(source.get).toHaveBeenNthCalledWith(2, 'missing');
});

it('redis-cache-client/A06 删除和清库响应规范化', async () => {
    const source = createSource();
    const client = createIoredisCacheClient(source);
    source.del.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    source.flushdb.mockResolvedValue('OK');

    await expect(client.deleteMany(['first', 'second'])).resolves.toBeUndefined();
    await expect(client.deleteMany(['missing'])).resolves.toBeUndefined();
    await expect(client.deleteMany([])).resolves.toBeUndefined();
    await expect(client.flushDatabase()).resolves.toBeUndefined();

    expect(source.del).toHaveBeenCalledTimes(2);
    expect(source.del).toHaveBeenNthCalledWith(1, 'first', 'second');
    expect(source.del).toHaveBeenNthCalledWith(2, 'missing');
    expect(source.flushdb).toHaveBeenCalledTimes(1);
});

it('redis-cache-client/A07 调用上下文与请求保持不变', async () => {
    const source = createSource('scope:');
    const client = createIoredisCacheClient(source);
    source.set.mockImplementation(function (this: IoredisCacheClientSource): Promise<unknown> {
        expect(this).toBe(source);
        return Promise.resolve('OK');
    });
    source.del.mockImplementation(function (this: IoredisCacheClientSource): Promise<unknown> {
        expect(this).toBe(source);
        return Promise.resolve(2);
    });
    source.scan.mockImplementation(function (this: IoredisCacheClientSource): Promise<unknown> {
        expect(this).toBe(source);
        return Promise.resolve(['0', ['scope:first', 'scope:second']]);
    });
    const writeRequest = Object.freeze({ key: 'first', value: 'value' });
    const keys = Object.freeze(['first', 'second']);
    const scanRequest = Object.freeze({ cursor: '0', pattern: 'first*', count: 100 });

    await client.set(writeRequest);
    await client.deleteMany(keys);
    await client.scan(scanRequest);

    expect(writeRequest).toEqual({ key: 'first', value: 'value' });
    expect(keys).toEqual(['first', 'second']);
    expect(scanRequest).toEqual({ cursor: '0', pattern: 'first*', count: 100 });
});

it('redis-cache-client/A08 非标准响应明确失败', async () => {
    const source = createSource();
    const client = createIoredisCacheClient(source);
    source.get.mockResolvedValue(false);
    source.set.mockResolvedValue(null);
    source.setex.mockResolvedValue(Buffer.from('OK'));
    source.del.mockResolvedValue(-1);
    source.scan.mockResolvedValue({ cursor: '0', keys: [] });
    source.flushdb.mockResolvedValue('PONG');

    await expect(client.get('key')).rejects.toThrow(TypeError);
    await expect(client.set({ key: 'key', value: 'value' })).rejects.toThrow(TypeError);
    await expect(client.set({ key: 'key', value: 'value', ttlSeconds: 1 })).rejects.toThrow(TypeError);
    await expect(client.deleteMany(['key'])).rejects.toThrow(TypeError);
    await expect(client.scan({ cursor: '0', pattern: '*', count: 100 })).rejects.toThrow(TypeError);
    await expect(client.flushDatabase()).rejects.toThrow(TypeError);
});

it('cache-evict-allentries-prefix/F05 ioredis keyPrefix 下删除逻辑 pattern', async () => {
    const source = createSource('cache:');
    const client = createIoredisCacheClient(source);
    source.scan.mockResolvedValue(['0', ['cache:name:1', 'cache:name:2']]);
    source.del.mockResolvedValue(2);

    const page = await client.scan({ cursor: '0', pattern: 'name*', count: 100 });
    await client.deleteMany(page.keys);

    expect(source.scan).toHaveBeenCalledWith('0', 'MATCH', 'cache:name*', 'COUNT', 100);
    expect(page).toEqual({ cursor: '0', keys: ['name:1', 'name:2'] });
    expect(source.del).toHaveBeenCalledWith('name:1', 'name:2');
});

it('cache-evict-allentries-prefix/F06 ioredis 特殊字符 keyPrefix 被按字面量匹配', async () => {
    const keyPrefix = 'scope\\*?[]:';
    const source = createSource(keyPrefix);
    const client = createIoredisCacheClient(source);
    source.scan.mockResolvedValue(['0', [`${keyPrefix}name:1`]]);
    const expectedPattern = ['scope', '\\\\', '\\*', '\\?', '\\[', '\\]', ':name*'].join('');

    await expect(client.scan({ cursor: '0', pattern: 'name*', count: 100 })).resolves.toEqual({
        cursor: '0',
        keys: ['name:1'],
    });

    expect(source.scan).toHaveBeenCalledWith('0', 'MATCH', expectedPattern, 'COUNT', 100);
});
