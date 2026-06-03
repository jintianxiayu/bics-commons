import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { MemoryCacheProvider } from '../src/core/native-cache';

describe('CacheProviderRegistry', () => {
    let memoryProvider: MemoryCacheProvider;

    beforeEach(() => {
        memoryProvider = new MemoryCacheProvider();
        CacheProviderRegistry.register('memory', memoryProvider);
    });

    afterEach(() => {
        CacheProviderRegistry.clear();
    });

    describe('register & get', () => {
        it('应注册并获取 Provider', () => {
            expect(CacheProviderRegistry.get('memory')).toBe(memoryProvider);
        });

        it('应在 Provider 不存在时抛出错误', () => {
            expect(() => CacheProviderRegistry.get('nonexistent')).toThrow();
        });
    });

    describe('setDefault & get', () => {
        it('应设置并获取默认 Provider', () => {
            CacheProviderRegistry.setDefault('memory');
            expect(CacheProviderRegistry.get()).toBe(memoryProvider);
        });

        it('应在未设置默认且未指定时抛出错误', () => {
            expect(() => CacheProviderRegistry.get()).toThrow();
        });
    });
});
