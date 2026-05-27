# Proposal: cache-decorator-add-key-option

## Why

当前 `@Cache` 和 `@CacheEvict` 装饰器使用固定逻辑生成缓存 key（`cacheName:serializedArgs`），无法满足复杂业务场景下的自定义需求。例如，当需要基于方法入参的特定字段（如用户 ID）而非全部参数生成 key 时，现有实现无法支持。

参考 `@bics/lock-decorator` 中 `@DistributedLock` 装饰器的 `key` 选项设计，为缓存装饰器增加类似的可选配置。

## What Changes

- **`CacheOptions` 接口**：新增可选的 `key` 字段，支持 `null | string | ((...args: unknown[]) => string)` 三种形式
- **`CacheEvictOptions` 接口**：同样新增 `key` 字段，行为与 `@Cache` 一致
- **`@Cache` 装饰器**：当 `key` 为 `undefined/null` 时沿用现有逻辑；为 `string` 时使用 `KeyBuilder.build(cacheName, [key])` 生成 key；为函数时调用 `key(...args)` 生成后放入数组
- **`@CacheEvict` 装饰器**：逻辑与 `@Cache` 一致。`allEntries: true` 时忽略 `key`，执行 `provider.clear()`
- **新增单元测试**：覆盖各种 `key` 选项组合

## Capabilities

### New Capabilities

- `cache-key-option`: 为 `@Cache` 和 `@CacheEvict` 装饰器增加可选的 `key` 配置项，支持自定义缓存 key 生成逻辑

## Impact

- **受影响模块**: `packages/cache-decorator/src/decorators/cache.ts`, `packages/cache-decorator/src/decorators/cache-evict.ts`
- **测试文件**: `packages/cache-decorator/test/decorators/cache.test.ts`, `packages/cache-decorator/test/decorators/cache-evict.test.ts`
- **Breaking Change**: 否，向后兼容
- **性能影响**: 无显著影响，key 生成逻辑简单

### 回滚计划

若变更实施后发现问题，可通过以下方式回滚：

1. 从 Git 恢复 `cache.ts` 和 `cache-evict.ts` 的原始版本
2. 删除新增的测试用例
3. 发布补丁版本覆盖

### 风险评估

- **低风险**: 纯功能扩展，未修改现有行为
- **兼容性**: 现有代码无需修改，`key` 选项为可选