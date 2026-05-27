import { CacheProvider } from './cache-provider';

const providers = new Map<string, CacheProvider>();
let defaultName: string | undefined;

/**
 * 全局缓存提供者注册表
 * 用于注册和获取不同类型的 CacheProvider
 */
export class CacheProviderRegistry {
  /**
   * 注册缓存提供者
   * @param name 提供者名称
   * @param provider 缓存提供者实例
   */
  static register(name: string, provider: CacheProvider): void {
    providers.set(name, provider);
  }

  /**
   * 获取缓存提供者
   * @param name 提供者名称，不指定则使用默认提供者
   * @returns 缓存提供者实例
   * @throws 未注册且无默认提供者时抛出错误
   */
  static get(name?: string): CacheProvider {
    const providerName = name || defaultName;
    if (!providerName) {
      throw new Error('No CacheProvider registered and no default set');
    }
    const provider = providers.get(providerName);
    if (!provider) {
      throw new Error(`CacheProvider "${providerName}" not found`);
    }
    return provider;
  }

  /**
   * 设置默认缓存提供者
   * @param name 提供者名称
   */
  static setDefault(name: string): void {
    defaultName = name;
  }

  /**
   * 清空注册表
   */
  static clear(): void {
    providers.clear();
    defaultName = undefined;
  }
}