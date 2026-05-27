# Tasks: cache-decorator-add-key-option

## 1. 代码实现

- [x] 1.1 修改 `CacheOptions` 接口，新增 `key` 可选字段
- [x] 1.2 修改 `CacheEvictOptions` 接口，新增 `key` 可选字段
- [x] 1.3 在 `decorators/cache.ts` 中实现 `resolveCacheKey` 辅助函数
- [x] 1.4 在 `decorators/cache-evict.ts` 中实现 `resolveCacheKey` 辅助函数
- [x] 1.5 修改 `@Cache` 装饰器，使用 `resolveCacheKey` 生成缓存 key
- [x] 1.6 修改 `@CacheEvict` 装饰器，使用 `resolveCacheKey` 生成缓存 key，处理 `allEntries: true` 忽略 key 的逻辑

## 2. 单元测试

- [x] 2.1 在 `cache.test.ts` 中新增 `@Cache` key 选项测试用例（覆盖 undefined/null/string/function/异常降级）
- [x] 2.2 在 `cache-evict.test.ts` 中新增 `@CacheEvict` key 选项测试用例（覆盖 string/function/allEntries）
- [x] 2.3 运行所有测试确保通过

## 3. 文档更新

- [x] 3.1 更新 `cache-decorator/README.md`，添加 key 选项使用说明和示例