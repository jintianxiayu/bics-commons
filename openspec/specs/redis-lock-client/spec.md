# redis-lock-client Specification

## Purpose

为使用不同 Redis 客户端的项目提供统一的分布式锁接入契约，使其复用已有连接和同一套锁语义。该能力明确适配、连接所有权、安装隔离以及不同客户端与旧版本之间的互操作要求，避免客户端选择影响锁的正确性。

## Requirements

### Requirement: 显式客户端适配与公共类型

包 SHALL 导出 `RedisLockClient`、`IoredisLockClientSource`、`NodeRedisLockClientSource`、`createIoredisLockClient` 和 `createNodeRedisLockClient`。`RedisLockProvider` SHALL 接收 `RedisLockClient`，其 `setIfAbsent` 与 `eval` 请求字段全部必填，无隐含默认值；MUST NOT 自动识别客户端或继续接受旧裸客户端构造签名。

#### Scenario: C01 自定义客户端接入统一 Provider

- **WHEN** 调用方实现 `setIfAbsent` 和 `eval` 契约并传给 `RedisLockProvider`
- **THEN** Provider 能通过该对象完成获取、释放和续期，无需继承内置适配器或实现完整 Redis SDK

#### Scenario: C02 ioredis 实例通过真实类型检查

- **WHEN** 调用方将已验证的 ioredis 5 实例直接传入 `createIoredisLockClient`，再构造 Provider
- **THEN** 严格 TypeScript 检查通过，无需 `any` 或类型断言

#### Scenario: C03 node-redis 实例通过真实类型检查

- **WHEN** 调用方将已验证的 node-redis 5 普通客户端实例直接传入 `createNodeRedisLockClient`，再构造 Provider
- **THEN** 严格 TypeScript 检查通过，无需 `any` 或类型断言

#### Scenario: C04 不完整或错误配对的类型被拒绝

- **WHEN** 调用方在严格 TypeScript 项目中使用旧裸客户端构造、传入 `null/undefined`、遗漏请求必填字段或把客户端传给不匹配的适配工厂
- **THEN** 对应调用产生类型错误，不能通过类型检查

### Requirement: 内置适配器保持原子命令与响应语义

两个内置工厂 SHALL 将条件写入执行为带毫秒 TTL 的原子 NX 写入；成功响应 SHALL 返回 `true`，已存在响应 SHALL 返回 `false`，其他 SET 响应 SHALL 拒绝为 `TypeError`。脚本执行 SHALL 保持脚本、键和参数顺序并原样返回响应。适配器 MUST 保留客户端调用上下文且不修改请求。

#### Scenario: A01 ioredis 条件写入成功

- **WHEN** ioredis 适配器对未占用 key 请求条件写入且客户端返回 `'OK'`
- **THEN** 返回 `true`，写入值和毫秒 TTL 与请求一致，写入条件为 NX

#### Scenario: A02 ioredis 条件写入发生竞争

- **WHEN** ioredis 客户端为 NX 写入返回 `null`
- **THEN** 适配器返回 `false`，不覆盖现有值、不额外续期或重试

#### Scenario: A03 ioredis 脚本参数与响应保持一致

- **WHEN** 调用方通过 ioredis 适配器执行脚本，提供有序键和字符串参数，或提供空数组
- **THEN** 脚本收到完全相同的键及参数顺序，调用方得到原始脚本响应

#### Scenario: A04 node-redis 条件写入成功

- **WHEN** node-redis 适配器对未占用 key 请求条件写入且客户端返回 `'OK'`
- **THEN** 返回 `true`，写入值和毫秒 TTL 与请求一致，写入条件为 NX

#### Scenario: A05 node-redis 条件写入发生竞争

- **WHEN** node-redis 客户端为 NX 写入返回 `null`
- **THEN** 适配器返回 `false`，不覆盖现有值、不额外续期或重试

#### Scenario: A06 node-redis 脚本参数与响应保持一致

- **WHEN** 调用方通过 node-redis 适配器执行脚本，提供有序键和字符串参数，或提供空数组
- **THEN** 脚本收到完全相同的键及参数顺序，调用方得到原始脚本响应

#### Scenario: A07 调用上下文与请求保持不变

- **WHEN** 任一适配器包装依赖 `this` 的客户端，并接收冻结的条件写入请求或含冻结数组的脚本请求
- **THEN** 命令可以正常调用，客户端的 `this` 正确，请求字段与数组保持原值和顺序

#### Scenario: A08 非标准 SET 响应明确失败

- **WHEN** 任一内置适配器的条件写入收到既不是 `'OK'` 也不是 `null` 的响应
- **THEN** 返回的 Promise 以 `TypeError` 拒绝，不被视为锁获取成功或普通竞争失败

### Requirement: Redis 锁的数据协议与原子所有权

