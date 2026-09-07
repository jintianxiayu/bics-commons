import { NodeRedisCacheClientOptions, NodeRedisCacheClientSource, RedisCacheClient } from '../core/redis-cache-client';
import { createRedisScanPattern, stripRedisKeyPrefix } from './redis-key-prefix';

function normalizeGetResponse(response: unknown): string | null {
    if (typeof response === 'string' || response === null) {
        return response;
    }
    throw new TypeError('Expected Redis GET to return a string or null');
}

function validateOkResponse(command: string, response: unknown): void {
    if (response !== 'OK') {
        throw new TypeError(`Expected Redis ${command} to return "OK"`);
    }
}

function validateDeleteResponse(response: unknown): void {
    if (typeof response !== 'number' || !Number.isInteger(response) || response < 0) {
        throw new TypeError('Expected Redis DEL to return a non-negative integer');
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeScanResponse(
    response: unknown,
    keyPrefix: string
): { readonly cursor: string; readonly keys: readonly string[] } {
    if (
        !isRecord(response) ||
        typeof response.cursor !== 'string' ||
        !Array.isArray(response.keys) ||
        !response.keys.every((key: unknown) => typeof key === 'string')
    ) {
        throw new TypeError('Expected node-redis SCAN to return a { cursor, keys } object');
    }
    return {
        cursor: response.cursor,
        keys: response.keys.map((key: string) => stripRedisKeyPrefix(keyPrefix, key)),
    };
}

/**
 * 将调用方的 node-redis 连接适配为客户端无关的缓存命令，不创建或关闭连接。
 * @param client 使用默认字符串响应映射的 node-redis 普通客户端。
 * @param options 可选的字面 key 前缀；缺省时不改写逻辑 key。
 * @returns 复用该连接并统一物理 key 前缀的 Redis 缓存客户端。
 * @throws 返回对象的命令方法传播客户端错误；非标准响应拒绝为 TypeError。
 */
export function createNodeRedisCacheClient(
    client: NodeRedisCacheClientSource,
    options?: NodeRedisCacheClientOptions
): RedisCacheClient {
    const keyPrefix = options?.keyPrefix ?? '';
    const createPhysicalKey = (key: string): string => `${keyPrefix}${key}`;
    return {
        /** @inheritdoc */
        async get(key: string): Promise<string | null> {
            return normalizeGetResponse(await client.get(createPhysicalKey(key)));
        },
        /** @inheritdoc */
        async set({ key, value, ttlSeconds }): Promise<void> {
            const physicalKey = createPhysicalKey(key);
            if (ttlSeconds === undefined) {
                validateOkResponse('SET', await client.set(physicalKey, value));
                return;
            }
            validateOkResponse('SETEX', await client.setEx(physicalKey, ttlSeconds, value));
        },
        /** @inheritdoc */
        async deleteMany(keys: readonly string[]): Promise<void> {
            if (keys.length === 0) {
                return;
            }
            validateDeleteResponse(await client.del(keys.map(createPhysicalKey)));
        },
        /** @inheritdoc */
        async scan({ cursor, pattern, count }): Promise<{
            readonly cursor: string;
            readonly keys: readonly string[];
        }> {
            const response = await client.scan(cursor, {
                MATCH: createRedisScanPattern(keyPrefix, pattern),
                COUNT: count,
            });
            return normalizeScanResponse(response, keyPrefix);
        },
        /** @inheritdoc */
        async flushDatabase(): Promise<void> {
            validateOkResponse('FLUSHDB', await client.flushDb());
        },
    };
}
