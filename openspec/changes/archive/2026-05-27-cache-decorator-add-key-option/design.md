# Design: cache-decorator-add-key-option

## Context

当前 `@Cache` 和 `@CacheEvict` 装饰器使用 `KeyBuilder.build(cacheName, args)` 固定生成缓存 key，格式为 `cacheName:serializedArgs`。当业务需要更灵活的控制时（如只基于某个特定字段生成 key），无法满足需求。

参考 `@bics/lock-decorator` 中 `@DistributedLock` 装饰器的 `key` 选项设计，扩展缓存装饰器支持自定义 key 生成逻辑。

## Goals / Non-Goals

**Goals:**
- 为 `@Cache` 和 `@CacheEvict` 增加可选的 `key` 配置项
- 支持 `string` 和 `function` 两种自定义 key 生成方式
- 保持向后兼容，`key` 为 `undefined/null` 时沿用现有逻辑

**Non-Goals:**
- 不修改 `KeyBuilder` 类的现有逻辑
- 不改变缓存存储结构（仍使用 cacheName 作为前缀）

## Decisions

### 1. 新增 `key` 选项类型

```typescript
type CacheKeyResolver = null | string | ((...args: unknown[]) => string);
```

与 `@DistributedLock` 的 `key` 选项保持一致，支持三种形式：
- `null`: 沿用现有自动生成逻辑
- `string`: 直接作为 key 值的一部分（最终为 `cacheName:myKey`）
- `function`: 接收方法参数数组，返回自定义字符串

### 2. `resolveCacheKey` 统一函数

```typescript
function resolveCacheKey(cacheName: string, key: CacheKeyResolver | undefined, args: unknown[]): string {
  if (key === undefined || key === null) {
    return KeyBuilder.build(cacheName, args);  // 现有逻辑
  }
  if (typeof key === 'string') {
    return KeyBuilder.build(cacheName, [key]);  // cacheName:myKey
  }
  return KeyBuilder.build(cacheName, [key(...args)]);  // cacheName:functionResult
}
```

### 3. `@CacheEvict` 的 `allEntries` 行为

当 `allEntries: true` 时，执行 `provider.clear()`，忽略 `key` 选项。原因：`clear()` 会清除 provider 的所有缓存，按 cacheName 过滤无实际意义。

### 4. 模块变更

| 文件 | 变更 |
|------|------|
| `decorators/cache.ts` | 新增 `CacheOptions.key` 字段，新增 `resolveCacheKey` 函数 |
| `decorators/cache-evict.ts` | 新增 `CacheEvictOptions.key` 字段，新增 `resolveCacheKey` 函数 |
| `test/decorators/cache.test.ts` | 新增 key 选项测试用例 |
| `test/decorators/cache-evict.test.ts` | 新增 key 选项测试用例 |

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| key 函数抛出异常导致缓存操作失败 | 在装饰器中捕获异常，降级到原逻辑（可用 warn 日志） |
| 过度复杂的 key 函数影响性能 | key 函数设计应简洁，避免重度计算 |

## Open Questions

无

## 测试计划

按模块划分，覆盖所有分支：

### @Cache 装饰器
- `key = undefined`: 沿用 `KeyBuilder.build(cacheName, args)`
- `key = null`: 沿用 `KeyBuilder.build(cacheName, args)`
- `key = string`: 使用 `KeyBuilder.build(cacheName, [key])`
- `key = function`: 调用函数后使用 `KeyBuilder.build(cacheName, [result])`
- `key` 函数异常: 降级到自动生成

### @CacheEvict 装饰器
- `allEntries: false` + 各 `key` 类型: 行为与 `@Cache` 一致
- `allEntries: true`: 忽略 `key`，执行 `provider.clear()`