Redis 锁 SHALL 保持原始 key、UUID v4 字符串 token 和毫秒 TTL；获取 SHALL 原子地在 key 不存在时设置值及过期时间。释放和续期 MUST 原子地比较 token 后操作，仅响应数值 `1` 时返回 `true`。重复获取 MUST NOT 产生可重入效果；重复释放或对不存在 key 续期 SHALL 返回 `false`，不创建锁。

#### Scenario: L01 获取成功写入 token 和过期时间

- **WHEN** 任一内置客户端对空闲 key 请求获取具有正整数 TTL 的锁
- **THEN** 返回非空 UUID v4 token，Redis 值等于该 token，并具有请求指定的毫秒过期时间

#### Scenario: L02 重复获取不修改持有者和有效期

- **WHEN** 锁仍有效时，同一 Provider 再次请求相同 key 并指定不同 TTL
- **THEN** 返回 `null`，原 token 保持不变，原有过期时刻不因失败尝试延后

#### Scenario: L03 正确 token 释放及重复释放

- **WHEN** 持有者释放尚有效的锁，并随后使用同一 token 再次释放
- **THEN** 第一次返回 `true` 且 key 被删除，第二次返回 `false`

#### Scenario: L04 错误 token 不能释放锁

- **WHEN** 调用方使用不匹配的 token 释放锁
- **THEN** 返回 `false`，原有值和过期时刻不变

#### Scenario: L05 正确 token 可以续期

- **WHEN** 持有者使用正确 token 续期尚有效的锁
- **THEN** 返回 `true`，值不变，过期时间按新的毫秒 TTL 更新

#### Scenario: L06 错误 token 不能续期

- **WHEN** 调用方使用不匹配的 token 请求续期
- **THEN** 返回 `false`，原有值和过期时刻不变

#### Scenario: L07 不存在的锁不能释放或续期

- **WHEN** 调用方对不存在的 key 释放或续期
- **THEN** 均返回 `false`，Redis 不创建该 key

#### Scenario: L08 过期重获后旧 token 失效

- **WHEN** 旧锁自然过期，另一调用取得同一 key 的新 token，旧持有者随后释放和续期
- **THEN** 两个旧 token 操作均返回 `false`，新持有者的值和过期时刻保持不变

#### Scenario: L09 key 和 TTL 边界不被适配层改写

- **WHEN** 调用方使用空字符串或含 Unicode、冒号的 key，并传入 `1` 或 `2147483648` 毫秒 TTL
- **THEN** Provider 与适配器原样传递 key 和 TTL，不添加命名空间、不使用秒换算或 32 位截断

### Requirement: 命令异常传播且不自动降级

适配器和 Redis Provider SHALL 传播命令拒绝的原始错误。Redis 不可用、命令超时、非法命令参数或脚本失败 MUST NOT 转换为普通竞争失败、返回成功或触发无锁业务执行。本能力不另设连接超时、离线队列或重连策略，失败完成时间取决于调用方连接配置。

#### Scenario: E01 获取异常阻止业务执行

- **WHEN** 任一内置适配器的设锁命令以错误拒绝，且装饰器配置了竞争重试
- **THEN** Provider 与装饰器调用以同一错误拒绝，业务不执行，不把错误当作 `null` 继续竞争重试

#### Scenario: E02 释放命令异常传播

- **WHEN** 任一内置适配器执行释放脚本时命令以错误拒绝
- **THEN** `release` 以同一错误拒绝，不返回 `true/false` 掩盖异常

#### Scenario: E03 续期命令异常传播

- **WHEN** 任一内置适配器执行续期脚本时命令以错误拒绝
- **THEN** 直接调用 `renew` 以同一错误拒绝，不返回 `true/false` 掩盖异常

#### Scenario: E04 非法加锁 TTL 不被修复或吞掉

- **WHEN** 调用方使用 Redis 拒绝的加锁 TTL，例如 `0`、负值、非整数或 `NaN`
- **THEN** 对应命令拒绝向调用方传播，不替换为默认 TTL，不返回 token

#### Scenario: E05 真实连接不可用时无降级成功

- **WHEN** 已配置有限失败时间和禁用离线排队的测试客户端关闭或无法连接测试 Redis，调用方请求获取锁
- **THEN** 获取调用在该客户端的失败边界内拒绝，不返回 token，也不触发客户端之外的新连接

### Requirement: 跨客户端及旧版本协议互操作

在相同 Redis 数据库、相同有效 key 和默认响应映射下，两种内置客户端 SHALL 共享同一锁协议，并与 `0.1.3` 的协议互操作。客户端前缀由连接或调用方管理，库 MUST NOT 添加额外前缀。

#### Scenario: I01 不同客户端并发竞争同一把锁

