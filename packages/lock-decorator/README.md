# @jintianxiayu/lock-decorator

分布式锁装饰器，为 TypeScript 方法提供声明式分布式锁功能。

## 安装

```bash
npm install @jintianxiayu/lock-decorator reflect-metadata
```

## 特性

- `@DistributedLock` 装饰器：自动加锁、业务执行、锁释放（含异常情况）
- 可插拔的锁后端（Redis / 自定义）
- 看门狗自动续期：防止长业务执行中锁超时
- 锁获取失败抛出 `LockAcquisitionError`，调用方显式处理
- 支持多种 key 策略：方法级、字符串、函数动态计算

## 重要提示

> **@DistributedLock 装饰器仅适用于返回 Promise 的 async 方法**
>
> 此装饰器会将方法替换为异步函数。如果装饰返回非 Promise 的同步方法，调用方会收到 Promise 对象而非期望的返回值。

## 快速开始

```typescript
import 'reflect-metadata';
import { DistributedLock, LockProviderRegistry, RedisLockProvider } from '@jintianxiayu/lock-decorator';
import Redis from 'ioredis';

// 注册 Redis Provider
const redis = new Redis();
LockProviderRegistry.register('redis', new RedisLockProvider(redis));
LockProviderRegistry.setDefault('redis');

class OrderService {
  @DistributedLock({ key: 'daily-settlement', ttl: 60000 })
  async dailySettlement() {
    // 业务逻辑
    return { success: true };
  }
}
```

## 使用示例

### 基本用法

```typescript
import 'reflect-metadata';
import { DistributedLock, LockProviderRegistry } from '@jintianxiayu/lock-decorator';

LockProviderRegistry.register('redis', new RedisLockProvider(new Redis()));
LockProviderRegistry.setDefault('redis');

class PaymentService {
  @DistributedLock({})
  async processPayment(orderId: string, amount: number) {
    // 自动使用 'PaymentService.processPayment' 作为锁 key
    return { orderId, status: 'paid' };
  }
}
```

### 自定义 TTL 和续期间隔

```typescript
class InventoryService {
  @DistributedLock({
    ttl: 30000,           // 锁超时 30 秒
    renewInterval: 10000, // 每 10 秒续期一次
  })
  async deductStock(productId: string, quantity: number) {
    return { productId, remaining: 100 - quantity };
  }
}
```

### 重试机制

```typescript
class LockService {
  @DistributedLock({
    key: 'critical-section',
    retryCount: 3,     // 最多重试 3 次
    retryDelay: 200,   // 重试间隔 200ms
  })
  async criticalOperation() {
    return 'done';
  }
}
```

### 函数式 key

```typescript
class OrderService {
  @DistributedLock({
    key: (orderId: string) => `order:${orderId}`,
  })
  async processOrder(orderId: string) {
    return { orderId, status: 'processed' };
  }
}
```

### 捕获锁获取失败异常

```typescript
class StockService {
  @DistributedLock({
    key: (productId: string) => `stock:${productId}`,
    retryCount: 2,
  })
  async deductStock(productId: string, quantity: number) {
    return { productId, remaining: 100 - quantity };
  }
}

const stockService = new StockService();
try {
  await stockService.deductStock('P001', 5);
} catch (error) {
  if (error instanceof LockAcquisitionError) {
    console.error(`获取锁失败: ${error.key}, 重试次数: ${error.retryCount}`);
  }
  throw error;
}
```

## API

### @DistributedLock(options?)

分布式锁装饰器。**必须用于 async 方法**。

```typescript
interface DistributedLockOptions {
  key?: null | string | ((...args: unknown[]) => string);
  ttl?: number;              // 默认 30000ms
  renewInterval?: number;    // 默认 10000ms
  retryCount?: number;      // 默认 0（不重试）
  retryDelay?: number;      // 默认 100ms
}
```

#### key 选项

| 形式 | 说明 | 示例 |
|------|------|------|
| `undefined`/`null` | 方法级锁，格式 `ClassName.methodName` | `'PaymentService.processPayment'` |
| `string` | 指定字符串锁 key | `'daily-settlement'` |
| `function` | 动态计算，参数为方法入参 | `(orderId: string) => \`order:${orderId}\`` |

### LockProviderRegistry

全局锁提供者注册表。

```typescript
import { LockProviderRegistry } from '@jintianxiayu/lock-decorator';

// 注册提供者
LockProviderRegistry.register('redis', new RedisLockProvider(redis));
// 或使用 alias
LockProviderRegistry.add('redis', new RedisLockProvider(redis));

// 设置默认提供者
LockProviderRegistry.setDefault('redis');

// 获取提供者（使用默认）
const provider = LockProviderRegistry.get();

// 获取指定名称提供者
const provider = LockProviderRegistry.get('redis');

// 清空注册表
LockProviderRegistry.clear();
```

### RedisLockProvider

基于 Redis 的锁提供者实现。

```typescript
import Redis from 'ioredis';
import { RedisLockProvider } from '@jintianxiayu/lock-decorator';

const redis = new Redis();
const lockProvider = new RedisLockProvider(redis);
```

**Redis 操作：**

| 操作 | 实现方式 |
|------|---------|
| 加锁 | `SET key token NX PX ttl` 原子设锁 |
| 释放 | Lua 脚本：校验 token 后 DEL（原子操作） |
| 续期 | Lua 脚本：校验 token 后 PEXPIRE（原子操作） |

### LockAcquisitionError

锁获取失败时抛出的异常。

```typescript
import { LockAcquisitionError } from '@jintianxiayu/lock-decorator';

try {
  await service.criticalOperation();
} catch (error) {
  if (error instanceof LockAcquisitionError) {
    console.error(`锁 key: ${error.key}, 重试次数: ${error.retryCount}`);
  }
}
```

### Watchdog

看门狗自动续期线程。每隔 `renewInterval` 毫秒自动调用 `renew()` 续期，续期失败时停止。

```typescript
import { Watchdog } from '@jintianxiayu/lock-decorator';

const watchdog = new Watchdog({
  provider,
  key: 'lock-key',
  token: 'token',
  ttl: 30000,
  interval: 10000,
});
watchdog.start(); // 开始续期
// 业务执行...
watchdog.stop();  // 停止续期
```

## 项目结构

```
packages/lock-decorator/
├── src/
│   ├── index.ts                       # 统一导出
│   ├── core/
│   │   ├── lock-provider.ts           # LockProvider 接口
│   │   ├── lock-provider-registry.ts  # 全局注册表
│   │   ├── redis-lock-provider.ts     # Redis 实现
│   │   └── watchdog.ts                # 看门狗续期
│   ├── decorators/
│   │   └── distributed-lock.ts        # @DistributedLock 装饰器
│   └── errors/
│       └── lock-acquisition-error.ts  # 异常类型
├── test/
│   ├── distributed-lock.test.ts
│   ├── lock-provider-registry.test.ts
│   ├── redis-lock-provider.test.ts
│   └── watchdog.test.ts
├── package.json
├── tsconfig.json
└── jest.config.js
```

## License

MIT