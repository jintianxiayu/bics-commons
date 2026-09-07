/** Redis 锁的最小命令边界，使锁协议独立于客户端并复用调用方连接。 */
export interface RedisLockClient {
    /**
     * 原子写入尚不存在的键并设置过期时间。
     * @param request 原始 key、锁值和毫秒 TTL，全部必填。
     * @returns 写入成功为 true，键已存在为 false。
     * @throws 客户端命令失败时传播原始错误。
     */
    setIfAbsent(request: { readonly key: string; readonly value: string; readonly ttlMs: number }): Promise<boolean>;

    /**
     * 原子执行脚本，避免比较 token 与更新锁之间发生竞争。
     * @param request 脚本及按顺序传入的键、字符串参数；数组可为空。
     * @returns 客户端的原始脚本响应。
     * @throws 客户端或脚本失败时传播原始错误。
     */
    eval(request: {
        readonly script: string;
        readonly keys: readonly string[];
        readonly arguments: readonly string[];
    }): Promise<unknown>;
}

/** ioredis 适配器使用的命令形状，避免公共声明依赖完整客户端类型。 */
export interface IoredisLockClientSource {
    /**
     * 提供 ioredis 的原子 NX/PX 写入。
     * @param args 原始键、值、PX、毫秒 TTL 和 NX。
     * @returns 原始 SET 响应。
     * @throws 客户端命令错误。
     */
    set(...args: [key: string, value: string, expiry: 'PX', ttlMs: number, condition: 'NX']): Promise<unknown>;

    /**
     * 提供 ioredis 的脚本调用。
     * @param script Lua 脚本。
     * @param numberOfKeys 键的数量。
     * @param args 键在前、脚本参数在后的字符串序列。
     * @returns 原始脚本响应。
     * @throws 客户端或脚本错误。
     */
    eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

/** node-redis 适配器使用的命令形状，连接与响应映射由调用方配置。 */
export interface NodeRedisLockClientSource {
    /**
     * 提供 node-redis 的原子 NX/PX 写入。
     * @param key 原始键。
     * @param value 锁值。
     * @param options 毫秒 TTL 和 NX 条件。
     * @returns 原始 SET 响应。
     * @throws 客户端命令错误。
     */
    set(key: string, value: string, options: { PX: number; NX: true }): Promise<unknown>;

    /**
     * 提供 node-redis 的脚本调用。
     * @param script Lua 脚本。
     * @param options 按顺序传入的键和字符串参数。
     * @returns 原始脚本响应。
     * @throws 客户端或脚本错误。
     */
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}
