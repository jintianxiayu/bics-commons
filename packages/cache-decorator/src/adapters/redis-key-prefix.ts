const REDIS_GLOB_META_CHARACTERS = new Set(['\\', '*', '?', '[', ']']);

/**
 * 将普通字符串转换为 Redis glob pattern 中的字面量片段。
 * @param value 仅作为字面前缀使用的字符串。
 * @returns 对反斜杠、星号、问号和方括号增加反斜杠转义后的片段。
 */
export function escapeRedisGlobLiteral(value: string): string {
    let escaped = '';
    for (const character of value) {
        escaped += REDIS_GLOB_META_CHARACTERS.has(character) ? `\\${character}` : character;
    }
    return escaped;
}

/**
 * 为逻辑 glob pattern 增加按字面量解释的 Redis key 前缀。
 * @param keyPrefix 调用方配置的物理 key 前缀。
 * @param pattern Provider 传入且需要保留 glob 语义的逻辑 pattern。
 * @returns 可直接交给 Redis SCAN MATCH 的物理 pattern。
 */
export function createRedisScanPattern(keyPrefix: string, pattern: string): string {
    return `${escapeRedisGlobLiteral(keyPrefix)}${pattern}`;
}

/**
 * 验证扫描结果属于指定物理命名空间并恢复逻辑 key。
 * @param keyPrefix 调用方配置的物理 key 前缀。
 * @param physicalKey Redis SCAN 返回的物理 key。
 * @returns 只剥离一次字面前缀后的逻辑 key。
 * @throws 扫描结果不属于指定前缀时抛出 TypeError，避免扩大后续删除范围。
 */
export function stripRedisKeyPrefix(keyPrefix: string, physicalKey: string): string {
    if (!physicalKey.startsWith(keyPrefix)) {
        throw new TypeError('Redis SCAN returned a key outside the configured key prefix');
    }
    return physicalKey.slice(keyPrefix.length);
}
