# Spec: cache-key-option

## Purpose

提供自定义缓存 key 的能力，支持通过 `key` 选项配置自定义缓存 key 生成逻辑，以及通过 `allEntries` 选项按缓存名称精确清除缓存条目。

## Requirements

### Requirement: @Cache 装饰器支持自定义 key 选项

`@Cache` 装饰器 SHALL 支持通过 `options.key` 配置自定义缓存 key 生成逻辑。

#### Scenario: key 为 undefined 时使用自动生成

- **WHEN** 调用 `@Cache("users", { key: undefined })` 装饰的方法
- **THEN** 缓存 key 使用 `KeyBuilder.build(cacheName, args)` 生成，格式为 `cacheName:serializedArgs`

#### Scenario: key 为 null 时使用自动生成

- **WHEN** 调用 `@Cache("users", { key: null })` 装饰的方法
- **THEN** 缓存 key 使用 `KeyBuilder.build(cacheName, args)` 生成，格式为 `cacheName:serializedArgs`

#### Scenario: key 为字符串时使用字符串值

- **WHEN** 调用 `@Cache("users", { key: "specific-key" })` 装饰的方法
- **THEN** 缓存 key 使用 `KeyBuilder.build(cacheName, ["specific-key"])` 生成，结果为 `users:specific-key`

#### Scenario: key 为函数时使用函数返回值

- **WHEN** 调用 `@Cache("users", { key: (args) => args[0].id })` 装饰的方法，传入参数 `[{"id": 123}]`
- **THEN** 缓存 key 使用 `KeyBuilder.build(cacheName, ["123"])` 生成，结果为 `users:123`

#### Scenario: key 函数抛出异常时降级到自动生成

- **WHEN** 调用 `@Cache("users", { key: () => { throw new Error("bad key"); } })` 装饰的方法
- **THEN** 缓存 key 降级使用 `KeyBuilder.build(cacheName, args)` 生成，装饰器不抛出异常

### Requirement: @CacheEvict 装饰器支持自定义 key 选项

`@CacheEvict` 装饰器 SHALL 支持通过 `options.key` 配置自定义缓存 key 生成逻辑。

#### Scenario: key 为字符串时删除对应缓存

- **WHEN** 调用 `@CacheEvict("users", { key: "target-key" })` 装饰的方法
- **THEN** 删除缓存 key 为 `KeyBuilder.build(cacheName, ["target-key"])` 的缓存条目

#### Scenario: key 为函数时使用函数返回值删除缓存

- **WHEN** 调用 `@CacheEvict("users", { key: (args) => args[0].id })` 装饰的方法，传入参数 `[{"id": 456}]`
- **THEN** 删除缓存 key 为 `KeyBuilder.build(cacheName, ["456"])` 的缓存条目

#### Scenario: allEntries 为 true 时忽略 key 选项

- **WHEN** 调用 `@CacheEvict("users", { allEntries: true, key: "ignored-key" })` 装饰的方法
- **THEN** 执行 `provider.deleteByPattern("users*")` 精确清除 users 缓存名称下的所有条目，忽略 `key` 选项

### Requirement: 向后兼容性

现有代码不提供 `key` 选项时，行为 SHALL 与之前完全一致。

#### Scenario: 不提供 key 选项时使用原有逻辑

- **WHEN** 调用 `@Cache("users")` 装饰的方法，不提供 key 选项
- **THEN** 缓存 key 使用 `KeyBuilder.build(cacheName, args)` 生成