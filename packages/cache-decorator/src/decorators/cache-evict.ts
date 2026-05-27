import { CacheProviderRegistry } from '../core/cache-provider-registry';
import { KeyBuilder } from '../core/key-builder';

/**
 * @CacheEvict 装饰器配置项
 */
export interface CacheEvictOptions {
  /**
   * 是否清除所有条目，默认为 false
   */
  allEntries?: boolean;

  /**
   * 指定 CacheProvider 名称
   */
  providerName?: string;
}

/**
 * 缓存清除装饰器
 * 在方法执行后清除对应的缓存条目
 * @param cacheName 缓存名称
 * @param options 配置项
 */
export function CacheEvict(cacheName: string, options?: CacheEvictOptions) {
  return function (
    _target: object,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const result = await originalMethod.apply(this, args);

      const providerName = options?.providerName;
      const provider = CacheProviderRegistry.get(providerName);

      if (options?.allEntries) {
        provider.clear();
      } else {
        const cacheKey = KeyBuilder.build(cacheName, args);
        provider.delete(cacheKey);
      }

      return result;
    };
  };
}

export { CacheProviderRegistry } from '../core/cache-provider-registry';