## 1. 调用点审计与测试基线

- [x] 1.1 检索 logger 包、示例和仓库内 `LoggerContext.set()`、`clear()`、`getStore()` 调用点，记录需迁移的无作用域写入和可变 store 用法（后续任务依赖本项）
- [x] 1.2 在现有 LoggerContext 测试中建立无 ambient context 的隔离基线，并添加可复用的 deferred/barrier 测试辅助函数（依赖 1.1）

## 2. LoggerContext 输入与作用域契约

- [x] 2.1 为 `get()`、`set()` 实现非空字符串 key 与字符串 value 的原子运行时校验，覆盖空字符串 value 和全部无效参数（依赖 1.2）
- [x] 2.2 为 `withContext()` 实现普通对象、全部 entry 和函数回调的预校验，确保失败时不执行回调或修改上下文（依赖 2.1）
- [x] 2.3 禁止 `set()` 在无活动作用域时创建 ambient context，返回包含 `withContext` 迁移提示的明确错误；保持无作用域 `get()` 返回 undefined、`clear()` no-op（依赖 2.1）
- [x] 2.4 补充无作用域读写、有效/无效参数、抛错 getter、同步返回与同步异常恢复的单元测试（依赖 2.2、2.3）

## 3. Copy-on-write 与异步隔离

- [x] 3.1 将活动作用域内 `set()` 改为 Map copy-on-write，并验证后续子任务继承新值而父作用域不变（依赖 2.3）
- [x] 3.2 将活动作用域内 `clear()` 改为空 Map 快照切换，并验证父作用域与已有兄弟分支不受影响（依赖 3.1）
- [x] 3.3 补充嵌套继承/覆盖、Promise、timer、同步异常和 Promise rejection 后恢复的单元测试（依赖 3.1、3.2）
- [x] 3.4 使用 barrier 补充两个并发分支交错 `set()`、`clear()` 及创建子任务的隔离测试，不使用真实时间竞态（依赖 3.3）

## 4. 只读上下文快照

- [x] 4.1 将 `getStore()` 调整为返回独立 `ReadonlyMap<string, string>` 快照，并保持无作用域返回 undefined（依赖 3.2）
- [x] 4.2 增加快照内容、TypeScript 只读签名以及绕过类型执行 set/delete/clear 仍不污染内部状态的测试（依赖 4.1）
- [x] 4.3 检查包根和类型导出，确保只暴露必要的公共只读类型且不导出 AsyncLocalStorage 或内部可变状态（依赖 4.1）

## 5. 日志调用边界 traceId 捕获

- [x] 5.1 新增内部 traceId metadata 模块，以独立 Symbol 表示“已捕获且有值/已捕获但缺失”，并确保不从包根导出（依赖 3.1）
- [x] 5.2 扩展 LoggerFactory 日志 metadata 创建逻辑，在需要 traceId 的启用输出路径中于 debug/info/warn/error 调用边界读取一次当前值（依赖 5.1）
- [x] 5.3 调整 plain formatter 消费预捕获值并在已捕获缺失时输出 `-`，保证重复占位符和多个 plain transport 复用同一值（依赖 5.2）
- [x] 5.4 调整 JSON formatter 从内部 metadata 输出顶层 traceId 或省略字段，并验证 Symbol 和捕获状态不进入序列化结果（依赖 5.2）
- [x] 5.5 对齐 PatternFormatter：优先消费预捕获 metadata，独立使用时读取当前上下文，且不得把“已捕获缺失”回退为格式化阶段的新上下文（依赖 5.1、5.3）

## 6. Logger 输出集成测试

- [x] 6.1 增加 plain 集成测试，覆盖调用时 traceId、无上下文 `-`、重复占位符、logger 跨作用域复用及延迟格式化（依赖 5.3）
- [x] 6.2 增加 JSON 集成测试，覆盖顶层 traceId、无值省略、内部 Symbol 隔离及作用域结束后延迟格式化（依赖 5.4）
- [x] 6.3 增加 plain/JSON 混合 transport 集成测试，验证同一事件使用相同调用时 traceId 且后续上下文变化不影响已提交事件（依赖 6.1、6.2）
- [x] 6.4 增加 PatternFormatter 预捕获、有意缺失和独立 fallback 三条路径的单元测试（依赖 5.5）

## 7. 文档、示例与迁移

- [x] 7.1 更新 README 的 LoggerContext API，明确 `withContext()` 推荐用法、无作用域 `set()` 错误、copy-on-write、只读快照及 plain/JSON traceId 语义（依赖 4.3、6.3）
- [x] 7.2 更新 README 迁移章节，将旧的顶层 `set()/clear()` 示例改为请求入口 `withContext()`，并说明 `getStore()` 直接修改的替代方式（依赖 7.1）
- [x] 7.3 更新 `src/demo.ts` 与 `examples/demo.ts`，确保 async callback 被正确返回/等待，示范嵌套作用域内 `set()` 且不产生 ambient context（依赖 7.2）
- [x] 7.4 记录 prerelease 验证指标与回滚步骤，包括无作用域错误、traceId 缺失/重复率和日志性能；本包无 HTTP API，因此无需 Swagger 更新（依赖 7.1）

## 8. 完整验证

- [x] 8.1 运行 logger 全量 Jest（含 open handle 检测），确认并发测试无泄漏且现有安全配置、生命周期、meta 和 LogPosition 行为无回归（依赖 6.4、7.3）
- [x] 8.2 运行 logger TypeScript build、ESLint、Prettier 检查及示例代码类型检查（依赖 8.1）
- [x] 8.3 运行 OpenSpec strict validation，并逐项核对本清单与 `logger-context-isolation` 全部场景均有实现和测试证据（依赖 8.2）
