## Why

`@jintianxiayu/cache-decorator` 的 `RedisCacheProvider` 将公共构造类型、命令调用、默认连接创建和发布依赖全部绑定到 ioredis，导致 node-redis 或其他客户端的项目无法复用内置 Redis 缓存语义，仅使用内存缓存的项目也会被迫安装并加载 ioredis。需要建立客户端无关的最小命令边界，让调用方复用并管理自己的 Redis 连接，同时保持现有缓存数据协议不变。

## What Changes

- 新增仅包含字符串读写、批量删除、游标扫描和数据库清理的 `RedisCacheClient` 接口，由 `RedisCacheProvider` 继续集中维护 JSON 序列化、miss 映射、秒级 TTL 和 `SCAN COUNT 100` 循环。
- 提供 `createIoredisCacheClient` 与 `createNodeRedisCacheClient` 两个显式适配工厂，并提供最小结构化 source 类型；其他 Redis 客户端可以自行实现 `RedisCacheClient`。
- ioredis 适配器规范化 tuple 形式的 SCAN 响应，并显式处理 ioredis `keyPrefix` 不作用于 SCAN pattern 和返回 key 的差异；node-redis 适配器规范化对象形式的 SCAN 响应，并支持用可选前缀访问同一批物理 key。
- **BREAKING**：`RedisCacheProvider` 构造参数由可选的 `ioredis.Redis` 改为必填的 `RedisCacheClient`；移除内部 `new Redis()`，旧调用迁移为 `new RedisCacheProvider(createIoredisCacheClient(redis))`。
- 从运行时依赖中移除 ioredis。ioredis 和 node-redis 仅作为开发依赖用于真实类型、Redis 集成和独立消费项目验证，发布入口和声明文件均不引用两者。
- 保留 `CacheProvider`、`CacheProviderRegistry`、`@Cache`、`@CacheEvict`、Redis key、值序列化格式、TTL 单位和 `clear()` 的现有数据库级语义；不引入自动客户端检测、连接管理、重试、日志或降级。
- 增加 Provider、两套适配器、连接所有权、真实 Redis 互操作、发布包安装隔离和迁移文档测试。

## Capabilities

### New Capabilities

- `redis-cache-client`: 客户端无关的 Redis 缓存命令契约、ioredis/node-redis 适配器、连接所有权、数据兼容性、依赖隔离和跨客户端互操作。

### Modified Capabilities

- `cache-evict-allentries-prefix`: 扩展 Redis pattern 删除要求，使 ioredis 与 node-redis 在无前缀和带前缀场景下都按逻辑缓存名称执行完整的游标扫描和删除。

## Impact

### 公共 API 与版本

本次会修改 `packages/cache-decorator/src/index.ts` 的导出面和 `RedisCacheProvider` 的公共构造签名。当前版本为 `0.1.3`，变更记录应将本包计划为 `0.2.0`；这是符合仓库 0.x 版本规则的破坏性 minor，不作为 patch 发布。

| 导出                          | 变化                                                  | 版本级别              |
| ----------------------------- | ----------------------------------------------------- | --------------------- |
| `RedisCacheClient`            | 新增客户端无关的最小命令接口                          | minor，新增能力       |
| `IoredisCacheClientSource`    | 新增 ioredis 适配器需要的最小结构接口                 | minor，新增公共类型   |
| `NodeRedisCacheClientSource`  | 新增 node-redis 适配器需要的最小结构接口              | minor，新增公共类型   |
| `NodeRedisCacheClientOptions` | 新增 node-redis 逻辑 key 前缀选项                     | minor，新增公共类型   |
| `createIoredisCacheClient`    | 新增 ioredis 适配工厂                                 | minor，新增能力       |
| `createNodeRedisCacheClient`  | 新增 node-redis 适配工厂                              | minor，新增能力       |
| `RedisCacheProvider`          | 构造参数改为必填 `RedisCacheClient`，删除无参默认连接 | minor，0.x 破坏性变更 |

不删除 `RedisCacheProvider` 及其他既有导出；`CacheProvider`、装饰器和注册表签名保持不变。源码初始化调用不向后兼容，迁移后由调用方直接声明、建立并关闭自己选择的 Redis 客户端。

### 代码、依赖与支持范围

- 修改范围限于 cache-decorator 的命令接口、适配器、Redis Provider、入口、测试、README、包清单、workspace 锁文件、本包变更记录及对应 OpenSpec 能力；其他子包不需要同步修改或发版。
- ioredis `^5.10.1` 从运行时依赖移至开发依赖；新增 node-redis 5.x 的 `redis` 开发依赖，用于验证真实类型、命令协议和互操作。两者均不设为 dependency 或 peerDependency，因此消费者只安装实际选择的客户端，不增加无关运行时负担。
- 未选择仅靠 mock 验证，因为 mock 无法证明真实重载签名、SCAN 响应和发布包依赖隔离；未选择将两种完整客户端类型组成联合，因为联合类型不能统一不同命令方言且会把第三方声明继续泄漏到公共 API；未拆分独立适配器 npm 包，因为当前两个小型适配器不足以抵消额外发布和版本协调成本。
- 第一版支持 ioredis 5 与 node-redis 5 的普通单实例连接和默认字符串/数字响应映射。Cluster、Sentinel 专项语义、自定义 RESP 类型映射、跨分片扫描以及自动故障切换不在本次承诺范围。

### 数据、生命周期与下游迁移

- Redis key 构造、JSON 值格式、miss 的 `undefined` 语义、秒级 TTL 以及 `SCAN COUNT 100` 不变。新旧版本连接同一数据库并解析到相同最终物理 key 时可读写同一批缓存，无需扫描、重写或删除存量数据。
- ioredis 已配置的 `keyPrefix` 继续决定物理 key；适配器只补齐 SCAN pattern/返回值的前缀语义。node-redis 调用方迁移同一数据集时显式配置等价适配器前缀。该修正改变的是 pattern 删除的正确性，不改变已写入 key 的结构。
- `RedisCacheProvider.clear()` 继续清空当前 Redis 数据库，不因逻辑前缀缩小范围。连接的创建、连接、错误监听、重连与关闭全部归调用方；库不会修改连接选项或主动关闭共享连接。
- 仓库内其他 package manifest 未声明依赖 cache-decorator；这不能证明不存在外部消费者。发布前由维护者盘点外部服务，在 `0.2.0` API 和迁移文档确定后、任何下游升级部署前通知构造方式、直接客户端依赖和连接生命周期变化。
- 回退只能让下游锁定 `0.1.3` 并恢复旧初始化方式，或发布后续修订版本，不能依赖撤回 npm 版本。数据格式没有改变，回退不需要迁移或清理 Redis 缓存。
