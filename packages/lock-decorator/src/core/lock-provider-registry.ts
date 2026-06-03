import { LockProvider } from './lock-provider';

/** 全局锁提供者注册表 */
export class LockProviderRegistry {
    private static providers = new Map<string, LockProvider>();
    private static defaultName: string | null = null;

    /**
     * 注册锁提供者
     * @param name 提供者名称
     * @param provider 锁提供者实例
     */
    static register(name: string, provider: LockProvider): void {
        this.providers.set(name, provider);
    }

    /**
     * 注册锁提供者（register 的别名）
     */
    static add(name: string, provider: LockProvider): void {
        this.register(name, provider);
    }

    /**
     * 获取锁提供者
     * @param name 提供者名称，不指定则使用默认提供者
     * @returns 锁提供者实例
     * @throws 未注册且无默认提供者时抛出错误
     */
    static get(name?: string): LockProvider {
        if (name) {
            const provider = this.providers.get(name);
            if (!provider) {
                throw new Error(`CacheProvider "${name}" not found`);
            }
            return provider;
        }
        if (this.defaultName) {
            const provider = this.providers.get(this.defaultName);
            if (!provider) {
                throw new Error(`CacheProvider "${this.defaultName}" not found`);
            }
            return provider;
        }
        throw new Error('No CacheProvider registered and no default set');
    }

    /**
     * 设置默认锁提供者
     * @param name 提供者名称
     * @throws 提供者未注册时抛出错误
     */
    static setDefault(name: string): void {
        if (!this.providers.has(name)) {
            throw new Error(`CacheProvider "${name}" not found`);
        }
        this.defaultName = name;
    }

    /** 清空注册表 */
    static clear(): void {
        this.providers.clear();
        this.defaultName = null;
    }
}
