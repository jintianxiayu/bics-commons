# Design: cache-evict-allentries-fix

## Context

当前 `@CacheEvict` 装饰器在 `allEntries: true` 时调用 `provider.clear()`，这会清除 provider 中的**所有缓存**。实际使用中，同一个 provider 可能管理多个缓存名称（如 `name:*` 和 `cars:*`），用户期望 `allEntries` 只清除指定缓存名称下的条目。

现有实现：
- `CacheProvider` 接口：`clear()` 无参数，无法指定范围
- `MemoryCacheProvider`：已有 `deleteByPattern(predicate)` 方法但未在接口声明
- `RedisCacheProvider`：已有 `deleteByPattern(pattern)` 方法但未在接口声明

## Goals / Non-Goals

**Goals:**
- `@CacheEvict('name', {allEntries:true})` 只清除 `name:*` 缓存，不影响 `cars:*`
- 新增 `CacheProvider.deleteByPattern()` 接口方法
- MemoryProvider 和 RedisProvider 分别实现该方法

**Non-Goals:**
- 不修改 `allEntries: false` 的行为（单条删除逻辑不变）
- 不修改 `@Cache` 装饰器行为
- 不引入新的缓存 provider 类型

## Decisions

### Decision 1: 使用 Glob Pattern 而非 Predicate

**选择**: `deleteByPattern(pattern: string)`

**理由**:
- Redis 原生支持 glob 模式匹配（`SCAN ... MATCH pattern`）
- MemoryProvider 可用简单的 `startsWith` 前缀匹配
- 用户语义清晰：`cacheName + '*'` 表示该缓存名下的所有条目

**替代方案考虑**:
- Predicate `(key: string) => boolean`：Redis 无法原生支持，需要先 SCAN 全部 key 再过滤，不适合生产环境
- 维护 cacheName→keys 映射：需要额外存储，且加入/超时/清除都要维护映射，实现复杂

### Decision 2: MemoryProvider 使用 startsWith 前缀匹配

**实现**:
```typescript
deleteByPattern(pattern: string): void {
  const prefix = pattern.replace(/\*$/, '');
  for (const key of this.cache.keys()) {
    if (key.startsWith(prefix)) {
      this.cache.delete(key);
    }
  }
}
```

**理由**: 实现简单，当前 `deleteByPattern` 方法已存在，只需修改签名保持一致。

### Decision 3: RedisProvider 使用 SCAN 游标迭代

**选择**: `SCAN cursor MATCH pattern COUNT 100`

**理由**:
- `KEYS pattern` 会阻塞 Redis，在数据量大时可能导致生产事故
- `SCAN` 是游标迭代，每次返回少量 keys，不会阻塞主线程
- 通过多次迭代直到 `cursor === '0'` 完成全量删除

**实现**:
```typescript
async deleteByPattern(pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await this.redis.scan(
      cursor, 'MATCH', pattern, 'COUNT', 100
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  } while (cursor !== '0');
}
```

## Module Design

| 模块 | 文件 | 职责 | 依赖 |
|------|------|------|------|
| 接口 | `cache-provider.ts` | 新增 `deleteByPattern(pattern: string)` 方法签名 | — |
| Memory实现 | `native-cache.ts` | 实现 `deleteByPattern`，使用 startsWith 前缀匹配 | CacheProvider |
| Redis实现 | `redis-cache.ts` | 实现 `deleteByPattern`，使用 SCAN 游标迭代 | CacheProvider, ioredis |
| 装饰器 | `cache-evict.ts` | `allEntries=true` 时调用 `deleteByPattern(cacheName+'*')` | CacheProviderRegistry |

## Risks / Trade-offs

[Risk] MemoryProvider O(n) 遍历
→ Mitigation: MemoryCacheProvider 适用于单机场景，数据量有限，遍历开销可接受

[Risk] Redis SCAN 多次网络往返
→ Mitigation: 每次 COUNT 100，分批删除，单次延迟可控；cursor 迭代确保非阻塞

[Trade-off] 接口签名变更
→ 已有 Provider 实现（如 MemoryCacheProvider.deleteByPattern）需调整签名以匹配接口

## Migration Plan

1. 新增 `deleteByPattern` 方法到 `CacheProvider` 接口
2. 修改 `MemoryCacheProvider` 已有实现以匹配接口
3. 修改 `RedisCacheProvider` 已有实现以匹配接口
4. 修改 `CacheEvict` 逻辑：`allEntries=true` 调用 `deleteByPattern(cacheName+'*')` 替代 `clear()`
5. 新增测试用例覆盖新行为
6. 运行全部测试确保无回归

**Rollback**: 还原 `cache-evict.ts` 中调用为 `provider.clear()`，移除接口中新增方法声明。

## Open Questions

无