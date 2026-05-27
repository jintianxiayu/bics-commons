# Proposal: cache-evict-allentries-fix

## Why

`@CacheEvict` 装饰器在 `allEntries: true` 时会调用 `provider.clear()` 清除缓存提供者中的**所有缓存**。这与用户预期不符——用户期望只清除指定 `cacheName` 下的缓存条目，而非影响同一 provider 中的其他缓存名称。

**问题场景**：provider 中有 `name:1`、`name:2`、`cars:aa`、`cars:bb`，当执行 `@CacheEvict('name', {allEntries: true})` 时，`cars:*` 缓存被意外清除。

## What Changes

1. **CacheProvider 接口新增 `deleteByPattern` 方法**
   - 签名: `deleteByPattern(pattern: string): void | Promise<void>`
   - 通过 glob 前缀模式删除匹配的缓存 key

2. **MemoryCacheProvider 实现**
   - 实现 `deleteByPattern`，使用 `startsWith` 做前缀匹配
   - 遍历所有 key，删除匹配 `pattern + '*'` 的条目

3. **RedisCacheProvider 实现**
   - 实现 `deleteByPattern`，使用 `SCAN` 游标迭代（非阻塞）
   - 每次 `SCAN COUNT 100`，分批删除匹配 keys

4. **CacheEvict 装饰器改造**
   - `allEntries: true` 时调用 `provider.deleteByPattern(cacheName + '*')` 而非 `provider.clear()`

5. **测试覆盖**
   - 新增 `allEntries=true` 按缓存名精确清除的测试用例

## Capabilities

### New Capabilities

- `cache-evict-allentries-prefix`: `@CacheEvict` 装饰器在 `allEntries: true` 时，按缓存名称前缀精确清除对应缓存条目，不影响同一 provider 中其他缓存名称的缓存。

### Modified Capabilities

- `cache-key-option`: 现有 spec 中 "allEntries 为 true 时忽略 key 选项" 的实现需要修改，从 `provider.clear()` 改为 `provider.deleteByPattern(cacheName + '*')`。

## Impact

###  Affected Modules

- `packages/cache-decorator/src/core/cache-provider.ts` — 接口新增方法
- `packages/cache-decorator/src/core/native-cache.ts` — MemoryCacheProvider 实现
- `packages/cache-decorator/src/core/redis-cache.ts` — RedisCacheProvider 实现
- `packages/cache-decorator/src/decorators/cache-evict.ts` — 逻辑修改

### Breaking Change

- **否**：向后兼容，只在 `allEntries: true` 时行为变更（原为清空所有，现为精确清除同名缓存）
- 现有未使用 `allEntries: true` 的代码不受影响

### Rollback Plan

- 回滚方式：还原 `cache-evict.ts` 中的 `provider.clear()` 调用，移除 `CacheProvider` 接口中的 `deleteByPattern` 方法声明
- 测试覆盖：已有测试应全部通过，新功能有独立测试用例保障

### Performance Impact

- MemoryCacheProvider: O(n) 遍历，当前实现已存在（`deleteByPattern` 方法已有），无额外开销
- RedisCacheProvider: 使用 `SCAN` 替代 `KEYS`，每次迭代返回少量 keys，不会阻塞 Redis 主线程，预计延迟在可接受范围内