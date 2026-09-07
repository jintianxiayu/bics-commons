# redis-cache-client Specification

## Purpose

为采用不同 Redis 客户端的 TypeScript 项目提供统一的缓存接入契约，使其复用调用方已有连接和同一套缓存数据语义，并明确连接所有权、安装隔离、前缀处理以及新旧版本互操作边界。

## Requirements

### Requirement: 显式客户端适配与公共类型

包 SHALL 导出 `RedisCacheClient`、`IoredisCacheClientSource`、`NodeRedisCacheClientSource`、`NodeRedisCacheClientOptions`、`createIoredisCacheClient` 和 `createNodeRedisCacheClient`。`RedisCacheProvider` SHALL 接收必填的 `RedisCacheClient`，MUST NOT 自动识别客户端、创建默认连接或继续接受旧裸客户端构造签名。

#### Scenario: C01 自定义客户端接入统一 Provider

- **WHEN** 调用方实现 `RedisCacheClient` 的字符串读写、批量删除、扫描和数据库清理契约并传给 `RedisCacheProvider`
- **THEN** Provider 能完成全部缓存操作，无需继承内置适配器或实现完整 Redis SDK

#### Scenario: C02 ioredis 实例通过真实类型检查

- **WHEN** 调用方将已验证的 ioredis 5 普通客户端实例直接传入 `createIoredisCacheClient`，再构造 Provider
- **THEN** 严格 TypeScript 检查通过，无需 `any` 或类型断言

#### Scenario: C03 node-redis 实例通过真实类型检查

- **WHEN** 调用方将已验证的 node-redis 5 普通客户端实例直接传入 `createNodeRedisCacheClient`，再构造 Provider
- **THEN** 严格 TypeScript 检查通过，无需 `any` 或类型断言

#### Scenario: C04 不完整或错误配对的类型被拒绝

- **WHEN** 调用方在严格 TypeScript 项目中使用旧裸客户端构造、无参构造、传入 `null/undefined`、遗漏命令请求字段或把客户端传给不匹配的适配工厂
- **THEN** 对应调用产生类型错误，不能通过类型检查

### Requirement: Redis Cache Provider 保持数据语义

`RedisCacheProvider` SHALL 保持现有字符串与 JSON 值协议：原始字符串按原值写入，其他可序列化值使用 JSON；读取 SHALL 将 Redis 的 `null` 映射为 cache miss 的 `undefined`，优先解析 JSON，并在内容不是合法 JSON 时返回原始字符串。因此，内容本身是合法 JSON 文本的原始字符串 SHALL 延续被解析为对应 JSON 值的既有行为。正整数 TTL SHALL 使用秒，缺省或数值 `0` SHALL 表示不设置过期时间。

#### Scenario: V01 不存在的 key 返回 cache miss

- **WHEN** 底层客户端读取不存在或已过期的 key 并返回 `null`
- **THEN** Provider 返回 `undefined`，不调用业务之外的新连接或写入操作

#### Scenario: V02 JSON 值跨客户端读取

- **WHEN** 任一受支持客户端写入对象、数组、布尔值、数字或 `null`，再由任一受支持客户端读取同一物理 key
- **THEN** 读取结果与写入值的 JSON 表示一致，不增加客户端专属包装字段

#### Scenario: V03 非 JSON 字符串和空字符串保持原值

- **WHEN** Provider 写入不是合法 JSON 文本的普通字符串或空字符串并随后读取
- **THEN** Redis 中保存原始字符串，读取返回相同字符串

#### Scenario: V04 JSON 文本字符串沿用解析行为

- **WHEN** Provider 直接写入内容为数字、布尔值、`null`、数组或对象 JSON 表示的字符串并随后读取
- **THEN** Redis 中保存原始字符串，读取按照现有优先 JSON 解析规则返回对应 JSON 值

#### Scenario: V05 正整数 TTL 按秒传递

- **WHEN** 调用方写入值并指定正整数 TTL
- **THEN** Redis key 使用该秒数设置过期时间，不转换为毫秒、不截断为 32 位整数

#### Scenario: V06 缺省 TTL 与零 TTL 永不过期

- **WHEN** 调用方省略 TTL 或显式传入数值 `0`
- **THEN** 写入使用不带过期时间的命令，key 不因 Provider 添加的 TTL 自动过期

#### Scenario: V07 序列化失败不写入

- **WHEN** 调用方写入循环引用对象，或写入无法生成字符串结果的 `undefined`、函数或 symbol
- **THEN** Provider 调用以 `TypeError` 拒绝，底层 Redis 写入命令不执行，原有 key 保持不变

#### Scenario: V08 key 边界不被 Provider 改写

- **WHEN** 调用方使用空字符串或包含 Unicode、冒号和 Redis glob 字符的 key 进行精确读写或删除
- **THEN** Provider 将逻辑 key 原样交给适配器，不自行增加命名空间或规范化字符

### Requirement: 内置适配器统一命令响应

