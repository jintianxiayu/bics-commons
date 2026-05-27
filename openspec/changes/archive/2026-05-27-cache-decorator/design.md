## Context

在业务代码中实现方法缓存需要大量样板代码，包括 key 构建、缓存检查、方法调用、结果缓存等步骤。通过装饰器模式可以简化这一流程。

当前项目已有 `@bics/http-client-decorator` 装饰器框架，本项目作为通用缓存装饰器，可独立使用，也可与 HTTP 装饰器组合。

## Goals / Non-Goals

**Goals:**
- 提供 `@Cache` 和 `@CacheEvict` 方法装饰器
- 支持可插拔的 CacheProvider（Memory / Redis / 自定义）
- 支持 TTL 过期
- 支持请求合并（并发场景下返回同一个 Promise）
- 错误结果也缓存（防止缓存穿透）

**Non-Goals:**
- 不提供 LRU 容量淘汰
- 不提供缓存命中率统计
- 不直接与 HTTP 装饰器集成（@Cache 可独立使用）

## Decisions

### 1. 缓存存储架构

```
CacheProvider (接口)
    ├── get<T>(key: string): T | undefined
    ├── set<T>(key: string, value: T, ttl?: number): void
    ├── delete(key: string): void
    └── clear(): void

CacheProviderRegistry (全局注册表)
    ├── register(name: string, provider: CacheProvider): void
    ├── get(name?: string): CacheProvider
    └── setDefault(name: string): void
```

### 2. 缓存 Key 结构

- `name`: 缓存名称/类别，由用户指定
- `key`: 基于方法入参值序列化生成，不包含类名/方法名

格式：
```
{name}:{serializedArgs}
例如：user-cache:1
      user-cache:page=1&size=10
```

### 3. 并发处理（请求合并）

使用 `Map<key, Promise<T>>` 存储正在执行的请求：

```
┌─────────────────────────────────────┐
│  pendingRequests: Map<string, Promise>
│                                     │
│  首次请求 "user-cache:1"           │
│    → 无 Promise，创建新请求返回      │
│    → 存储 Promise 到 Map           │
│                                     │
│  后续请求 "user-cache:1"            │
│    → 已存在 Promise，直接返回复用    │
└─────────────────────────────────────┘
```

### 4. 错误结果缓存

当方法抛出异常时，也将错误结果缓存：

```typescript
interface CacheEntry<T> {
  value: T;
  error: unknown;
  expiresAt: number | null;
}
```

### 5. 模块设计

| 模块 | 功能 | 依赖 |
|------|------|------|
| `src/core/cache-provider.ts` | CacheProvider 接口定义 | reflect-metadata |
| `src/core/cache-provider-registry.ts` | 全局注册表 | cache-provider |
| `src/core/native-cache.ts` | MemoryCacheProvider 实现 | - |
| `src/core/redis-cache.ts` | RedisCacheProvider 实现 | ioredis |
| `src/core/key-builder.ts` | 缓存 key 生成器 | - |
| `src/core/pending-cache.ts` | 请求合并（pending Promise）| - |
| `src/decorators/cache.ts` | @Cache 装饰器实现 | reflect-metadata, key-builder, pending-cache |
| `src/decorators/cache-evict.ts` | @CacheEvict 装饰器实现 | - |
| `src/index.ts` | 导出公共 API | - |

### 6. 装饰器配置

```typescript
// @Cache 配置项
interface CacheOptions {
  ttl?: number;           // 过期时间（毫秒）
  providerName?: string;  // 指定 CacheProvider，默认使用内存
}

// @CacheEvict 配置项
interface CacheEvictOptions {
  allEntries?: boolean;  // 清除所有条目，默认 false
}
```

## Risks / Trade-offs

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| Redis 连接失败 | Redis 不可用时影响缓存功能 | 降级到内存，或抛出错误 |
| 内存泄漏 | MemoryCacheProvider 无限增长 | TTL 控制过期，需业务方合理配置 |
| 错误缓存占据 | 错误结果长期缓存 | TTL 控制过期 |

## Migration Plan

1. 创建 `packages/cache-decorator` 包
2. 实现核心模块和装饰器
3. 添加单元测试
4. 发布版本

**回滚**：删除 `packages/cache-decorator` 目录即可

## Open Questions

- 无