## ADDED Requirements

### Requirement: @DistributedLock 装饰器自动加锁解锁

@DistributedLock 装饰器 SHALL 在方法调用前自动获取锁，并在方法执行完成后（包括正常返回和异常情况）自动释放锁。锁的获取、续期和释放全过程对业务代码透明。

### Requirement: key 选项控制锁 key 生成规则

@DistributedLock 装饰器的 key 选项 SHALL 支持以下三种形式：

- `key` 为 `undefined` 或 `null` 时，锁 key 为 `ClassName.methodName`
- `key` 为字符串时，锁 key 为该字符串
- `key` 为函数时，锁 key 为该函数对 `...args` 的返回值

### Requirement: 超时与看门狗自动续期

当 `ttl` 选项设置后，看门狗 SHALL 每 `renewInterval` 毫秒自动调用 `LockProvider.renew()` 续期。续期失败（返回 `false`）时，看门狗 SHALL 停止续期并退出线程。

### Requirement: 锁获取失败抛出异常

当无法在 `retryCount` 次重试后获取锁，@DistributedLock 装饰器 SHALL 抛出 `LockAcquisitionError` 异常。

### Requirement: 装饰器仅适用于 async 方法

@DistributedLock 装饰器 SHALL 仅适用于返回 `Promise` 的 async 方法。非 async 方法 SHALL 抛出类型错误。

#### Scenario: 方法级锁 key - undefined key
- **WHEN** 使用 `@DistributedLock({})` 装饰无 key 参数的方法
- **THEN** 锁 key 为 `ClassName.methodName` 格式

#### Scenario: 字符串 key
- **WHEN** 使用 `@DistributedLock({ key: 'daily-settlement' })`
- **THEN** 锁 key 为 `daily-settlement`

#### Scenario: 函数 key
- **WHEN** 使用 `@DistributedLock({ key: (args) => \`order:\${args[0]}\` })`
- **THEN** 锁 key 由函数动态计算得出

#### Scenario: 看门狗续期成功
- **WHEN** 锁获取成功且看门狗续期返回 `true`
- **THEN** 看门狗继续下一轮续期

#### Scenario: 看门狗续期失败
- **WHEN** 看门狗续期返回 `false`
- **THEN** 看门狗停止续期线程

#### Scenario: 业务执行中锁超时
- **WHEN** 业务执行时间超过 ttl 且看门狗未能续期成功
- **THEN** 锁超时释放，但业务继续执行（业务层需自行处理边界）

#### Scenario: 锁获取失败
- **WHEN** 在 3 次重试后仍无法获取锁
- **THEN** 抛出 `LockAcquisitionError` 异常

#### Scenario: 业务正常完成
- **WHEN** 业务逻辑正常执行完成
- **THEN** 执行 `provider.release()` 释放锁，看门狗线程停止

#### Scenario: 业务抛出异常
- **WHEN** 业务逻辑抛出异常
- **THEN** 执行 `provider.release()` 释放锁后，将异常向上抛出

#### Scenario: 非 async 方法使用装饰器
- **WHEN** 对非 async 方法使用 @DistributedLock 装饰器
- **THEN** 抛出类型错误