## Why

`@jintianxiayu/lock-decorator` 当前无法输出锁获取、竞争重试、续期、业务执行和释放结果，依赖方难以区分正常竞争、锁所有权丢失与 Redis 基础设施故障。需要复用仓库统一的 `@jintianxiayu/logger` 建立结构化证据链，同时避免日志故障反向改变分布式锁与业务结果。

## What Changes

- 在 `@DistributedLock` 的运行期编排层记录 Provider 解析、key 解析、获取与重试、Watchdog 启停决策、业务执行结果及锁释放结果；内置和自定义 `LockProvider` 因而获得一致日志，直接调用底层 Provider 不纳入本能力。
- 在 `Watchdog` 记录续期成功、锁所有权丢失和续期异常；续期 Promise 拒绝时在定时器边界捕获异常、停止 Watchdog，并保持已经开始的业务继续执行。
- 使用固定命名 Logger `@jintianxiayu/lock-decorator`：正常流程使用 `debug`，竞争耗尽与所有权丢失使用 `warn`，Provider 或锁操作异常使用 `error`；不使用 `info` 输出高频锁事件。
- 日志采用固定事件名和字段白名单，只记录类/方法标识、锁配置、尝试次数、耗时、阶段与结果；禁止输出完整 lock key、token、方法参数、业务返回值和业务异常内容，`traceId` 由 Logger 自动关联。
- Logger 仅在第一次实际记录日志时惰性获取，lock 包不初始化或关闭 Logger；Logger 获取和同步写入失败均被隔离，不使用 `console` 等第二通道兜底。
- 保持现有 Provider 获取、key 计算、锁获取重试、业务调用、Watchdog 停止及释放顺序，不改变 Redis key、token、TTL、Lua 脚本或客户端连接生命周期；慢获取有效性、续期重叠、重复 `start()` 和业务/释放双失败合并不在本变更范围。
- 补充日志事件、级别、顺序、敏感信息边界、Logger 故障隔离、续期拒绝处理及发布包 peer 解析测试，并更新 lock 包 README。
- **BREAKING**：`@jintianxiayu/lock-decorator` 新增对 `@jintianxiayu/logger` 的必需运行时 peer；续期 Promise 拒绝由未处理拒绝改为记录错误、停止续期且不打断业务。0.x 版本线按 minor 发布。

## Capabilities

### New Capabilities

- `lock-operation-logging`: 定义分布式锁关键运行节点的结构化日志、固定 level、敏感信息边界、Logger 生命周期与故障隔离，以及 Watchdog 续期异常的安全处理语义。

### Modified Capabilities

（无）

## Impact

- **代码范围**：预计新增 `packages/lock-decorator/src/core/lock-logger.ts`，修改 `src/decorators/distributed-lock.ts`、`src/core/watchdog.ts`、相关测试、`packages/lock-decorator/package.json`、`pnpm-lock.yaml`、包 README 和发布 changeset；`@jintianxiayu/logger` 源码不变。
- **公共 API**：不修改任何包的 `src/index.ts` 导出面，也不修改 `DistributedLock`、`DistributedLockOptions`、`LockProvider`、`RedisLockClient`、`RedisLockProvider` 或 `Watchdog` 的公共 TypeScript 签名。变化仅包括必需 peer、日志副作用和明确的 Watchdog 续期拒绝运行时语义。
- **版本与兼容性**：新增必需 peer 和 Watchdog 行为修正对既有消费者可见，符合本仓库 0.x 破坏性变更提升 minor 的策略；当前 `0.1.x` 版本线预计进入 `0.2.0`，实际版本以发布计划为准。Logger 包没有代码或公共契约变化，不需要同步发版。
- **依赖选择**：不新增第三方依赖。`@jintianxiayu/logger` 在 `peerDependencies` 与开发期 `devDependencies` 中使用 `workspace:^`，使宿主应用与 lock 包共享唯一 Logger runtime、配置和 `LoggerContext`；不使用普通 `dependencies`，避免重复安装隔离进程级日志状态；不增加自定义日志回调或 `console`，避免扩展锁选项和绕过统一脱敏。
- **安装负担与迁移**：既有消费者升级时必须安装兼容 Logger，并在第一次锁调用前完成 `LoggerFactory.init()`，退出时由应用统一 `shutdown()`。仓库内未维护已知下游服务清单；发布前必须盘点所有 lock 包消费者，并在其采用该 minor 版本前通知必需 peer、新增日志和续期拒绝语义。
- **跨进程兼容**：Redis 最终 key、锁值/token、TTL 与 Lua 协议均不变化，存量锁无需迁移或清理。Logger 的 plain/json 格式和 YAML 配置结构不变，只新增 lock 包产生的事件；新旧 lock 版本共存时旧版本不产生日志，新版本可按 Logger 名称和 `meta.event` 区分。
- **性能与安全**：正常及续期成功事件使用 `debug`，由应用配置筛选；每次锁调用和续期会增加少量元数据构造及 Logger 调用。完整 key、token、参数和结果不进入日志，基础设施异常仍经过 Logger 的规范化与脱敏链路。
- **回滚**：已发布 npm 版本不能撤回；需要回滚时发布修订版本关闭或修正日志，或由下游锁定升级前版本并恢复旧依赖。已经落盘的日志按现有保留策略处理，Redis 数据无需回滚。
