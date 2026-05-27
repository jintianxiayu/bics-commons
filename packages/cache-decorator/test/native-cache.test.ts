import { MemoryCacheProvider } from '../src/core/native-cache';

describe('MemoryCacheProvider', () => {
  let provider: MemoryCacheProvider;

  beforeEach(() => {
    provider = new MemoryCacheProvider();
  });

  describe('get & set', () => {
    it('应返回已缓存的值', () => {
      provider.set('key1', 'value1');
      expect(provider.get('key1')).toBe('value1');
    });

    it('应返回 undefined 对不存在的键', () => {
      expect(provider.get('nonexistent')).toBeUndefined();
    });
  });

  describe('TTL', () => {
    it('应在 TTL 后失效', () => {
      jest.useFakeTimers();

      provider.set('key1', 'value1', 5);
      expect(provider.get('key1')).toBe('value1');

      jest.advanceTimersByTime(5001);
      expect(provider.get('key1')).toBeUndefined();

      jest.useRealTimers();
    });

    it('无 TTL 时不应失效', () => {
      provider.set('key1', 'value1');
      expect(provider.get('key1')).toBe('value1');
    });
  });

  describe('delete', () => {
    it('应删除指定键', () => {
      provider.set('key1', 'value1');
      provider.delete('key1');
      expect(provider.get('key1')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('应清除所有缓存', () => {
      provider.set('key1', 'value1');
      provider.set('key2', 'value2');
      provider.clear();
      expect(provider.get('key1')).toBeUndefined();
      expect(provider.get('key2')).toBeUndefined();
    });
  });

  describe('deleteByPattern', () => {
    it('应删除匹配模式的键', () => {
      provider.set('user:1', 'user1');
      provider.set('user:2', 'user2');
      provider.set('order:1', 'order1');

      provider.deleteByPattern('user:*');

      expect(provider.get('user:1')).toBeUndefined();
      expect(provider.get('user:2')).toBeUndefined();
      expect(provider.get('order:1')).toBe('order1');
    });
  });
});