两个内置适配器 SHALL 将客户端特有的读写、删除、扫描和清库命令映射为 `RedisCacheClient`，并将默认响应规范化为字符串、`null`、游标结果或 `void`。适配器 MUST 保留客户端调用上下文且不修改调用方请求；不符合支持范围的响应 MUST 以 `TypeError` 拒绝。

#### Scenario: A01 ioredis 无 TTL 写入成功

- **WHEN** ioredis 适配器收到不含 TTL 的写入请求且客户端返回 `'OK'`
- **THEN** 使用普通 SET 写入原始 key/value，并以 `void` 完成

#### Scenario: A02 ioredis 带 TTL 写入成功

- **WHEN** ioredis 适配器收到含秒级 TTL 的写入请求且客户端返回 `'OK'`
- **THEN** 使用 ioredis 的秒级过期写入调用，key、value 和 TTL 与请求一致

#### Scenario: A03 node-redis 无 TTL 写入成功

- **WHEN** node-redis 适配器收到不含 TTL 的写入请求且客户端返回 `'OK'`
- **THEN** 使用普通 SET 写入经适配器前缀处理后的 key/value，并以 `void` 完成

#### Scenario: A04 node-redis 带 TTL 写入成功

- **WHEN** node-redis 适配器收到含秒级 TTL 的写入请求且客户端返回 `'OK'`
- **THEN** 使用 node-redis 的秒级过期写入调用，value 和 TTL 与请求一致

#### Scenario: A05 GET 响应规范化

- **WHEN** 任一内置适配器的 GET 返回字符串或 `null`
- **THEN** 返回同一字符串或 `null`，不解析或修改缓存内容

#### Scenario: A06 删除和清库响应规范化

- **WHEN** 任一内置适配器的删除命令返回非负整数，或清库命令返回 `'OK'`
- **THEN** 对应客户端无关操作以 `void` 完成，重复删除不存在 key 也视为成功

#### Scenario: A07 调用上下文与请求保持不变

- **WHEN** 任一适配器包装依赖 `this` 的客户端，并接收冻结的写入、批量删除或扫描请求
- **THEN** 命令可以正常调用，客户端的 `this` 正确，请求字段和数组保持原值及顺序

#### Scenario: A08 非标准响应明确失败

- **WHEN** 任一内置适配器收到不符合默认字符串、`null`、非负整数、`'OK'` 或约定扫描结构的响应
- **THEN** 返回的 Promise 以 `TypeError` 拒绝，不把未知响应当作成功、miss 或空扫描页

### Requirement: 删除、清库、重复写入与并发语义

精确删除 SHALL 对不存在 key 保持幂等；数据库清理 SHALL 延续清空当前选定 Redis 数据库的语义且重复执行保持幂等。对同一 key 的重复或并发写入 SHALL 使用普通 Redis 覆盖语义，不提供 compare-and-set、锁或跨调用顺序保证。

#### Scenario: R01 重复删除保持幂等

- **WHEN** 调用方连续两次删除同一 key
- **THEN** 两次调用均正常完成，第二次不创建 key、不报不存在错误

#### Scenario: R02 重复写入由后完成的命令覆盖

- **WHEN** 调用方依次成功写入同一 key 的两个不同值
- **THEN** 后一次写入覆盖前一次值及其 TTL，读取返回后一次写入的数据

#### Scenario: R03 并发写入不提供额外竞争控制

- **WHEN** 两个 Provider 并发写入同一物理 key 且命令均成功
- **THEN** 最终值由 Redis 实际处理顺序决定，每个调用只发出自身的一次写入，不加锁、不重试、不合并

#### Scenario: R04 重复清库保持数据库级语义

- **WHEN** 调用方对含有缓存 key 和其他业务 key 的当前数据库连续执行两次 `clear()`
- **THEN** 第一次清除当前数据库的全部 key，第二次正常完成；逻辑 key 前缀不缩小清理范围

### Requirement: 命令异常传播且不自动降级

适配器和 `RedisCacheProvider` SHALL 传播客户端命令拒绝的原始错误。Redis 不可用、连接超时、非法 TTL 或扫描失败 MUST NOT 转换为 cache miss、写入成功、删除成功或内存缓存降级；本能力不设置额外超时、离线队列或重连策略。

#### Scenario: E01 读取异常不是 cache miss

- **WHEN** GET 命令因 Redis 不可用或连接超时而拒绝
- **THEN** Provider 以同一错误拒绝，不返回 `undefined`，不执行被缓存业务方法

#### Scenario: E02 写入异常传播

- **WHEN** 直接调用 Provider 写入且 Redis 命令以错误拒绝
- **THEN** 写入调用以同一错误拒绝，不报告成功、不改用其他 Provider

#### Scenario: E03 删除或清库异常传播

- **WHEN** 精确删除、批量删除或数据库清理命令以错误拒绝
- **THEN** 对应直接调用以同一错误拒绝，不吞掉错误或继续报告完整清理成功

#### Scenario: E04 非法 TTL 在写入前被拒绝

