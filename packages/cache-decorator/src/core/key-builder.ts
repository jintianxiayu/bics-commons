/**
 * 缓存 Key 构建器
 * 负责将缓存名称和参数转换为统一的 key 字符串
 */
export class KeyBuilder {
    /**
     * 构建缓存 key
     * @param cacheName 缓存名称
     * @param args 方法参数列表
     * @returns 格式为 {cacheName}:{serializedArgs} 的 key 字符串
     */
    static build(cacheName: string, args: unknown[]): string {
        if (args.length === 0) {
            return cacheName;
        }
        const serializedArgs = args
            .map((arg) => {
                if (arg === null || arg === undefined) return 'null';
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            })
            .join('&');
        return `${cacheName}:${serializedArgs}`;
    }
}
