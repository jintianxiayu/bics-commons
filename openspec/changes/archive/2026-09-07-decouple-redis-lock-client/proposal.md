## Why

`@jintianxiayu/lock-decorator` 的内置 `RedisLockProvider` 将构造参数、命令调用与安装依赖绑定到 ioredis。使用 node-redis 或其他客户端的项目无法直接复用其 token、Lua 释放和续期逻辑，只能额外引入客户端或重复实现 `LockProvider`。

## What Changes

- 新增仅包含原子条件写入和脚本执行的 `RedisLockClient` 接口，让 `RedisLockProvider` 集中维护锁语义。
- 提供 `createIoredisLockClient` 和 `createNodeRedisLockClient` 两个适配工厂，复用调用方已经创建的连接；其他客户端可以实现同一接口。适配器将非标准 SET 响应拒绝为 `TypeError`，避免误判为普通竞争。
- **BREAKING**：`RedisLockProvider` 构造参数由 `ioredis.Redis` 改为 `RedisLockClient`；旧调用迁移为 `new RedisLockProvider(createIoredisLockClient(redis))`，不增加自动客户端识别或旧签名兼容入口。
- 从 lock-decorator 的运行时依赖中移除 ioredis。两个客户端仅作为开发依赖用于验证，发布声明不引用它们的类型，调用方自行声明实际使用的客户端。
- 保留 `LockProvider`、装饰器、注册表、重试与看门狗的现有契约，以及 Redis key、UUID token、毫秒 TTL 和原子释放/续期协议。
- 增加真实客户端类型检查、双客户端与新旧协议互操作集成测试、独立消费项目安装隔离测试，以及迁移文档。

## Capabilities

### New Capabilities

- `redis-lock-client`: 客户端无关的 Redis 锁契约、两个内置适配器、连接所有权、依赖隔离和跨客户端互操作。

### Modified Capabilities

无。现有主规格尚未包含 lock-decorator 能力；本次将相关既有锁协议作为新能力的兼容性基线记录。

## Impact

### 公共 API 与版本

本次会修改 `packages/lock-decorator/src/index.ts` 的导出面和公共构造签名。按当前 `0.1.3` 基线，目标版本为 `0.2.0`；这是显式迁移的破坏性 minor 版本，不作为 patch 发布。

| 导出 | 变化 | 版本级别 |
| --- | --- | --- |
| `RedisLockClient` | 新增最小操作接口 | minor，新增能力 |
| `IoredisLockClientSource` | 新增 ioredis 命令调用的最小结构接口 | minor，新增公共类型 |
| `NodeRedisLockClientSource` | 新增 node-redis 命令调用的最小结构接口 | minor，新增公共类型 |
| `createIoredisLockClient` | 新增适配工厂 | minor，新增能力 |
| `createNodeRedisLockClient` | 新增适配工厂 | minor，新增能力 |
| `RedisLockProvider` | 构造参数改为 `RedisLockClient` | minor，0.x 破坏性变更 |

不删除现有导出，其余公共签名不变。该发布方式符合仓库对 0.x 破坏性变更的版本规则；源码调用不向后兼容，Redis 中的数据协议保持兼容。

### 代码、依赖与支持范围

- 修改仅涉及 lock-decorator 的接口、适配器、Provider、入口、测试、README、包清单，以及 workspace 锁文件和本包的 pnpm 变更记录；其他子包不需要同步修改或发版。
- ioredis 沿用现有 `^5.10.1`，移入开发依赖；新增 `redis` 5.x 开发依赖，用于真实 node-redis 类型和集成验证。两者均不设为运行时 dependency 或 peerDependency，不增加下游必装客户端。
- 第一版支持两个客户端的普通连接、默认字符串/整数返回形式。Redis Cluster、Sentinel 专项验证、自定义 RESP 类型映射和自动识别客户端不在本次承诺范围。
- 不新增连接管理、自动降级、脚本缓存、锁算法或看门狗异常处理。当前看门狗对续期 Promise 拒绝缺少处理是独立问题，不在此变更中宣称解决。

### 数据、下游与迁移

- key 原样传递，不新增命名空间；继续写入 UUID 字符串并使用毫秒过期，释放/续期继续在 Lua 内比较 token。新旧版本在相同 Redis 数据库、有效 key 和连接前缀配置下可以竞争同一把锁，不需要扫描、删除或迁移存量锁。
- 仓库其他包的清单没有声明依赖 lock-decorator；当前上下文未提供已确认的外部下游服务名单，不能据此认定没有外部使用方。发布前需要维护者完成下游盘点并通知构造调用迁移，升级部署前由各下游确认客户端直接依赖及连接配置。
- 通过 pnpm 的现有变更记录流程计划本包 minor 发布。本次提案不执行版本发布、Git tag 或通知发送。
- 回退可由下游锁定 `0.1.3` 并恢复旧初始化代码，或发布修订版本；不能依赖撤回已发布 npm 版本。Redis 数据格式不变，无需数据回滚。
