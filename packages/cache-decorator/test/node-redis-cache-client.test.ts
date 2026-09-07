import { createNodeRedisCacheClient } from '../src/adapters/node-redis-cache-client';
import { NodeRedisCacheClientSource } from '../src/core/redis-cache-client';

function createSource(): jest.Mocked<NodeRedisCacheClientSource> {
    const source = {
        get: jest.fn<Promise<unknown>, Parameters<NodeRedisCacheClientSource['get']>>(),
        set: jest.fn<Promise<unknown>, Parameters<NodeRedisCacheClientSource['set']>>(),
        setEx: jest.fn<Promise<unknown>, Parameters<NodeRedisCacheClientSource['setEx']>>(),
        del: jest.fn<Promise<unknown>, Parameters<NodeRedisCacheClientSource['del']>>(),
        scan: jest.fn<Promise<unknown>, Parameters<NodeRedisCacheClientSource['scan']>>(),
        flushDb: jest.fn<Promise<unknown>, Parameters<NodeRedisCacheClientSource['flushDb']>>(),
    } satisfies jest.Mocked<NodeRedisCacheClientSource>;
    return source;
}

it('redis-cache-client/A03 node-redis 无 TTL 写入成功', async () => {
    const source = createSource();
    const client = createNodeRedisCacheClient(source, { keyPrefix: 'cache:' });
    const request = Object.freeze({ key: 'order:1', value: '{"status":"open"}' });
    source.set.mockResolvedValue('OK');

    await expect(client.set(request)).resolves.toBeUndefined();

    expect(source.set).toHaveBeenCalledWith('cache:order:1', request.value);
    expect(source.setEx).not.toHaveBeenCalled();
});

it('redis-cache-client/A04 node-redis 带 TTL 写入成功', async () => {
    const source = createSource();
    const client = createNodeRedisCacheClient(source, { keyPrefix: 'cache:' });
    const request = Object.freeze({ key: 'order:2', value: 'paid', ttlSeconds: 60 });
    source.setEx.mockResolvedValue('OK');

    await expect(client.set(request)).resolves.toBeUndefined();

    expect(source.setEx).toHaveBeenCalledWith('cache:order:2', request.ttlSeconds, request.value);
    expect(source.set).not.toHaveBeenCalled();
});

it('redis-cache-client/A05 GET 响应规范化', async () => {
    const source = createSource();
    const client = createNodeRedisCacheClient(source, { keyPrefix: 'cache:' });
    source.get.mockResolvedValueOnce('cached').mockResolvedValueOnce(null);

    await expect(client.get('present')).resolves.toBe('cached');
    await expect(client.get('missing')).resolves.toBeNull();

    expect(source.get).toHaveBeenNthCalledWith(1, 'cache:present');
    expect(source.get).toHaveBeenNthCalledWith(2, 'cache:missing');
});

it('redis-cache-client/A06 删除和清库响应规范化', async () => {
    const source = createSource();
    const client = createNodeRedisCacheClient(source, { keyPrefix: 'cache:' });
    source.del.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    source.flushDb.mockResolvedValue('OK');

    await expect(client.deleteMany(['first', 'second'])).resolves.toBeUndefined();
    await expect(client.deleteMany(['missing'])).resolves.toBeUndefined();
    await expect(client.deleteMany([])).resolves.toBeUndefined();
    await expect(client.flushDatabase()).resolves.toBeUndefined();

    expect(source.del).toHaveBeenCalledTimes(2);
    expect(source.del).toHaveBeenNthCalledWith(1, ['cache:first', 'cache:second']);
    expect(source.del).toHaveBeenNthCalledWith(2, ['cache:missing']);
    expect(source.flushDb).toHaveBeenCalledTimes(1);
});

