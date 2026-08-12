## Why

当前 `LoggerContext.set()` 在没有活动作用域时通过 `AsyncLocalStorage.enterWith()` 创建可变 `Map`，该上下文会附着到当前同步执行链并被随后创建的异步任务继承，容易让一个请求的 traceId 泄漏到无关请求；`clear()` 与公开的可变 `getStore()` 还可能原地修改父子链共享状态。上下文污染会使日志关联到错误请求，比上下文缺失更难诊断，因此应作为下一项高优先级可靠性修复。

## What Changes

- 将 `withContext()` 确立为创建与传播日志上下文的推荐作用域 API，保证同步、Promise、timer 和并发异步分支之间隔离，并在正常返回、异常和 rejected Promise 后恢复调用方上下文。
- **BREAKING**：禁止 `set()` 在没有活动上下文作用域时隐式调用 `enterWith()`；无作用域调用将抛出明确错误，避免产生生命周期不受控的 ambient context。已有 `withContext()` 作用域内的 `set()` 保持可用。
- 将上下文写操作改为 copy-on-write：`set()` 与 `clear()` 不原地修改祖先作用域继承的 `Map`，嵌套或并发分支的修改不得反向污染父作用域和兄弟分支。
- 收紧 `getStore()` 的可变性边界，返回只读快照而非内部 `Map` 引用；新增类型安全的上下文值约束和运行时参数校验，拒绝空 key、非字符串 key/value 及无效回调。
- 明确 traceId 在 plain 与 JSON 输出中的一致行为：从日志调用时的活动上下文读取，不缓存到 logger 实例；无上下文时 plain 使用 `-`，JSON 不输出 `traceId`。
- 增加异步并发、嵌套覆盖、异常/rejection 恢复、无作用域写入、快照隔离及日志输出集成测试，并更新 README 和 demo 的安全用法与迁移说明。

## Capabilities

### New Capabilities

- `logger-context-isolation`: 定义日志上下文的作用域创建、异步传播、copy-on-write 写入、并发隔离、只读观察以及 traceId 输出契约。

### Modified Capabilities

无。

## Impact

### 影响模块和文件

- `packages/logger/src/core/LoggerContext.ts`：重构作用域存储、写入隔离、参数校验和只读快照。
- `packages/logger/src/core/LoggerFactory.ts` 与 `packages/logger/src/formatters/PatternFormatter.ts`：确认日志格式化仅消费当前活动上下文，并统一 plain/JSON 缺省语义。
- `packages/logger/src/types/index.ts`、`packages/logger/src/index.ts`：仅在需要时补充上下文只读类型导出，不扩大底层 AsyncLocalStorage 暴露面。
- `packages/logger/test/LoggerContext.test.ts` 及必要的集成测试：覆盖同步、异步、并发、异常和真实日志输出场景。
- `packages/logger/README.md`、`src/demo.ts` 与 `examples/demo.ts`：更新推荐用法、错误行为和迁移指南。

### API 与兼容性

- `LoggerContext.get()`、`withContext()` 及 logger 四个日志方法的调用方式保持不变。
- `LoggerContext.set()` 在无活动作用域时由隐式创建上下文改为抛错，属于有意的 Breaking Change；调用方需改为 `LoggerContext.withContext(values, fn)`，或先进入明确作用域后再调用 `set()`。
- `LoggerContext.getStore()` 保留方法名，但返回与内部状态断开的只读快照；依赖其直接修改内部 `Map` 的高级用法不再受支持，应迁移到 `set()`、`clear()` 和 `withContext()`。
- traceId 的 plain/JSON 字段语义不做不兼容调整，本变更将现有期望固化为可验证契约。

### 依赖、性能、数据库与权限

- 不引入新的第三方 npm 包，继续使用 Node.js 原生 `AsyncLocalStorage`；替代方案是显式在每层调用中传递上下文，但会显著扩大业务 API 侵入面。
- 每次 `withContext()`、`set()`、`clear()` 或 `getStore()` 需要复制当前小型上下文 Map，时间和空间复杂度为 O(k)，k 为上下文字段数；日志读取仍为 O(1)，且不增加每条日志的 Map 复制。典型 traceId/requestId 场景字段很少，预计开销可控。
- 不涉及数据库 Entity、迁移、网络协议、API 权限或用户角色变化。
- 受影响团队包括 logger 包维护者、使用 LoggerContext 的服务开发团队，以及依赖 traceId 关联日志的可观测性、运维和故障排查团队。

### 回滚计划

- 可回滚 logger 包版本恢复旧的 ambient `set()` 行为，不需要配置或数据迁移。
- prerelease 阶段应重点监控无作用域 `set()` 报错、缺失 traceId 比例、跨请求 traceId 重复率与异步链路关联完整性。
- 若迁移期间发现大量旧调用，可在应用入口统一改用 `withContext()` 包裹请求生命周期后再升级；不应通过恢复全局共享 Map 来临时规避迁移。
