## 1. Logger 依赖与安全日志门面

- [x] 1.1 在 `packages/lock-decorator/package.json` 的 `peerDependencies` 和 `devDependencies` 中加入 `@jintianxiayu/logger: workspace:^`，仅更新 `pnpm-lock.yaml` 中对应依赖边，并通过 lockfile diff 与 `pnpm install --lockfile-only` 确认没有加入普通 dependency 或改动无关依赖。
- [x] 1.2 新增包内 `src/core/lock-logger.ts`，实现固定 Logger 名称、13 个 event 的 level/message 映射、字段白名单、成功后缓存 Logger 和安全 `logLockEvent()`；通过聚焦单元测试验证每个事件调用准确 level/message、没有 `info` 分支且 metadata 的 `event` 不可被调用点覆盖。
- [x] 1.3 补充 Logger 惰性与故障隔离测试，验证导入包、decorator 求值和 class 定义不调用 `getLogger()`，首次运行期事件才获取并复用 Logger，且 getLogger/debug/warn/error 抛错或 Logger 已关闭时不传播、不调用 console、不改变测试锁流程。

## 2. Watchdog 续期日志与拒绝边界

- [x] 2.1 在不改变 `Watchdog` 构造、`start()`、`stop()` 公共签名的前提下，将单次 async 续期收敛到内部安全边界：`true` 记录 renewed，`false` 记录 renew 阶段 ownership_lost 并停止，rejection 记录 renew operation_failed、停止且不重新抛出；运行 Watchdog fake-timer 测试验证调用次数、事件和停止行为。
- [x] 2.2 增加隔离进程或等价故障注入测试，验证 renew Promise rejection 不产生 `unhandledRejection`、已经开始的业务仍能完成且结束时仍尝试 release；同时保留现有慢续期重叠和重复 start 行为，不以本测试误报这些范围外问题已修复。

## 3. Decorator 生命周期日志

- [x] 3.1 在 `@DistributedLock` 现有 Provider 解析、默认选项和 key 解析顺序中加入安全日志边界，验证默认 Provider 缺失和 resolver 抛错分别产生对应 operation_failed、原异常对象原样传播且后续 acquire/业务/release 不执行。
- [x] 3.2 为获取和重试流程加入单调耗时、1-based attempt、acquire_started/retry/acquired/exhausted/operation_failed 事件，运行聚焦测试覆盖首次成功、竞争后成功、耗尽、Redis rejection、同 key 并发及自定义 Provider，并同时断言原重试次数和 `LockAcquisitionError` 契约不变。
- [x] 3.3 在获取成功后记录 Watchdog started/skipped 决策，运行缺省配置及 `renewInterval >= ttl` 测试，验证实际默认毫秒值、业务与 release 顺序不变，且禁用路径不调用 renew。
- [x] 3.4 为业务执行和释放加入 execution started/completed、release started/released/ownership_lost/operation_failed，运行测试覆盖业务成功、业务异常、release true/false/rejection 及双异常，验证返回值和异常对象保持当前语义、Watchdog 先停止且 release 恰好调用一次。
- [x] 3.5 增加非法和极值选项回归测试，验证日志接入不新增参数校验或归一化，并通过源码/日志断言确认最终 key、token、参数、返回值、业务异常和 resolver 异常内容均未进入 message 或 metadata。

## 4. Logger、Redis 与发布包集成

- [x] 4.1 新增真实 Logger 隔离进程 fixture，验证 JSON 输出使用 `@jintianxiayu/lock-decorator`、事件 level 和顺序正确、traceId 由 LoggerContext 自动关联且不重复进入 metadata、基础设施异常字段按 Logger 配置脱敏，并验证 profile 能过滤 debug 只保留 warn/error。
- [x] 4.2 扩展 lock 包的 tarball 消费测试和 helper：消费项目显式安装 Logger、init/shutdown 后执行 README 示例；验证应用与 lock 包解析到同一 Logger 实例、发布 manifest 的 peer 为当前版本对应的普通 semver（预期 `^0.2.0`）、普通 dependencies 不含 Logger且缺少 peer 会被包管理器报告。
- [x] 4.3 在现有可选真实 Redis 测试中覆盖两个客户端的成功锁流程、同 key 竞争、TTL 后 ownership_lost 和连接/命令异常日志；配置了测试 Redis URL 时执行并断言结果，未配置时保持显式 skip 并如实报告没有真实 Redis 证据。
- [x] 4.4 建立 `lock-operation-logging` Scenario 到测试或人工验证的显式映射和遗漏检测，运行该检测确保 delta spec 中每个 Scenario 均有对应证据，且不得以 `openspec validate --strict` 代替行为覆盖验证。

## 5. 公共契约、文档与发布意图

- [x] 5.1 核对 `src/index.ts` 不新增日志导出，并通过 lock 包 typecheck、build、生成的 `.d.ts` 和外部严格消费编译确认 `DistributedLockOptions`、`LockProvider`、`RedisLockClient`、`RedisLockProvider`、`Watchdog` 及既有导出集合和默认值均未改变。
- [x] 5.2 更新 `packages/lock-decorator/README.md` 的安装、Logger 初始化/关闭、命名 profile、事件表、字段安全边界、renew rejection 新语义、remaining limitations 和迁移说明，并由 tarball 消费测试编译和执行 README 示例。
- [x] 5.3 使用仓库版本意图流程为 `@jintianxiayu/lock-decorator` 记录 0.x minor 变更，运行 release status/dry-run 验证本变更意图只新增 lock 包发布计划并如实保留既有的其他包计划；人工盘点并记录已知下游消费者及在采用该版本前的通知安排，无法获得清单时明确标记待负责人补充而不虚构。

## 6. 收尾验证

- [x] 6.1 运行 `openspec validate add-lock-decorator-logging --strict`，逐项核对 proposal、design、spec、测试证据和实现一致；若 Artifact 与生产语义冲突，先经确认修正 Artifact，不得削弱测试迁就实现。
- [x] 6.2 依次运行 lock 包聚焦测试、typecheck 和包级 lint，再运行根级 `pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm test`；全部通过后复核完整 diff，确认 `src/index.ts`、README、package manifest、lockfile 和 changeset 已同步且没有修改 logger 源码或其他无关文件。
