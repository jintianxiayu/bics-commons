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

### Requirement: CacheProvider.deleteByPattern 方法签名

CacheProvider 接口 SHALL 支持 `deleteByPattern(pattern: string)` 方法，通过 glob 前缀模式删除匹配的缓存 key。

#### Scenario: pattern 末尾 * 作为前缀匹配

- **WHEN** 调用 `provider.deleteByPattern("name*")`
- **THEN** 删除所有以 "name" 开头的缓存 key

#### Scenario: MemoryCacheProvider 实现前缀匹配

- **WHEN** MemoryCacheProvider 调用 `deleteByPattern("name*")`
- **THEN** 使用 `key.startsWith("name")` 匹配并删除所有匹配的 key

#### Scenario: RedisCacheProvider 使用 SCAN 迭代删除

- **WHEN** RedisCacheProvider 调用 `deleteByPattern("name*")`
- **THEN** 使用 `SCAN cursor MATCH "name*" COUNT 100` 游标迭代删除所有匹配的 key，不会阻塞 Redis