- **WHEN** 调用方传入 Redis 拒绝的负数、非整数或非有限 TTL
- **THEN** Provider 以 `RangeError` 拒绝，不执行 Redis 写入、不替换为默认 TTL、不重试

#### Scenario: E05 真实连接不可用时不创建替代连接

- **WHEN** 已配置有限失败时间的调用方连接关闭或无法连接测试 Redis，调用方执行任一 Provider 操作
- **THEN** 调用在客户端自身失败边界内拒绝，不创建新的 ioredis、node-redis 或内存连接

### Requirement: 跨客户端及旧版本数据互操作

在相同 Redis 数据库、相同最终物理 key 和默认响应映射下，两种内置客户端 SHALL 共享同一缓存数据协议，并能读取 `0.1.3` 写入的受支持字符串和 JSON 数据。切换客户端 MUST NOT 要求重写或清理存量缓存。

#### Scenario: I01 ioredis 写入后由 node-redis 读取

- **WHEN** ioredis 适配器写入缓存后，node-redis 适配器访问同一数据库和最终物理 key
- **THEN** node-redis Provider 读取相同业务值及剩余 TTL 语义，无需数据转换

#### Scenario: I02 node-redis 写入后由 ioredis 读取

- **WHEN** node-redis 适配器写入缓存后，ioredis 适配器访问同一数据库和最终物理 key
- **THEN** ioredis Provider 读取相同业务值及剩余 TTL 语义，无需数据转换

#### Scenario: I03 新版本读取旧版本缓存

- **WHEN** `0.1.3` 使用 ioredis 写入字符串或 JSON 缓存，新版本连接同一数据库和最终物理 key
- **THEN** 新版本返回相同业务值，存量 key 不需要迁移、改名或删除

### Requirement: 调用方拥有连接生命周期

适配器、Provider、注册表与装饰器 SHALL 复用调用方传入的连接，MUST NOT 创建、连接、关闭连接，或修改连接选项、错误监听器和重连策略。

#### Scenario: O01 构造与注册不操作连接

- **WHEN** 调用方创建适配器和 Provider 并注册为默认缓存提供者
- **THEN** 不调用连接构造、connect、quit、disconnect、close 或 destroy，不更改连接配置和监听器

#### Scenario: O02 多个 Provider 共享连接

- **WHEN** 两个 Provider 复用同一客户端完成读写、删除、扫描和异常路径
- **THEN** 库不关闭或重配连接，调用方仍能用该连接执行自身命令并最终自行关闭

### Requirement: 发布包独立于客户端安装和类型

发布包 SHALL 不将 ioredis 或 node-redis 声明为运行时依赖或 peerDependency，不在入口及传递导入中加载它们，也不从公共声明引用其类型。消费者 SHALL 只需安装自身实际使用的客户端。

#### Scenario: P01 不安装 Redis 客户端也能使用非 Redis Provider

- **WHEN** workspace 外的消费项目安装本包但不安装 ioredis 或 node-redis
- **THEN** 包入口及全部适配工厂可以导入，Memory Provider 和自定义 `CacheProvider` 用法能够运行并通过严格类型检查

#### Scenario: P02 仅安装 node-redis 的消费项目

- **WHEN** 独立消费项目只直接安装本包和 node-redis 作为相关运行时依赖
- **THEN** node-redis 适配用法可以运行并通过类型检查，实际依赖树不因本包引入 ioredis

#### Scenario: P03 仅安装 ioredis 的消费项目

- **WHEN** 独立消费项目只直接安装本包和 ioredis 作为相关运行时依赖
- **THEN** ioredis 适配用法可以运行并通过类型检查，实际依赖树不因本包引入 node-redis

#### Scenario: P04 公共入口与声明不泄漏第三方客户端

- **WHEN** 检查实际打包清单、JavaScript 和 `.d.ts`，并以 `skipLibCheck: false` 编译消费项目
- **THEN** 新增公共导出完整、其余既有导出保留，既无运行时客户端加载也无第三方客户端类型导入

### Requirement: 装饰器与通用 CacheProvider 契约保持兼容

客户端适配 SHALL 不改变 `CacheProvider`、`CacheProviderRegistry`、`@Cache` 和 `@CacheEvict` 的公共签名、选项、key 生成、请求合并及既有调用顺序。Redis 适配后的 Provider SHALL 与 Memory Provider 和自定义 Provider 使用同一注册方式。

#### Scenario: D01 默认 Redis Provider 保持装饰器调用方式

- **WHEN** 调用方将适配后的 Redis Provider 注册并设为默认 Provider，再调用现有 `@Cache` 或 `@CacheEvict` 异步方法
- **THEN** 装饰器无需新增客户端选项即可从注册表取得 Provider，业务参数、返回值和 cache key 保持现有规则

#### Scenario: D02 指定 Provider 名称保持原行为

- **WHEN** 同时注册 Redis、Memory 或自定义 Provider，并在装饰器中指定 `providerName`
- **THEN** 注册表仍选择指定 Provider，客户端适配不会改变其他 Provider 的行为
