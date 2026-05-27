import { Cache } from '../src/decorators/cache';
import { CacheEvict } from '../src/decorators/cache-evict';
import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { MemoryCacheProvider } from '../src/core/native-cache';

describe('@CacheEvict 装饰器', () => {
  let memoryProvider: MemoryCacheProvider;

  beforeAll(() => {
    memoryProvider = new MemoryCacheProvider();
    CacheProviderRegistry.register('memory', memoryProvider);
    CacheProviderRegistry.setDefault('memory');
  });

  afterEach(() => {
    memoryProvider.clear();
  });

  describe('按入参清除', () => {
    it('应清除对应缓存条目', async () => {
      let getUserCallCount = 0;
      let updateUserCallCount = 0;

      class UserService {
        @Cache('user-cache')
        async getUser(id: number) {
          getUserCallCount++;
          return { id };
        }

        @CacheEvict('user-cache')
        async updateUser(id: number) {
          updateUserCallCount++;
          return { id, updated: true };
        }
      }

      const service = new UserService();
      await service.getUser(1);
      await service.getUser(1);
      expect(getUserCallCount).toBe(1);

      await service.updateUser(1);
      await service.getUser(1);
      expect(getUserCallCount).toBe(2);
      expect(updateUserCallCount).toBe(1);
    });
  });

  describe('清除所有条目', () => {
    it('应清除该缓存名称下所有条目', async () => {
      let getUserCallCount = 0;
      let getOrderCallCount = 0;
      let clearCallCount = 0;

      class Service {
        @Cache('user-cache')
        async getUser(id: number) {
          getUserCallCount++;
          return { id };
        }

        @Cache('order-cache')
        async getOrder(id: number) {
          getOrderCallCount++;
          return { id };
        }

        @CacheEvict('user-cache', { allEntries: true })
        async clearAllUsers() {
          clearCallCount++;
          return true;
        }
      }

      const service = new Service();
      await service.getUser(1);
      await service.getUser(2);
      await service.getOrder(1);
      expect(getUserCallCount).toBe(2);
      expect(getOrderCallCount).toBe(1);

      await service.clearAllUsers();
      expect(clearCallCount).toBe(1);

      await service.getUser(1);
      await service.getUser(2);
      await service.getOrder(1);
      expect(getUserCallCount).toBe(4);
      expect(getOrderCallCount).toBe(2);
    });
  });
});