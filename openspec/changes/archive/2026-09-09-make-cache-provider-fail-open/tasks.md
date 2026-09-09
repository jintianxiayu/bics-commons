## 1. @Cache 读取故障旁路

- [x] 1.1 为 Provider 缺失、同步读取抛错和异步读取拒绝补充业务成功/失败测试，验证 `cache-operation-logging/F01-F02`、`cache-error-policy/Provider 解析或读取失败`、`redis-cache-client/E06`：业务方法只执行一次、结果或原始业务异常保持不变、不记录 miss、不调用异常策略、不回填或切换 Provider
- [x] 1.2 在 `cache.ts` 中实现可区分 hit、miss、bypass 的内部查找结果和 fail-open 分支，运行 1.1 的聚焦测试验证读取故障不会阻断业务且 bypass 状态不能继续写缓存
- [x] 1.3 补充读取故障下的并发测试，验证 `cache-operation-logging/A02`：相同 key 继续返回同一 pending Promise，Provider 读取和业务方法均只执行一次，settled 后 pending 正常清理

## 2. 缓存写入故障隔离

- [x] 2.1 为正常结果和异常条目的 Provider `set` 增加同步抛错、Promise resolve/reject 测试，验证 `cache-operation-logging/F04、F06-F07` 与 `redis-cache-client/E07`：业务成功值或原始业务异常保持不变，dispatched 仅在同步调用成功后记录，异步 rejection 记录 `cache.operation_failed`
- [x] 2.2 实现非等待写入的统一同步/异步失败观测，验证 Promise rejection 被消费且不等待、不重试、不切换 Provider；用隔离进程或等价进程级断言确认写入拒绝不会触发 `unhandledRejection`
- [x] 2.3 回归异常缓存筛选、encode/decode、独立 TTL 和合法异常命中，运行 `cache.test.ts` 与 `redis-cache-decorator.test.ts` 验证有效缓存业务异常仍按原策略传播且 Provider 故障不进入异常策略

## 3. @CacheEvict 淘汰故障隔离

- [x] 3.1 为业务成功后的 Provider 缺失、同步单 key 删除抛错、异步单 key 删除拒绝和 `allEntries` 拒绝补充测试，验证 `cache-operation-logging/F01、F03、F05-F06` 及 `cache-evict-allentries-prefix` 全部新增场景：始终返回原业务结果、不误报 completed、不求值无用 key resolver
- [x] 3.2 在 `cache-evict.ts` 中隔离 Provider 解析和删除异常，消费 fire-and-forget 删除 rejection，同时保持单 key 不等待、`allEntries` 等待成功完成以及业务失败时跳过淘汰的既有顺序；运行 3.1 的聚焦测试
- [x] 3.3 增加隔离进程或等价进程级测试，确认异步单 key 删除拒绝不会触发 `unhandledRejection`；同时运行 Provider 单元测试验证直接 `delete`/`deleteByPattern` 仍传播原始错误

## 4. 日志、公共契约与文档

- [x] 4.1 更新缓存日志测试以覆盖 `cache-operation-logging/L04`：Provider 与 Logger 同时失败仍执行业务并保留业务结果；审计异步失败日志仅使用既有 event、operation 和白名单元数据，不包含参数、返回值、缓存值、完整 key 或业务异常内容
- [x] 4.2 构建包后运行 `pnpm exec tsc -p packages/cache-decorator/test/type-contract/tsconfig.json --noEmit`，验证 `cache-operation-logging/A01、A04`：公共导出和 Provider 签名不变，`CacheOptions`/`CacheEvictOptions` 不新增 fail-open、logging 或其他配置字段
- [x] 4.3 更新 `packages/cache-decorator/README.md`，说明装饰器固定 fail-open、Provider 直接调用继续 fail-fast、异步 rejection 会被消费，以及不提供超时、重试、替代 Provider或 Memory 容量治理；运行格式检查验证文档格式
- [x] 4.4 添加 `@jintianxiayu/cache-decorator` 的 patch changeset，基于实际行为说明从 `1.0.1` 计划升级至 `1.0.2`、这是公共 API 不变但运行时错误语义不兼容的维护者批准例外、下游不能再依赖装饰器 Provider rejection，并运行 `pnpm run release:status` 核对版本计划

## 5. 兼容性与完整验证

- [x] 5.1 运行 Redis Provider 和适配器的故障测试，验证 `redis-cache-client/E01-E05`：直接调用仍传播原始错误、不创建替代连接、不改变 TTL、扫描、序列化或连接所有权
- [x] 5.2 运行 `pnpm --filter @jintianxiayu/cache-decorator test -- --runInBand --no-cache`、包级 typecheck 和 ESLint，确认全部缓存场景通过且无未处理 Promise rejection 或浮动 Promise 告警
- [x] 5.3 运行全仓 `pnpm run build`、`pnpm run lint`、`pnpm run format:check` 和 `pnpm test`，报告任何与本变更无关的既有失败，不顺带修改其他包
- [x] 5.4 按 capability + Scenario 标题审计四个 delta spec 与 Jest 测试的映射，检查遗漏、未知、重复、skip 和失败场景，并运行 `openspec validate make-cache-provider-fail-open --strict`
- [x] 5.5 正式发布前由维护者确认已知下游清单和通知时点，记录依赖旧版缓存 rejection 的迁移状态；未确认前保留为人工发布门禁，不执行 publish 或 push

### 验证记录

- 四个 delta spec 共 40 个 Scenario 均已映射到 Jest 测试、类型契约或发布清单检查；同步审计补正了日志级别与 Redis 异常条目互操作 Requirement 中两处旧错误传播表述，主规格不再与固定 fail-open 契约冲突；没有未知 Scenario 引用、冲突性重复或失败用例。
- `redis-cache-client/E01-E04` 的 Provider 故障测试已通过；使用 `CACHE_DECORATOR_TEST_REDIS_URL=redis://127.0.0.1:6379` 定向运行真实 Redis 集成测试后，`redis-cache-client/E05` 通过，确认连接不可用时不创建替代连接。整文件验证中的独立 `R04` 清库场景因 URL 指向数据库 0 被安全保护拒绝；定向验证未执行 `FLUSHDB`，不影响 E01-E05 的结论。
- 全仓 build、lint 和 test 通过；全仓 format check 仅因四个未修改的既有 `CHANGELOG.md` 格式问题失败，本次变更文件的 Prettier 检查通过。
