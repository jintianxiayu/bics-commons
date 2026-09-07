import { IoredisCacheClientSource, RedisCacheClient } from '../core/redis-cache-client';
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

function normalizeScanResponse(
    response: unknown,
    keyPrefix: string
): { readonly cursor: string; readonly keys: readonly string[] } {
    if (
        !Array.isArray(response) ||
        response.length !== 2 ||
        typeof response[0] !== 'string' ||
        !Array.isArray(response[1]) ||
        !response[1].every((key: unknown) => typeof key === 'string')
    ) {
        throw new TypeError('Expected ioredis SCAN to return a [cursor, keys] tuple');
    }
    return {
        cursor: response[0],
        keys: response[1].map((key: string) => stripRedisKeyPrefix(keyPrefix, key)),
    };
}

/**
 * 将调用方的 ioredis 连接适配为客户端无关的缓存命令，不创建或关闭连接。
 * @param client 使用默认字符串响应映射的 ioredis 普通客户端。
 * @returns 复用该连接并恢复逻辑 key 的 Redis 缓存客户端。
 * @throws 返回对象的命令方法传播客户端错误；非标准响应拒绝为 TypeError。
 */
export function createIoredisCacheClient(client: IoredisCacheClientSource): RedisCacheClient {
    const keyPrefix = client.options.keyPrefix ?? '';
    return {
        /** @inheritdoc */
        async get(key: string): Promise<string | null> {
            return normalizeGetResponse(await client.get(key));
        },
        /** @inheritdoc */
        async set({ key, value, ttlSeconds }): Promise<void> {
            if (ttlSeconds === undefined) {
                validateOkResponse('SET', await client.set(key, value));
                return;
            }
            validateOkResponse('SETEX', await client.setex(key, ttlSeconds, value));
        },
        /** @inheritdoc */
        async deleteMany(keys: readonly string[]): Promise<void> {
            if (keys.length === 0) {
                return;
            }
            validateDeleteResponse(await client.del(...keys));
        },
        /** @inheritdoc */
        async scan({ cursor, pattern, count }): Promise<{
            readonly cursor: string;
            readonly keys: readonly string[];
        }> {
            const response = await client.scan(
                cursor,
                'MATCH',
                createRedisScanPattern(keyPrefix, pattern),
                'COUNT',
                count
            );
            return normalizeScanResponse(response, keyPrefix);
        },
        /** @inheritdoc */
        async flushDatabase(): Promise<void> {
            validateOkResponse('FLUSHDB', await client.flushdb());
        },
    };
}