it('redis-cache-client/A07 调用上下文与请求保持不变', async () => {
    const source = createSource();
    const options = Object.freeze({ keyPrefix: 'scope:' });
    const client = createNodeRedisCacheClient(source, options);
    source.set.mockImplementation(function (this: NodeRedisCacheClientSource): Promise<unknown> {
        expect(this).toBe(source);
        return Promise.resolve('OK');
    });
    source.del.mockImplementation(function (this: NodeRedisCacheClientSource): Promise<unknown> {
        expect(this).toBe(source);
        return Promise.resolve(2);
    });
    source.scan.mockImplementation(function (this: NodeRedisCacheClientSource): Promise<unknown> {
        expect(this).toBe(source);
        return Promise.resolve({ cursor: '0', keys: ['scope:first', 'scope:second'] });
    });
    const writeRequest = Object.freeze({ key: 'first', value: 'value' });
    const keys = Object.freeze(['first', 'second']);
    const scanRequest = Object.freeze({ cursor: '0', pattern: 'first*', count: 100 });

    await client.set(writeRequest);
    await client.deleteMany(keys);
    await client.scan(scanRequest);

    expect(options).toEqual({ keyPrefix: 'scope:' });
    expect(writeRequest).toEqual({ key: 'first', value: 'value' });
    expect(keys).toEqual(['first', 'second']);
    expect(scanRequest).toEqual({ cursor: '0', pattern: 'first*', count: 100 });
});

it('redis-cache-client/A08 非标准响应明确失败', async () => {
    const source = createSource();
    const client = createNodeRedisCacheClient(source);
    source.get.mockResolvedValue(Buffer.from('value'));
    source.set.mockResolvedValue(true);
    source.setEx.mockResolvedValue(undefined);
    source.del.mockResolvedValue(1.5);
    source.scan.mockResolvedValue(['0', []]);
    source.flushDb.mockResolvedValue(null);

    await expect(client.get('key')).rejects.toThrow(TypeError);
    await expect(client.set({ key: 'key', value: 'value' })).rejects.toThrow(TypeError);
    await expect(client.set({ key: 'key', value: 'value', ttlSeconds: 1 })).rejects.toThrow(TypeError);
    await expect(client.deleteMany(['key'])).rejects.toThrow(TypeError);
    await expect(client.scan({ cursor: '0', pattern: '*', count: 100 })).rejects.toThrow(TypeError);
    await expect(client.flushDatabase()).rejects.toThrow(TypeError);
});

it('cache-evict-allentries-prefix/F07 node-redis 缺省前缀不改写 key', async () => {
    const source = createSource();
    const client = createNodeRedisCacheClient(source);
    source.scan.mockResolvedValue({ cursor: '0', keys: ['name:1'] });
    source.del.mockResolvedValue(1);

    const page = await client.scan({ cursor: '0', pattern: 'name*', count: 100 });
    await client.deleteMany(page.keys);

    expect(source.scan).toHaveBeenCalledWith('0', { MATCH: 'name*', COUNT: 100 });
    expect(page).toEqual({ cursor: '0', keys: ['name:1'] });
    expect(source.del).toHaveBeenCalledWith(['name:1']);
});

it('cache-evict-allentries-prefix/F08 node-redis 显式前缀访问同一命名空间', async () => {
    const source = createSource();
    const client = createNodeRedisCacheClient(source, { keyPrefix: 'cache:' });
    source.get.mockResolvedValue('value');
    source.set.mockResolvedValue('OK');
    source.scan.mockResolvedValue({ cursor: '0', keys: ['cache:name:1'] });
    source.del.mockResolvedValue(1);

    await expect(client.get('name:1')).resolves.toBe('value');
    await client.set({ key: 'name:1', value: 'updated' });
    const page = await client.scan({ cursor: '0', pattern: 'name*', count: 100 });
    await client.deleteMany(page.keys);

    expect(source.get).toHaveBeenCalledWith('cache:name:1');
    expect(source.set).toHaveBeenCalledWith('cache:name:1', 'updated');
    expect(source.scan).toHaveBeenCalledWith('0', { MATCH: 'cache:name*', COUNT: 100 });
    expect(page).toEqual({ cursor: '0', keys: ['name:1'] });
    expect(source.del).toHaveBeenCalledWith(['cache:name:1']);
});
