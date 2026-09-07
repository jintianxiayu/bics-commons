/** Redis 缓存使用的最小字符串命令边界，连接及其生命周期由调用方持有。 */
export interface RedisCacheClient {
    /**
     * 读取逻辑缓存键对应的字符串值。
     * @param key 未经 Provider 改写的逻辑缓存键。
     * @returns 缓存字符串；键不存在时返回 null。
     * @throws 客户端命令失败时传播原始错误。
     */
    get(key: string): Promise<string | null>;

    /**
     * 写入已经由 Provider 序列化的缓存字符串。
     * @param request 逻辑缓存键、字符串值及可选的秒级 TTL。
     * @returns 命令成功后完成。
     * @throws 客户端命令失败时传播原始错误。
     */
    set(request: { readonly key: string; readonly value: string; readonly ttlSeconds?: number }): Promise<void>;

    /**
     * 批量删除逻辑缓存键；空数组不得发送无参数 DEL。
     * @param keys 保持调用顺序的逻辑缓存键集合。
     * @returns 删除命令成功后完成。
     * @throws 客户端命令失败时传播原始错误。
     */
    deleteMany(keys: readonly string[]): Promise<void>;

    /**
     * 按逻辑 glob pattern 扫描一页缓存键。
     * @param request 当前游标、逻辑 pattern 和本页数量提示。
     * @returns 下一游标及已经恢复为逻辑形式的缓存键。
     * @throws 客户端命令失败或响应不受支持时传播错误。
     */
    scan(request: { readonly cursor: string; readonly pattern: string; readonly count: number }): Promise<{
        readonly cursor: string;
        readonly keys: readonly string[];
    }>;

    /**
     * 清空客户端当前选择的整个 Redis 数据库。
     * @returns 清库命令成功后完成。
     * @throws 客户端命令失败时传播原始错误。
     */
    flushDatabase(): Promise<void>;
}

/** ioredis 适配器实际使用的命令形状，避免公共声明依赖完整客户端类型。 */
export interface IoredisCacheClientSource {
    /** 调用方连接的现有选项；适配器只读取 keyPrefix。 */
    readonly options: { readonly keyPrefix?: string };

    /**
     * 读取由 ioredis 自行应用 keyPrefix 的逻辑键。
     * @param key 逻辑缓存键。
     * @returns ioredis 原始 GET 响应。
     * @throws 客户端命令错误。
     */
    get(key: string): Promise<unknown>;

    /**
     * 不带过期时间写入由 ioredis 自行应用 keyPrefix 的逻辑键。
     * @param key 逻辑缓存键。
     * @param value 已序列化的缓存字符串。
     * @returns ioredis 原始 SET 响应。
     * @throws 客户端命令错误。
     */
    set(key: string, value: string): Promise<unknown>;

    /**
     * 使用秒级 TTL 写入由 ioredis 自行应用 keyPrefix 的逻辑键。
     * @param key 逻辑缓存键。
     * @param ttlSeconds 正整数秒级 TTL。
     * @param value 已序列化的缓存字符串。
     * @returns ioredis 原始 SETEX 响应。
     * @throws 客户端命令错误。
     */
    setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;

    /**
     * 删除由 ioredis 自行应用 keyPrefix 的逻辑键。
     * @param keys 保持调用顺序的逻辑缓存键。
     * @returns ioredis 原始 DEL 响应。
     * @throws 客户端命令错误。
     */
    del(...keys: string[]): Promise<unknown>;

    /**
     * 使用 ioredis 的五段 SCAN 参数形状扫描物理键。
     * @param args 游标、MATCH、物理 pattern、COUNT 和数量提示。
     * @returns ioredis 原始 tuple SCAN 响应。
     * @throws 客户端命令错误。
     */
    scan(...args: [cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', limit: number]): Promise<unknown>;

    /**
     * 清空连接当前选择的 Redis 数据库。
     * @returns ioredis 原始 FLUSHDB 响应。
     * @throws 客户端命令错误。
     */
    flushdb(): Promise<unknown>;
}

/** node-redis 适配器实际使用的命令形状，避免公共声明依赖完整客户端类型。 */
export interface NodeRedisCacheClientSource {
    /**
     * 读取已经应用适配器前缀的物理键。
     * @param key 物理缓存键。
     * @returns node-redis 原始 GET 响应。
     * @throws 客户端命令错误。
     */
    get(key: string): Promise<unknown>;

    /**
     * 不带过期时间写入已经应用适配器前缀的物理键。
     * @param key 物理缓存键。
     * @param value 已序列化的缓存字符串。
     * @returns node-redis 原始 SET 响应。
     * @throws 客户端命令错误。
     */
    set(key: string, value: string): Promise<unknown>;

    /**
     * 使用秒级 TTL 写入已经应用适配器前缀的物理键。
     * @param key 物理缓存键。
     * @param ttlSeconds 正整数秒级 TTL。
     * @param value 已序列化的缓存字符串。
     * @returns node-redis 原始 SETEX 响应。
     * @throws 客户端命令错误。
     */
    setEx(key: string, ttlSeconds: number, value: string): Promise<unknown>;

    /**
     * 删除一个或多个已经应用适配器前缀的物理键。
     * @param keys 单个物理键或保持调用顺序的物理键数组。
     * @returns node-redis 原始 DEL 响应。
     * @throws 客户端命令错误。
     */
    del(keys: string | string[]): Promise<unknown>;

    /**
     * 使用 node-redis 的对象选项扫描物理键。
     * @param cursor 当前 Redis 游标。
     * @param options 物理 MATCH pattern 和本页数量提示。
     * @returns node-redis 原始对象 SCAN 响应。
     * @throws 客户端命令错误。
     */
    scan(cursor: string, options: { MATCH: string; COUNT: number }): Promise<unknown>;

    /**
     * 清空连接当前选择的 Redis 数据库。
     * @returns node-redis 原始 FLUSHDB 响应。
     * @throws 客户端命令错误。
     */
    flushDb(): Promise<unknown>;
}

/** node-redis 没有透明 keyPrefix，通过适配器显式保持逻辑命名空间。 */
export interface NodeRedisCacheClientOptions {
    /** 拼接到每个逻辑 key 前的字面字符串，缺省为空字符串。 */
    readonly keyPrefix?: string;
}
