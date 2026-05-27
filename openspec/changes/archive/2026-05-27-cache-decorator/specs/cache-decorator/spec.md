## ADDED Requirements

### Requirement: @Cache 装饰器
@Cache 装饰器 SHALL 允许用户为方法声明式地添加缓存功能。缓存 key 由缓存名称和入参值组成。

#### Scenario: 基础缓存
- **WHEN** 用户在方法上标注 `@Cache('user-cache')`
- **THEN** 系统 SHALL 使用方法入参值生成缓存 key，并在首次调用后将结果存入缓存

#### Scenario: TTL 过期
- **WHEN** 用户配置 `@Cache('user-cache', { ttl: 60000 })`
- **THEN** 缓存条目 SHALL 在 60 秒后自动失效

#### Scenario: 缓存命中
- **WHEN** 缓存存在且未过期时再次调用同一方法
- **THEN** 系统 SHALL 直接返回缓存值，不执行原方法

#### Scenario: 错误结果缓存
- **WHEN** 原方法抛出异常
- **THEN** 系统 SHALL 将异常结果也存入缓存，下次调用直接返回错误

#### Scenario: 请求合并
- **WHEN** 多个并发请求使用相同的缓存 key
- **THEN** 系统 SHALL 返回同一个 Promise，避免重复执行

### Requirement: @CacheEvict 装饰器
@CacheEvict 装饰器 SHALL 允许用户在方法执行后清除缓存。

#### Scenario: 按入参清除
- **WHEN** 用户在方法上标注 `@CacheEvict('user-cache')`
- **THEN** 系统 SHALL 在方法执行成功后，使用相同入参生成的 key 清除对应缓存条目

#### Scenario: 清除所有条目
- **WHEN** 用户配置 `@CacheEvict('user-cache', { allEntries: true })`
- **THEN** 系统 SHALL 清除该缓存名称下的所有缓存条目

### Requirement: CacheProvider 可插拔
系统 SHALL 支持可插拔的缓存存储后端。

#### Scenario: 内存 Provider
- **WHEN** 用户使用 MemoryCacheProvider
- **THEN** 缓存 SHALL 存储在内存 Map 中

#### Scenario: Redis Provider
- **WHEN** 用户使用 RedisCacheProvider
- **THEN** 缓存 SHALL 存储在 Redis 中，支持分布式共享

#### Scenario: 自定义 Provider
- **WHEN** 用户实现 CacheProvider 接口
- **THEN** 用户 SHALL 可通过 CacheProviderRegistry 注册并使用自定义 Provider

### Requirement: CacheProviderRegistry 全局注册
系统 SHALL 提供全局的缓存提供者注册表。

#### Scenario: 注册 Provider
- **WHEN** 用户调用 `CacheProviderRegistry.register('memory', provider)`
- **THEN** 系统 SHALL 将 Provider 注册到注册表

#### Scenario: 获取 Provider
- **WHEN** 用户调用 `CacheProviderRegistry.get('memory')`
- **THEN** 系统 SHALL 返回已注册的 Provider 实例

#### Scenario: 设置默认 Provider
- **WHEN** 用户调用 `CacheProviderRegistry.setDefault('memory')`
- **THEN** 后续未指定 Provider 的 @Cache SHALL 使用默认 Provider