- **WHEN** ioredis 和 node-redis 两端同时获取同一个空闲 key，竞争期间锁不自然过期
- **THEN** 恰有一个调用返回 token，另一调用返回 `null`，失败方不能使用不匹配 token 释放持有者的锁

#### Scenario: I02 新旧协议双向互斥

- **WHEN** 旧版协议已经持有某 key，新版请求获取；随后反向由新版持有，旧版请求获取
- **THEN** 两个方向的竞争方均失败，正确 token 可以按原协议释放和续期，不需要转换 Redis 数据

#### Scenario: I03 前缀配置对应同一有效 key

- **WHEN** ioredis 连接配置 keyPrefix，node-redis 使用包含同一前缀的显式 key，使两端最终访问同一个 Redis key
- **THEN** 两端保持互斥，释放及续期操作访问同一 key，不重复添加或遗漏前缀

### Requirement: 调用方拥有连接生命周期

适配器、Provider、注册表与装饰器 SHALL 复用调用方传入的连接，MUST NOT 创建、连接、关闭连接或修改其选项与监听器。

#### Scenario: O01 构造与注册不操作连接

- **WHEN** 调用方创建适配器和 Provider 并注册为默认锁提供者
- **THEN** 不调用任何连接创建、connect、quit、disconnect 或 destroy 操作，不更改连接配置和监听器

#### Scenario: O02 多个 Provider 共享连接

- **WHEN** 两个 Provider 复用同一客户端完成获取、释放和续期，包括命令失败路径
- **THEN** 库不关闭或重配连接，调用方仍能用该连接执行自己的命令

### Requirement: 发布包独立于客户端安装和类型

发布包 SHALL 不将 ioredis 或 node-redis 声明为运行时依赖或 peerDependency，不在入口及传递导入中加载它们，也不从公共声明引用其类型。消费者 SHALL 只需安装自身实际使用的客户端。

#### Scenario: P01 不安装客户端也能使用自定义提供者

- **WHEN** workspace 外的消费项目安装本包但不安装 ioredis 或 node-redis
- **THEN** 包入口及全部适配工厂可以导入，自定义 `RedisLockClient` 和自定义 `LockProvider` 用法均可运行并通过严格类型检查

#### Scenario: P02 仅安装 node-redis 的消费项目

- **WHEN** 独立消费项目只直接安装本包和 node-redis 作为相关运行时依赖
- **THEN** node-redis 适配用法可以运行并通过类型检查，实际依赖树不因本包引入 ioredis

#### Scenario: P03 仅安装 ioredis 的消费项目

- **WHEN** 独立消费项目只直接安装本包和 ioredis 作为相关运行时依赖
- **THEN** ioredis 适配用法可以运行并通过类型检查，实际依赖树不因本包引入 node-redis

#### Scenario: P04 公共入口与声明不泄漏第三方客户端

- **WHEN** 检查实际打包的清单、JavaScript 和 `.d.ts` 并以 `skipLibCheck: false` 编译消费项目
- **THEN** 新增公共导出完整、其余既有导出保留，既无运行时客户端加载也无第三方客户端类型导入，消费者不需要补装未使用客户端

### Requirement: 装饰器和自定义锁后端的兼容性

客户端适配 SHALL 不改变 `LockProvider`、注册表及装饰器公共选项，继续使用默认 Provider、既有竞争重试和正常的看门狗续期流程。业务完成或抛错后 SHALL 按现有顺序停止看门狗并释放锁；本能力不扩展续期拒绝或释放拒绝时的异常优先级契约。

#### Scenario: D01 缺省装饰器配置保持原行为

- **WHEN** 注册适配后的默认 Provider，调用未传选项的 `@DistributedLock()` 异步实例方法
- **THEN** key 仍为 `ClassName.methodName`，TTL 为 30000 毫秒、续期间隔为 10000 毫秒、竞争重试次数为 0
- **AND** 业务返回值保持不变，正常续期使用同一 key 和 token，最终停止续期并释放锁

#### Scenario: D02 显式重试配置仅重试竞争

- **WHEN** 装饰器指定 key、TTL、`retryCount` 和 `retryDelay`，Provider 先返回 `null` 后成功
- **THEN** 按指定次数和间隔重试，成功后业务只执行一次；超过次数仍未成功则抛出 `LockAcquisitionError` 且不执行业务

#### Scenario: D03 业务异常后的正常清理

- **WHEN** 获取锁成功后业务抛出异常，停止续期和释放锁正常完成
- **THEN** 原业务异常向调用方传播，看门狗停止，锁被释放

#### Scenario: D04 既有自定义 LockProvider 继续可用

- **WHEN** 调用方注册仅实现原有 `acquire/release/renew` 的自定义 `LockProvider`
- **THEN** 无需新增 Redis 适配器即可继续使用装饰器、注册表与看门狗
