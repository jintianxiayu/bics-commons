## ADDED Requirements

### Requirement: RedisLockProvider.acquire 原子加锁

RedisLockProvider SHALL 使用 `SET key token NX PX ttl` 命令原子性地获取锁。若锁成功设置，SHALL 返回生成的 lockToken；若锁已存在，SHALL 返回 `null`。

### Requirement: RedisLockProvider.release 校验释放

RedisLockProvider SHALL 使用 Lua 脚本原子性地释放锁。脚本 SHALL 先校验存储的 token 是否与传入 token 匹配，匹配则删除 key 并返回 `1`，不匹配则返回 `0`。

### Requirement: RedisLockProvider.renew 校验续期

RedisLockProvider SHALL 使用 Lua 脚本原子性地续期锁。脚本 SHALL 先校验存储的 token 是否与传入 token 匹配，匹配则重设 PTTL 并返回 `1`，不匹配则返回 `0`。

### Requirement: lockToken 唯一性

acquire 方法 SHALL 为每次获取生成唯一的 UUID token，用于标识锁持有者。

#### Scenario: 成功获取锁
- **WHEN** 调用 `acquire('order:12345', 30000)`
- **AND** 锁未被占用
- **THEN** 返回非 null 的 lockToken（UUID）

#### Scenario: 锁已被占用获取失败
- **WHEN** 调用 `acquire('order:12345', 30000)`
- **AND** 锁已被其他持有者占用
- **THEN** 返回 `null`

#### Scenario: 成功释放锁
- **WHEN** 调用 `release('order:12345', 'correct-token')`
- **AND** 存储的 token 与传入 token 匹配
- **THEN** 返回 `true`，key 被删除

#### Scenario: token 不匹配释放失败
- **WHEN** 调用 `release('order:12345', 'wrong-token')`
- **AND** 存储的 token 与传入 token 不匹配
- **THEN** 返回 `false`，key 保持不变

#### Scenario: 成功续期
- **WHEN** 调用 `renew('order:12345', 'correct-token', 30000)`
- **AND** 存储的 token 与传入 token 匹配
- **THEN** 返回 `true`，TTL 重置为 30000ms

#### Scenario: token 不匹配续期失败
- **WHEN** 调用 `renew('order:12345', 'wrong-token', 30000)`
- **AND** 存储的 token 与传入 token 不匹配
- **THEN** 返回 `false`，TTL 保持不变

#### Scenario: 锁超时自动释放
- **WHEN** 持有者在 ttl 时间内未主动释放锁
- **THEN** Redis 自动删除 key，锁被其他请求获取