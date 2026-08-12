## Why

当前 `LoggerFactory.shutdown()` 在正常关闭后仍保留超时定时器，并且并发关闭、关闭后重建以及重复注册信号处理器的行为缺乏可靠契约。这会造成测试进程残留 open handle、调用方误判关闭已经完成，以及重新初始化后复用失效 wrapper 等生命周期问题，因此需要在继续扩展 logger 前先修复。

## What Changes

- 让同一轮并发 `shutdown()` 调用共享一个关闭结果，所有调用方都等待底层关闭完成或超时。
- 在底层关闭先完成时立即取消超时定时器，避免无意义的 event-loop handle；超时到达时允许关闭流程按确定性状态完成。
- 关闭完成后清理 container、配置和 wrapper 缓存，使后续 `init()` 或 `getLogger()` 创建全新的可用 logger。
- 明确空闲状态、多次关闭、关闭期间初始化/取 logger 以及关闭回调的行为，防止半关闭状态被继续使用。
- 让 `setupShutdownHandlers()` 对相同信号重复调用保持幂等，并提供生命周期清理，避免重复监听和测试间泄漏。
- 增加正常关闭、超时、并发调用、关闭后重新初始化、缓存失效及信号处理器重复注册的自动化测试。
- 更新 README 中优雅关闭和信号处理器的契约说明。

## Capabilities

### New Capabilities

- `logger-lifecycle`: 定义 LoggerFactory 的并发关闭、超时清理、关闭期间访问、关闭后重建及进程信号处理器生命周期行为。

### Modified Capabilities

无。

## Impact

### 影响模块和文件

- `packages/logger/src/core/LoggerFactory.ts`：关闭状态机、共享关闭 Promise、wrapper/config 清理以及信号监听器注册与释放。
- `packages/logger/src/types/index.ts`：仅在实现确有需要时补充向后兼容的生命周期类型；不改变现有 `ShutdownOptions` 字段语义。
- `packages/logger/test/LoggerFactory.test.ts` 及必要的新测试文件：覆盖并发、计时器、重建和信号处理器场景。
- `packages/logger/README.md` 与 demo：说明可等待的幂等关闭和关闭后的重新初始化行为。

### API 与兼容性

- `LoggerFactory.shutdown(options?)`、`setupShutdownHandlers(options?)`、`init()` 和 `getLogger(name)` 的现有签名保持不变，不构成源代码级 Breaking Change。
- 同一轮关闭中的重复 `shutdown()` 将从“立即返回”收紧为等待共享关闭过程，属于修正异步契约；依赖旧竞态行为的调用方会观察到等待时间变化。
- 关闭期间调用 `init()` 或 `getLogger()` 将被明确拒绝，避免继续使用正在关闭的 transport；关闭完成后缓存统一失效，下一次访问重新加载配置并创建实例。
- `onShutdown` 按每次实际启动的关闭轮次执行一次；加入同一轮关闭的后续调用不会重复执行回调。

### 依赖、性能、数据库与权限

- 不引入新的第三方 npm 包，使用现有 Promise、timer 和 Node.js process listener API。
- 正常日志热路径不增加持续开销；仅增加少量静态生命周期状态。关闭完成时主动清理 timer 和缓存，可减少资源滞留。
- 不涉及数据库 Entity、迁移、网络协议、权限或用户角色变化。
- 受影响团队包括 logger 包维护者、依赖优雅停机的服务开发团队，以及运行 Jest/CI 和容器终止流程的工程与运维团队。

### 回滚计划

- 变更保持公开方法签名，可直接回滚 logger 包版本恢复原实现。
- prerelease 阶段重点验证 SIGTERM/SIGINT、进程退出时日志刷盘和关闭后重建；若信号处理回归，可暂时由应用层自行调用 `shutdown()` 并避免注册自动处理器。
- 回滚不需要配置、数据或数据库迁移。
