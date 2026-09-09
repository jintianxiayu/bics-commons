import type Redis from 'ioredis';
import { readLegacyRedisCache, writeLegacyRedisCache } from './helpers/legacy-redis-cache';

interface LegacyRedisHarness {
    readonly client: Redis;
    readonly get: jest.Mock<Promise<string | null>, [string]>;
    readonly set: jest.Mock<Promise<unknown>, [string, string]>;
    readonly setex: jest.Mock<Promise<unknown>, [string, number, string]>;
}

/** 创建只实现 legacy helper 所需命令的 Redis 测试替身。 */
function createLegacyRedisHarness(): LegacyRedisHarness {
    const get = jest.fn<Promise<string | null>, [string]>();
    const set = jest.fn<Promise<unknown>, [string, string]>().mockResolvedValue('OK');
    const setex = jest.fn<Promise<unknown>, [string, number, string]>().mockResolvedValue('OK');
    return { client: { get, set, setex } as unknown as Redis, get, set, setex };
}

it('旧读取方可 JSON 解析新 envelope，但按旧异常分支抛出未解码对象', async () => {
    const harness = createLegacyRedisHarness();
    const envelope = {
        kind: '@jintianxiayu/cache-decorator/error',
        version: 1,
        payload: { type: 'error', name: 'Error', message: 'not found' },
    };
    harness.get.mockResolvedValue(JSON.stringify({ error: envelope }));

    const legacyEntry = await readLegacyRedisCache(harness.client, 'users:1');
    let legacyThrown: unknown;
    try {
        if (typeof legacyEntry === 'object' && legacyEntry !== null && 'error' in legacyEntry) {
            throw legacyEntry.error;
        }
    } catch (error) {
        legacyThrown = error;
    }

    expect(harness.get).toHaveBeenCalledWith('users:1');
    expect(legacyThrown).toEqual(envelope);
    expect(legacyThrown).not.toBeInstanceOf(Error);
});

it('旧写入 helper 保持原 key、JSON 内容与秒级 TTL 请求', async () => {
    const harness = createLegacyRedisHarness();

    await writeLegacyRedisCache(harness.client, 'users:1', { value: { id: 1 } }, 30);
    await writeLegacyRedisCache(harness.client, 'users:2', { value: { id: 2 } });

    expect(harness.setex).toHaveBeenCalledWith('users:1', 30, '{"value":{"id":1}}');
    expect(harness.set).toHaveBeenCalledWith('users:2', '{"value":{"id":2}}');
});
