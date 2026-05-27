## Context

在分布式业务场景中，"加锁→业务处理→释放锁"是高频固化模式。当前业务代码中散落着锁获取/释放/续期的重复逻辑，看门狗自动续期等高级特性难以复用。需要通过装饰器将锁逻辑抽离为切面，业务代码只需声明锁行为。

## Goals / Non-Goals

**Goals:**
- 提供 `@DistributedLock` 装饰器，自动完成"加锁→业务执行→释放锁"全流程
- 支持看门狗自动续期，防止长业务执行中锁超时
- 解耦锁存储后端，通过 `LockProvider` 接口支持 Redis/Database/InMemory 等多种实现
- 锁获取失败时抛出 `LockAcquisitionError`，调用方显式处理

**Non-Goals:**
- 不负责锁的公平性调度
- 不提供锁重入的计数追踪
- 不提供集群脑裂解决方案

## Decisions

### 1. LockProvider 接口设计

```typescript
interface LockProvider {
  acquire(key: string, ttl: number): Promise<string | null>; // 返回 lockToken
  release(key: string, token: string): Promise<boolean>;
  renew(key: string, token: string, ttl: number): Promise<boolean>;
}
```

**决策理由：** Promise 风格返回 lockToken，用于区分"自己的锁"和"别人的锁"。看门狗续期时带上 token，Redis 校验 token 匹配才续期，不匹配则停止续期。

### 2. 装饰器 key 选项设计

```typescript
interface DistributedLockOptions {
  key?: null | string | (...args: unknown[]) => string;
  ttl?: number;              // 默认 30000ms
  renewInterval?: number;    // 默认 ttl/3
  retryCount?: number;      // 默认 0
  retryDelay?: number;      // 默认 100ms
}
```

**决策理由：** `key` 参数覆盖三种场景：
- `undefined/null` → `ClassName.methodName`（方法级）
- `string` → 指定字符串（全局级）
- `function` → 动态计算（实体级，如 `key: (args) => order:${args[0]}`）

### 3. 全局注册机制

参照 cache-decorator 的 `CacheProviderRegistry`，使用 `LockProviderRegistry.register()/get()/setDefault()`。

**决策理由：** 装饰器无需在构造函数中注入 provider，通过全局注册保持调用方代码简洁。

### 4. 看门狗实现：独立续期线程

```typescript
class Watchdog {
  constructor(
    private provider: LockProvider,
    private key: string,
    private token: string,
    private ttl: number,
    private interval: number
  ) {}

  start(): void {
    this.timer = setInterval(async () => {
      const ok = await this.provider.renew(this.key, this.token, this.ttl);
      if (!ok) this.stop();
    }, this.interval);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
```

**决策理由：** 独立线程实现简单准确，每次续期都能明确判断锁是否还属于自己的 token。 alternativo "每次操作顺带续期" 实现复杂度高且 release 时需额外判断。

### 5. Redis Provider 实现

| 操作 | 实现方式 |
|------|---------|
| 加锁 | `SET key token NX PX ttl` 原子设锁 |
| 释放 | Lua 脚本：校验 token 后 DEL（原子操作） |
| 续期 | Lua 脚本：校验 token 后 PEXPIRE（原子操作） |

**决策理由：** Lua 脚本保证"校验 token + 操作"在同一原子内执行，避免 race condition。

### 6. 模块结构

```
packages/lock-decorator/src/
├── core/
│   ├── lock-provider.ts         # LockProvider 接口
│   ├── lock-provider-registry.ts # 全局注册表
│   ├── redis-lock-provider.ts   # Redis 实现
│   ├── in-memory-lock-provider.ts # 测试用 InMemory 实现
│   └── watchdog.ts              # 看门狗实现
├── decorators/
│   └── distributed-lock.ts      # @DistributedLock 装饰器
├── errors/
│   └── lock-acquisition-error.ts # 锁获取失败异常
└── index.ts                     # 统一导出
```

| 模块 | 功能 | 依赖 |
|------|------|------|
| lock-provider.ts | 接口定义 | 无 |
| lock-provider-registry.ts | 全局注册表 | lock-provider.ts |
| redis-lock-provider.ts | Redis 实现 | lock-provider.ts, ioredis |
| in-memory-lock-provider.ts | 测试用内存实现 | lock-provider.ts |
| watchdog.ts | 看门狗线程 | lock-provider.ts |
| distributed-lock.ts | 装饰器切面 | lock-provider-registry.ts, watchdog.ts, lock-acquisition-error.ts |
| lock-acquisition-error.ts | 异常类型 | 无 |
| index.ts | 统一导出 | 上述所有 |

## Risks / Trade-offs

- [风险] 看门狗线程开销 → [缓解] 每个锁实例仅一个线程，持有期结束后立即退出；轻量级 setInterval + Redis O(1) 操作
- [风险] Redis 宕机导致锁服务不可用 → [缓解] 业务层需做好降级处理，装饰器抛出 LockAcquisitionError
- [风险] 锁续期失败后业务仍在执行 → [缓解] 续期失败说明锁已被他人获取，此时业务继续执行会失去锁保护，需业务层自行处理此类边界情况

## Migration Plan

1. **开发阶段**：实现核心接口、Redis Provider、装饰器、单元测试
2. **集成阶段**：在现有业务中试用，验证锁行为正确性
3. **上线阶段**：按需逐步迁移，无需强制所有业务使用装饰器

**回滚计划：** 装饰器为可选增强，现有业务代码不受影响，回滚只需移除装饰器。

## Open Questions

- [ ] 是否需要 Database Provider（如 MySQL）？
- [ ] InMemory Provider 是否必须？主要用于测试场景