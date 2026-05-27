# Spec: cache-key-option (Delta)

## MODIFIED Requirements

### Requirement: @CacheEvict 装饰器支持自定义 key 选项

`@CacheEvict` 装饰器 SHALL 支持通过 `options.key` 配置自定义缓存 key 生成逻辑。

#### Scenario: key 为字符串时删除对应缓存

- **WHEN** 调用 `@CacheEvict("users", { key: "target-key" })` 装饰的方法
- **THEN** 删除缓存 key 为 `KeyBuilder.build(cacheName, ["target-key"])` 的缓存条目

#### Scenario: key 为函数时使用函数返回值删除缓存

- **WHEN** 调用 `@CacheEvict("users", { key: (args) => args[0].id })` 装饰的方法，传入参数 `[{"id": 456}]`
- **THEN** 删除缓存 key 为 `KeyBuilder.build(cacheName, ["456"])` 的缓存条目

#### Scenario: allEntries 为 true 时按缓存名称精确清除

- **WHEN** 调用 `@CacheEvict("users", { allEntries: true, key: "ignored-key" })` 装饰的方法
- **THEN** 执行 `provider.deleteByPattern("users*")` 精确清除 users 缓存名称下的所有条目，忽略 `key` 选项

### Requirement: 向后兼容性

现有代码不提供 `key` 选项时，行为 SHALL 与之前完全一致。

#### Scenario: 不提供 key 选项时使用原有逻辑

- **WHEN** 调用 `@Cache("users")` 装饰的方法，不提供 key 选项
- **THEN** 缓存 key 使用 `KeyBuilder.build(cacheName, args)` 生成