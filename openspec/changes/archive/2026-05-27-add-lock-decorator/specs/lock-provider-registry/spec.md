## ADDED Requirements

### Requirement: LockProviderRegistry.register 注册提供者

LockProviderRegistry SHALL 提供 `register(name: string, provider: LockProvider)` 方法将锁提供者注册到全局注册表。

### Requirement: LockProviderRegistry.get 获取提供者

LockProviderRegistry SHALL 提供 `get(name?: string): LockProvider` 方法获取已注册的提供者。若未指定 name 且已设置默认提供者，返回默认提供者。若未注册或无默认提供者，SHALL 抛出错误。

### Requirement: LockProviderRegistry.setDefault 设置默认提供者

LockProviderRegistry SHALL 提供 `setDefault(name: string)` 方法设置默认提供者名称。

### Requirement: LockProviderRegistry.clear 清空注册表

LockProviderRegistry SHALL 提供 `clear()` 方法清空注册表，用于测试或重新初始化场景。

#### Scenario: 注册 Redis 提供者
- **WHEN** 调用 `LockProviderRegistry.register('redis', redisProvider)`
- **THEN** 提供者被存储到注册表

#### Scenario: 获取指定名称的提供者
- **WHEN** 调用 `LockProviderRegistry.get('redis')`
- **THEN** 返回之前注册的 redisProvider

#### Scenario: 获取默认提供者
- **WHEN** 调用 `LockProviderRegistry.setDefault('redis')` 后再调用 `LockProviderRegistry.get()`
- **THEN** 返回 redisProvider

#### Scenario: 获取未注册的提供者
- **WHEN** 调用 `LockProviderRegistry.get('nonexistent')`
- **THEN** 抛出 `Error('CacheProvider "nonexistent" not found')`

#### Scenario: 未注册且无默认提供者时获取
- **WHEN** 调用 `LockProviderRegistry.get()`
- **THEN** 抛出 `Error('No CacheProvider registered and no default set')`