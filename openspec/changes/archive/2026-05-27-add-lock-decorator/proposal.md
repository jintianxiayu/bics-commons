## Why

在分布式业务场景中，"加锁→业务处理→释放锁"是高频固化模式。手动编写锁获取/释放/续期逻辑容易出错，且看门狗续期等高级特性难以复用。通过装饰器将锁逻辑抽离为切面，业务代码只需声明锁行为，无需关心实现细节。

## What Changes

- 新增 `@bics/lock-decorator` 包，提供分布式锁装饰器
- `@DistributedLock` 装饰器：自动加锁、业务执行、锁释放（含异常情况）
- `LockProvider` 接口抽象：存储后端可插拔
- `RedisLockProvider` 实现：基于 Redis SETNX + Lua 脚本原子操作
- `LockProviderRegistry` 全局注册表（参照 cache-decorator 的 CacheProviderRegistry）
- 看门狗自动续期机制：独立线程定时续期，防止业务未完成锁超时
- 锁获取失败时抛出 `LockAcquisitionError`

## Capabilities

### New Capabilities

- `distributed-lock-decorator`: 装饰器驱动的分布式锁切面，支持看门狗自动续期
- `lock-provider-registry`: 全局 LockProvider 注册与获取机制
- `redis-lock-provider`: Redis 存储后端实现
- `lock-acquisition-error`: 锁获取失败异常类型

### Modified Capabilities

- 无

## Impact

**影响范围：**
- 新增包：`packages/lock-decorator/`
- 入口文件：`packages/lock-decorator/src/index.ts`
- 核心接口：`packages/lock-decorator/src/core/lock-provider.ts`
- 装饰器实现：`packages/lock-decorator/src/decorators/distributed-lock.ts`
- 注册表：`packages/lock-decorator/src/core/lock-provider-registry.ts`
- Redis 实现：`packages/lock-decorator/src/core/redis-lock-provider.ts`

**依赖：**
- ioredis（Redis 客户端）
- uuid（生成 lockToken）

**Breaking Change：**
- 无（新增包，不影响现有代码）

**性能影响：**
- 看门狗线程：每个锁实例一个后台线程，持有期间持续运行
- Redis 操作：acquire/renew/release 均为 O(1) 操作