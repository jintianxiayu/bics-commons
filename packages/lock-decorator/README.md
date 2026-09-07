# @jintianxiayu/lock-decorator

为 TypeScript 异步方法提供声明式分布式锁，支持 ioredis、node-redis 和自定义锁后端。

## 目录

- [安装](#安装)
- [特性](#特性)
- [快速开始](#快速开始)
- [使用示例](#使用示例)
- [API](#api)
- [连接与兼容范围](#连接与兼容范围)
- [迁移到 0.2.0](#迁移到-020)
- [开发验证](#开发验证)
- [License](#license)

## 安装

Node.js 要求：`^20.19.0 || ^22.13.0 || >=24.0.0`。

```bash
pnpm add @jintianxiayu/lock-decorator reflect-metadata
```

使用 Redis 时，直接安装所选客户端：

```bash
# 使用 ioredis
pnpm add ioredis@5
# 或使用 node-redis（npm 包名为 redis）
pnpm add redis@5
```

本包不传递安装任何 Redis 客户端。自定义 `LockProvider` 或 `RedisLockClient` 不要求安装上述客户端。

装饰器采用 TypeScript legacy decorators，需要在 `tsconfig.json` 中开启：

```json
{
    "compilerOptions": {
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true
    }
}
```

**`@DistributedLock` 仅适用于返回 Promise 的异步方法**；缺少返回类型元数据或装饰同步方法会在类定义时抛出 `TypeError`。

## 特性

- `@DistributedLock` 自动获取锁、执行业务，并在 `finally` 中停止续期和尝试释放锁。
- Redis 锁协议独立于客户端；内置两个适配工厂，可复用现有连接。
- 看门狗按配置续期；支持方法级、字符串和函数式 key。
- 锁竞争可配置重试，耗尽后抛出 `LockAcquisitionError`。
- 自定义 `LockProvider` 可接入其他锁后端。

## 快速开始

以下两个完整示例任选其一。实际项目通常在应用启动时注册 Provider，在应用关闭时释放共享连接。

### ioredis

```typescript
import 'reflect-metadata';
import Redis from 'ioredis';
import {
    createIoredisLockClient,
    DistributedLock,
    LockProviderRegistry,
    RedisLockProvider,
} from '@jintianxiayu/lock-decorator';

class OrderService {
    @DistributedLock({ key: 'daily-settlement', ttl: 60000 })
    async dailySettlement(): Promise<{ success: boolean }> {
        return { success: true };
    }
}

/** 建立示例连接、执行一次业务，并由应用关闭连接。 */
async function main(): Promise<void> {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { lazyConnect: true });
    redis.on('error', (error: Error) => console.error(error));
    try {
        await redis.connect();
        LockProviderRegistry.register('redis', new RedisLockProvider(createIoredisLockClient(redis)));
        LockProviderRegistry.setDefault('redis');
        console.log(await new OrderService().dailySettlement());
    } finally {
        redis.disconnect();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
```

### node-redis

```typescript
import 'reflect-metadata';
import { createClient } from 'redis';
import {
    createNodeRedisLockClient,
    DistributedLock,
    LockProviderRegistry,
    RedisLockProvider,
} from '@jintianxiayu/lock-decorator';

class OrderService {
    @DistributedLock({ key: 'daily-settlement', ttl: 60000 })
    async dailySettlement(): Promise<{ success: boolean }> {
        return { success: true };
    }
}

/** 建立示例连接、执行一次业务，并由应用关闭连接。 */
async function main(): Promise<void> {
    const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });
    redis.on('error', (error: Error) => console.error(error));
    try {
        await redis.connect();
        LockProviderRegistry.register('redis', new RedisLockProvider(createNodeRedisLockClient(redis)));
        LockProviderRegistry.setDefault('redis');
        console.log(await new OrderService().dailySettlement());
    } finally {
        if (redis.isOpen) {
            redis.destroy();
        }
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
```

### 自定义 Redis 客户端

其他 Redis 库只需提供 `RedisLockClient` 的两个操作。下面的注册函数接受调用方已绑定连接的实现，无需引入 ioredis 或 node-redis：

```typescript
import { LockProviderRegistry, RedisLockProvider, type RedisLockClient } from '@jintianxiayu/lock-decorator';

/** 注册其他 Redis 库提供的原子写入与脚本执行实现。 */
export function registerCustomRedis(
    setIfAbsent: RedisLockClient['setIfAbsent'],
    evalScript: RedisLockClient['eval']
): RedisLockProvider {
    const client: RedisLockClient = { setIfAbsent, eval: evalScript };
    const provider = new RedisLockProvider(client);
    LockProviderRegistry.register('redis', provider);
    LockProviderRegistry.setDefault('redis');
    return provider;
}
```

调用方需要把所用 SDK 映射到以下契约：

- `setIfAbsent({ key, value, ttlMs })`：一次原子的 `SET ... NX PX`；成功返回 `true`，键已存在返回 `false`，命令错误拒绝 Promise。
- `eval({ script, keys, arguments })`：按原顺序执行完整 Lua 脚本，返回原始响应；释放与续期成功必须返回数值 `1`。

不要使用分开的 `GET` 与 `SET`、`DEL` 或 `PEXPIRE` 替代原子操作。客户端方法依赖 `this` 时，应使用闭包调用 `client.method(...)` 或显式绑定。

## 使用示例

以下方法示例复用快速开始中已注册的默认 Provider，并从本包导入 `DistributedLock`、`LockAcquisitionError`。

### 基本用法

```typescript
class PaymentService {
    @DistributedLock()
    async processPayment(orderId: string, amount: number): Promise<{ orderId: string; amount: number }> {
        // 自动使用 'PaymentService.processPayment' 作为锁 key
        return { orderId, amount };
    }
}
```

### 自定义 TTL 和续期间隔

```typescript
class InventoryService {
    @DistributedLock({
        ttl: 30000, // 锁超时 30 秒
        renewInterval: 10000, // 每 10 秒续期一次
    })
    async deductStock(productId: string, quantity: number): Promise<{ productId: string; remaining: number }> {
        return { productId, remaining: 100 - quantity };
    }
}
```

### 重试机制

```typescript
class LockService {
    @DistributedLock({ key: 'critical-section', retryCount: 3, retryDelay: 200 })
    async criticalOperation(): Promise<string> {
        return 'done';
    }
}
```

`retryCount: 3` 表示首次尝试后最多重试 3 次，仅在锁已被持有时重试。Redis 命令拒绝会直接传播，业务方法不会执行。

### 函数式 key

```typescript
class OrderService {
    @DistributedLock({ key: (orderId: unknown) => `order:${orderId}` })
    async processOrder(orderId: string): Promise<{ orderId: string; status: string }> {
        return { orderId, status: 'processed' };
    }
}
```

key 回调接收 `unknown[]`，需要按实际业务检查或转换参数；它不会自动包含类名或方法名。

### 捕获锁获取失败异常

```typescript
try {
    await service.criticalOperation();
} catch (error) {
    if (error instanceof LockAcquisitionError) {
        console.error(`获取锁失败: ${error.key}, 重试次数: ${error.retryCount}`);
    }
    throw error;
}
```

## API

### @DistributedLock(options?)

| 选项            | 类型                                                 | 默认值      | 说明                                    |
| --------------- | ---------------------------------------------------- | ----------- | --------------------------------------- |
| `key`           | `null \| string \| ((...args: unknown[]) => string)` | `undefined` | 缺省或 null 使用 `ClassName.methodName` |
| `ttl`           | `number`                                             | `30000`     | 锁 TTL，毫秒                            |
| `renewInterval` | `number`                                             | `10000`     | 续期间隔，毫秒；小于 TTL 时启动看门狗   |
| `retryCount`    | `number`                                             | `0`         | 竞争失败后的重试次数                    |
| `retryDelay`    | `number`                                             | `100`       | 重试间隔，毫秒                          |

本包导出 `DistributedLockOptions` 和对应常量 `DEFAULT_TTL`、`DEFAULT_RENEW_INTERVAL`、`DEFAULT_RETRY_COUNT`、`DEFAULT_RETRY_DELAY`。

### LockProviderRegistry

| 方法                                               | 作用                                   |
| -------------------------------------------------- | -------------------------------------- |
| `register(name, provider)` / `add(name, provider)` | 注册任意 `LockProvider`                |
| `setDefault(name)`                                 | 设置装饰器使用的默认提供者             |
| `get(name?)`                                       | 获取指定或默认提供者，未注册时抛出错误 |
| `clear()`                                          | 清空注册与默认设置；不关闭客户端连接   |

### RedisLockProvider

构造函数为 `new RedisLockProvider(client: RedisLockClient)`。

| 方法                     | 返回值                    | Redis 行为                                                 |
| ------------------------ | ------------------------- | ---------------------------------------------------------- |
| `acquire(key, ttl)`      | `Promise<string \| null>` | UUID v4 token；原子 NX/PX 写入，已持有时返回 null，不重入  |
| `release(key, token)`    | `Promise<boolean>`        | Lua 比较 token 后 DEL；不存在或 token 不匹配返回 false     |
| `renew(key, token, ttl)` | `Promise<boolean>`        | Lua 比较 token 后 PEXPIRE；不存在或 token 不匹配返回 false |

TTL 使用毫秒。调用方应传入正整数；本包不修复非法 TTL、不改写 key、不新增前缀。三种操作的命令错误会原样传播。锁后端公共接口 `LockProvider` 保持相同的三项方法，自定义实现可直接注册。

### 客户端接口与适配工厂

| 导出                                | 用途                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| `RedisLockClient`                   | 原子条件写入和脚本执行接口，请求字段必填、数组只读   |
| `IoredisLockClientSource`           | ioredis 适配器需要的 `set/eval` 结构类型             |
| `NodeRedisLockClientSource`         | node-redis 适配器需要的 `set/eval` 结构类型          |
| `createIoredisLockClient(client)`   | 将 ioredis 的位置参数命令适配为 `RedisLockClient`    |
| `createNodeRedisLockClient(client)` | 将 node-redis 的选项对象命令适配为 `RedisLockClient` |

工厂保留方法调用上下文，不修改请求或连接选项。SET 的 `'OK'` 转为 `true`，`null` 转为 `false`；其他响应抛出 `TypeError`。EVAL 返回值原样传给 Provider，只有数值 `1` 表示释放或续期成功。自定义 Buffer/RESP 响应映射需要自行实现 `RedisLockClient`。

### LockAcquisitionError

锁竞争耗尽时抛出，包含 `key` 和 `retryCount`。连接或脚本异常不会转换为此异常。

### Watchdog

`new Watchdog({ provider, key, token, ttl, interval })` 创建定时续期器；调用 `start()` 启动，`stop()` 停止。`renew()` 返回 `false` 时停止续期。装饰器会在业务结束时停止它。

当前限制：定时续期的 Promise 拒绝尚未捕获；释放锁异常可能覆盖原业务异常。这两项既有行为没有在本次客户端适配中调整。

## 连接与兼容范围

- 连接创建、连接就绪、错误监听、离线队列、重连、超时及关闭均由调用方负责。Provider 和工厂只执行命令，同一连接可供多个 Provider 与其他业务共用。
- 已验证版本为 ioredis **5.11.0**、node-redis（`redis`）**5.12.1**，使用单实例 Redis 和默认响应类型。其他版本需重新验证；Cluster、Sentinel 专项行为和多节点强一致性不在本次验证范围内。
- 不同客户端或新旧版本互斥的前提是连接同一 Redis 服务、同一数据库并使用相同的**最终 Redis key**。例如 ioredis 配置 `keyPrefix: 'app:'` 后操作 `order:1`，node-redis 应操作 `app:order:1`。适配器不额外添加或移除前缀。
- 锁超时后可能被其他调用方获取；旧 token 不会删除或续期新锁。本包不提供 fencing token，也不能保证故障切换时的强一致互斥。

## 迁移到 0.2.0

本次变更的目标版本为 **0.2.0**，包含构造签名变更；实际版本以发布结果为准。

原 `0.1.x` 初始化：

```typescript
new RedisLockProvider(redis);
```

迁移后的 ioredis 初始化：

```typescript
new RedisLockProvider(createIoredisLockClient(redis));
```

迁移后的 node-redis 初始化：

```typescript
new RedisLockProvider(createNodeRedisLockClient(redis));
```

从本包导入对应工厂，并在应用的直接依赖中声明所用客户端。注册表、业务装饰器及自定义 `LockProvider` 用法保持不变，不需要迁移或删除已有锁。确认最终 key 一致后可分批升级；回退到 `0.1.3` 时恢复旧构造方式。

## 开发验证

在仓库根目录执行受影响包测试：

```bash
pnpm --filter @jintianxiayu/lock-decorator test
```

真实 Redis 用例需要设置 `LOCK_DECORATOR_TEST_REDIS_URL` 指向专用测试实例；未设置时会明确跳过。本次变更的集成验收要求实际执行这些用例。测试使用唯一 key，只清理自身创建的数据。

包消费测试会构建 tarball，在 workspace 外安装三个临时项目，验证无客户端、仅 ioredis、仅 node-redis 的依赖隔离、严格类型检查和运行入口。三个快速开始示例会直接从本 README 提取并参与消费项目编译。

## License

MIT
