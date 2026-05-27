## ADDED Requirements

### Requirement: LockAcquisitionError 异常类型

LockAcquisitionError SHALL 继承自 Error 类，用于表示锁获取失败异常。实例 SHALL 包含锁的 key 信息和重试次数。

### Requirement: LockAcquisitionError 实例属性

LockAcquisitionError SHALL 提供 `key` 属性表示获取失败的锁 key，`retryCount` 属性表示已尝试的重试次数。

#### Scenario: 构造带详细信息的异常
- **WHEN** 创建 `new LockAcquisitionError('order:12345', 3)` 实例
- **THEN** `message` 为 `'Failed to acquire lock after 3 retries: order:12345'`
- **AND** `key` 属性为 `'order:12345'`
- **AND** `retryCount` 属性为 `3`

#### Scenario: 抛出并捕获异常
- **WHEN** 锁获取失败后抛出 `LockAcquisitionError`
- **THEN** 调用方可以 `try/catch` 捕获并访问 `key` 和 `retryCount` 属性