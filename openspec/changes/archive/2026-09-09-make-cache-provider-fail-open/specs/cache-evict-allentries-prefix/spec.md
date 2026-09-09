## ADDED Requirements

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
