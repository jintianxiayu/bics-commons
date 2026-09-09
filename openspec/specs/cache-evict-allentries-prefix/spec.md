# cache-evict-allentries-prefix Specification

## Purpose

确保 `@CacheEvict` 装饰器在 `allEntries: true` 时按缓存名称前缀精确清除对应缓存条目，不影响同一 CacheProvider 中其他缓存名称的缓存。同时新增 `CacheProvider.deleteByPattern` 方法支持 glob 前缀模式删除。
## Requirements
### Requirement: @CacheEvict allEntries 精确清除同名缓存

`@CacheEvict` 装饰器在 `allEntries: true` 时 SHALL 按缓存名称前缀精确清除对应缓存条目，不影响同一 CacheProvider 中其他缓存名称的缓存。

#### Scenario: allEntries=true 清除同名所有缓存

- **WHEN** 调用 `@CacheEvict("name", { allEntries: true })` 装饰的方法，且 provider 中存在 `name:1`、`name:2`、`cars:aa`、`cars:bb`
- **THEN** 只删除 `name:1` 和 `name:2`，`cars:aa` 和 `cars:bb` 保持不变

#### Scenario: allEntries=false 清除单条缓存

- **WHEN** 调用 `@CacheEvict("name", { allEntries: false })` 装饰的方法，传入参数 `["id-1"]`
- **THEN** 删除缓存 key 为 `KeyBuilder.build(cacheName, args)` 的单条缓存

#### Scenario: allEntries=true 配合 key 选项（key 被忽略）

- **WHEN** 调用 `@CacheEvict("name", { allEntries: true, key: "ignored-key" })` 装饰的方法
- **THEN** 忽略 `key` 选项，执行 `provider.deleteByPattern("name*")` 清除所有 name 开头的缓存

### Requirement: @CacheEvict 淘汰故障不影响业务结果

`@CacheEvict` SHALL 只在被装饰业务方法成功后尝试淘汰缓存。Provider 解析、单 key 删除或 `allEntries` 模式删除发生任何可捕获的同步异常或异步拒绝时，装饰器 MUST 记录失败并返回原业务结果；该隔离 MUST NOT 改变直接调用 `CacheProvider.delete` 或 `CacheProvider.deleteByPattern` 的错误传播契约。

#### Scenario: allEntries 淘汰失败保留业务成功

- **WHEN** 被装饰业务方法成功，随后 `deleteByPattern` 因扫描或批量删除异常而拒绝
- **THEN** `@CacheEvict` 返回业务方法的原始结果，不向调用方传播淘汰异常
- **AND** 不报告全量淘汰完成，不重试或切换 Provider

#### Scenario: 单 key 淘汰同步或异步失败

- **WHEN** 被装饰业务方法成功，随后单 key `delete` 同步抛出或返回的 Promise 拒绝
- **THEN** `@CacheEvict` 返回业务方法的原始结果，并消费异步 rejection
- **AND** 不等待异步删除、不重试或切换 Provider

#### Scenario: Provider 不存在时保留业务成功

- **WHEN** 被装饰业务方法成功，但默认或指定 Provider 无法从注册表取得
- **THEN** `@CacheEvict` 返回业务方法的原始结果，不执行 key resolver 或删除操作

#### Scenario: 直接调用 Provider 仍传播删除异常

- **WHEN** 调用方直接调用 `CacheProvider.delete` 或 `CacheProvider.deleteByPattern` 且操作同步抛出或异步拒绝
- **THEN** 直接调用继续以原始错误失败，不被装饰器的 fail-open 边界吞掉

### Requirement: CacheProvider.deleteByPattern 方法签名

CacheProvider 接口 SHALL 支持 `deleteByPattern(pattern: string)` 方法，通过 glob 前缀模式删除匹配的逻辑缓存 key。RedisCacheProvider SHALL 以 `SCAN` 游标迭代并分批删除全部匹配 key；内置 ioredis 和 node-redis 适配器 MUST 保持逻辑 pattern 与各自物理 key 前缀一致，不得遗漏前缀、重复添加前缀或扩大到其他命名空间。

#### Scenario: pattern 末尾 * 作为前缀匹配

- **WHEN** 调用 `provider.deleteByPattern("name*")`
- **THEN** 删除所有以 "name" 开头的缓存 key

#### Scenario: MemoryCacheProvider 实现前缀匹配

- **WHEN** MemoryCacheProvider 调用 `deleteByPattern("name*")`
- **THEN** 使用 `key.startsWith("name")` 匹配并删除所有匹配的 key

#### Scenario: RedisCacheProvider 使用 SCAN 迭代删除

- **WHEN** 任一内置 Redis 适配器下的 RedisCacheProvider 调用 `deleteByPattern("name*")`
- **THEN** 使用 `SCAN cursor MATCH "name*" COUNT 100` 的等价物理 pattern 迭代至游标归零，并分批删除全部匹配 key，不使用阻塞式 KEYS

#### Scenario: F04 多页、空页与重复 key 均能完成扫描

- **WHEN** SCAN 在游标归零前返回多个页面，其中包含空页面或重复 key
- **THEN** Provider 继续扫描到游标归零，重复删除保持幂等，所有匹配 key 最终删除且非匹配 key 保留

#### Scenario: F05 ioredis keyPrefix 下删除逻辑 pattern

- **WHEN** ioredis 连接配置普通字符串 `keyPrefix`，Provider 删除不含该前缀的逻辑 pattern
- **THEN** 扫描使用带该物理前缀的 pattern，返回 key 在交给 DEL 前恢复为逻辑 key，使 ioredis 只添加一次前缀

#### Scenario: F06 ioredis 特殊字符 keyPrefix 被按字面量匹配

- **WHEN** ioredis `keyPrefix` 包含 `*`、`?`、`[`、`]` 或反斜杠等 Redis glob 字符
- **THEN** 适配器在 SCAN pattern 中转义前缀字符，只匹配该字面前缀下的逻辑 key

#### Scenario: F07 node-redis 缺省前缀不改写 key

- **WHEN** 调用方省略 node-redis 适配器的可选 `keyPrefix`
- **THEN** 扫描和删除使用调用方传入的逻辑 pattern 与 key，不添加前缀

#### Scenario: F08 node-redis 显式前缀访问同一命名空间

- **WHEN** node-redis 适配器配置与既有 ioredis 物理 key 等价的 `keyPrefix`
- **THEN** node-redis 扫描、读取、写入和删除均访问该前缀下的物理 key，返回给 Provider 的扫描结果保持逻辑 key

#### Scenario: F09 扫描或批量删除失败时停止并传播

- **WHEN** 任一 SCAN 页面或该页面的批量删除命令因 Redis 不可用、连接超时或命令错误而拒绝
- **THEN** `deleteByPattern` 以同一错误拒绝，不报告完整清理成功、不切换为 KEYS 或其他 Provider
