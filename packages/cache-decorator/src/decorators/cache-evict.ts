import { CacheProviderRegistry } from '../core/cache-provider-registry';
import { KeyBuilder } from '../core/key-builder';
import { CacheOptions, CacheKeyResolver } from './cache';

/**
 * @CacheEvict 装饰器配置项
 */
export interface CacheEvictOptions extends Pick<CacheOptions, 'key'> {
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
 * 解析缓存 key
 * @param cacheName 缓存名称
 * @param keyResolver key 解析器
 * @param args 方法参数数组
 * @returns 解析后的缓存 key
 */
function resolveCacheKey(cacheName: string, keyResolver: CacheKeyResolver | undefined, args: unknown[]): string {
  if (keyResolver === undefined || keyResolver === null) {
    return KeyBuilder.build(cacheName, args);
  }
  if (typeof keyResolver === 'string') {
    return KeyBuilder.build(cacheName, [keyResolver]);
  }
  try {
    return KeyBuilder.build(cacheName, [keyResolver(...args)]);
  } catch {
    return KeyBuilder.build(cacheName, args);
  }
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
        await provider.deleteByPattern(cacheName + '*');
      } else {
        const cacheKey = resolveCacheKey(cacheName, options?.key, args);
        provider.delete(cacheKey);
      }

      return result;
    };
  };
}

export { CacheProviderRegistry } from '../core/cache-provider-registry';