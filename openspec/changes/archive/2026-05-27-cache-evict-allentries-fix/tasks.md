# Tasks: cache-evict-allentries-fix

## 1. 接口更新

- [x] 1.1 在 `CacheProvider` 接口中新增 `deleteByPattern(pattern: string): void | Promise<void>` 方法签名

## 2. MemoryCacheProvider 实现

- [x] 2.1 修改 `MemoryCacheProvider.deleteByPattern` 方法签名，参数从 `predicate: (key: string) => boolean` 改为 `pattern: string`
- [x] 2.2 实现基于 `startsWith` 的前缀匹配逻辑（去除末尾 `*`，剩余部分作为 prefix）
- [x] 2.3 运行单元测试验证 MemoryCacheProvider 功能正常

## 3. RedisCacheProvider 实现

- [x] 3.1 修改 `RedisCacheProvider.deleteByPattern` 方法签名，参数从 `pattern: string` 保持一致
- [x] 3.2 实现 `SCAN` 游标迭代删除逻辑，每次 `COUNT 100`，循环直到 `cursor === '0'`
- [x] 3.3 运行单元测试验证 RedisCacheProvider 功能正常

## 4. CacheEvict 装饰器改造

- [x] 4.1 修改 `cache-evict.ts` 中 `allEntries: true` 的逻辑，从 `provider.clear()` 改为 `provider.deleteByPattern(cacheName + '*')`
- [x] 4.2 运行现有测试确保无回归

## 5. 优化代码

- [x] 5.1 通过 simplify 技能优化代码（无问题发现）

## 6. 测试覆盖

- [x] 5.1 新增 MemoryCacheProvider `deleteByPattern` 前缀匹配测试用例
- [x] 5.2 新增 CacheEvict `allEntries=true` 精确清除同名缓存的测试用例
- [x] 5.3 验证其他缓存名称不受影响（cars:* 保持不变）

## 7. 文档更新

- [x] 6.1 检查 `cache-decorator/README.md` 是否需要更新 `allEntries` 行为说明
- [x] 6.2 更新 JSDoc 注释（如需要）