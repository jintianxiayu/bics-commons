## Context

参见 `proposal.md` 的 Why。当前 `LoggerContext` 使用单个 `AsyncLocalStorage<Map<string, string>>`：`withContext()` 在入口复制 Map，但 `set()`、`clear()` 和 `getStore()` 都直接操作当前 Map；无 store 时 `set()` 通过 `enterWith()` 创建 ambient context。LoggerFactory 的 plain/JSON formatter 在格式化阶段读取 store，无法保证异步 transport 看到的是日志 API 调用时的上下文。

本设计受以下约束：保持 `get`、`set`、`clear`、`withContext`、`getStore` 方法名；不引入依赖；支持同步和 Promise 回调；内部上下文元数据不得进入 JSON；与现有脱敏、meta 规范化和 LogPosition Symbol 元数据并存。

## Goals / Non-Goals

**Goals:**

- 让作用域、父子层级和并发分支的上下文变化具有确定性隔离。
- 在运行时阻止无作用域写入和无效 JavaScript 参数。
- 在 logger wrapper 边界冻结单条事件的 traceId，同时保持 JSON 元数据干净。
- 用自动化测试证明同步、异步、异常、并发和 formatter 延迟场景。

**Non-Goals:**

- 不实现完整 OpenTelemetry baggage、span 生命周期或跨进程 header 注入。
- 不支持在无作用域环境中创建进程级全局日志上下文。
- 不把任意上下文字段自动输出到日志；本次只固化现有 traceId 行为。
- 不改变日志配置 schema、脱敏规则、LogPosition 或 shutdown 状态机。

## Decisions

### 1. 使用不可共享写入的 Map 快照和 AsyncLocalStorage 作用域

`withContext(values, fn)` 在参数全部校验后，以当前 store 的浅复制为基线合并 values，再通过 `AsyncLocalStorage.run()` 执行回调。Map 的 key/value 均为 string，浅复制足以隔离数据。

`set()` 和 `clear()` 不再修改当前 Map，而是创建新 Map，并对当前执行上下文调用 `enterWith()` 切换到该快照。这样当前分支后续创建的子任务继承新快照，已存在的父级与兄弟 async resource 继续引用旧快照。无 store 的 `set()` 抛错；无 store 的 `clear()` 保持 no-op。

备选方案：继续原地修改 Map，性能略低开销但无法隔离并发分支；只允许通过新的嵌套 `withContext()` 修改会删除现有 `set/clear` 用法；使用 immutable collection 会引入不必要依赖。因此选择原生 Map copy-on-write。

### 2. 先完整校验，再进入或切换上下文

key 必须是 trim 后非空的 string，但保存原始非空字符串；value 可为空字符串但必须为 string。`withContext` 的 values 必须是非 null、非数组且原型为 `Object.prototype` 或 `null` 的对象，所有自有可枚举项都要通过相同校验；fn 必须是函数。类型/结构错误使用 `TypeError`，无活动 store 的合法 `set()` 使用包含 `withContext` 的 `Error`。

校验在复制、`run()` 或 `enterWith()` 之前完成，避免部分字段已写入后才失败。读取 values 时若 getter 抛错，让原错误传播且不执行回调、不切换上下文。

备选方案：仅依赖 TypeScript 类型不能保护 JavaScript 调用方或 `as unknown`；自动 String 强转会隐藏配置错误，并可能把敏感对象意外写入上下文，因此拒绝无效输入。

### 3. `getStore()` 返回断开的只读快照

公开签名调整为 `ReadonlyMap<string, string> | undefined`，每次调用返回 `new Map(currentStore)`。只读类型阻止正常 TypeScript 修改；独立副本保证 JavaScript 强制 `set/delete/clear` 也无法污染内部状态。logger 热路径不调用 `getStore()`，而通过 `LoggerContext.get('traceId')` O(1) 读取，避免每条日志复制 Map。

备选方案：`Object.freeze(new Map())` 不能阻止 Map 内建变更方法；自定义 Proxy/ReadonlyMap wrapper 增加复杂度。快照同时满足类型与运行时隔离。

### 4. 在 Logger API 边界捕获 traceId，并以内部 Symbol 传递

wrapper 的四个日志方法创建事件 metadata 时读取一次 `LoggerContext.get('traceId')`。只有启用的输出路径需要 traceId 时才读取：JSON console 始终需要；plain console 或 file 仅在 pattern 包含 `%{traceId}` 时需要。捕获值通过不可枚举语义的内部 Symbol key 附加到 info 对象，plain 与 JSON formatter 读取同一值；没有值时不设置 Symbol。

格式化器必须区分“已在 wrapper 捕获但当时无 traceId”和“独立使用 PatternFormatter、没有 wrapper metadata”。为此 metadata 使用带 `captured: true` 的结构，而不是仅以 Symbol 是否有字符串判断。前者必须保持缺失，不能在延迟格式化时重新读取另一个上下文；后者可为兼容独立 formatter 用法在格式化时读取当前上下文。

JSON formatter把捕获值复制为顶层 `traceId` 后交给 `winston.format.json()`；Symbol 不会被 JSON 枚举。plain formatter缺失时使用 `-`。这一模式与 LogPosition 的内部 Symbol 传递一致，但使用独立 Symbol 和类型，避免两个能力耦合。

备选方案：继续在 formatter 阶段读取实现简单，但异步 transport 可能丢失或串用上下文；把 traceId 作为普通 info 字段传递会让不需要该字段的 JSON 或第三方 transport 意外暴露内部状态。

### 5. 模块边界与依赖关系

| 模块                                          | 功能                                                          | 主要依赖                              | 被依赖方                                  | 变更                           |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------- | ----------------------------------------- | ------------------------------ |
| `LoggerContext.ts`                            | 作用域创建、读取、copy-on-write 写入、校验、只读快照          | Node.js `async_hooks`                 | LoggerFactory、PatternFormatter、用户代码 | 核心重构                       |
| `LogContextMetadata.ts`（内部，可按实现命名） | 定义 traceId 捕获状态 Symbol 与安全读取函数                   | 无                                    | LoggerFactory、PatternFormatter           | 新增，不从包根导出             |
| `LoggerFactory.ts`                            | 在日志 API 边界按需捕获 traceId，供 plain/JSON transport 复用 | LoggerContext、内部 metadata、Winston | 包公共 API                                | 调整 wrapper 和 formatter      |
| `PatternFormatter.ts`                         | 消费预捕获 traceId；独立使用时兼容读取活动上下文              | LoggerContext、内部 metadata          | 内部/测试                                 | 对齐工厂 formatter             |
| `types/index.ts`                              | 暴露既有 logger 类型                                          | 无                                    | 用户代码                                  | 仅在确需命名类型时补充只读类型 |
| `index.ts`                                    | 包根导出                                                      | 上述公共模块                          | 用户代码                                  | 不导出内部 Symbol              |
| 测试与文档                                    | 验证契约和说明迁移                                            | Jest、现有 Winston 测试工具           | 维护者/用户                               | 扩展                           |

依赖方向保持 `formatter/factory → context + internal metadata`，`LoggerContext` 不依赖 Winston，避免形成环。

### 6. API 参数与错误契约

| API                         | 参数     | 类型                     | 必填 | 默认值 | 校验/错误                                                                          | 返回值                                                |
| --------------------------- | -------- | ------------------------ | ---- | ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `LoggerContext.get`         | `key`    | `string`                 | 是   | 无     | 非字符串或空白 key 抛 `TypeError`                                                  | `string \| undefined`                                 |
| `LoggerContext.set`         | `key`    | `string`                 | 是   | 无     | key 无效或 value 非字符串抛 `TypeError`；无活动作用域抛含 `withContext` 的 `Error` | `void`                                                |
| `LoggerContext.set`         | `value`  | `string`                 | 是   | 无     | 允许空字符串                                                                       | `void`                                                |
| `LoggerContext.clear`       | 无       | -                        | -    | -      | 无作用域时 no-op                                                                   | `void`                                                |
| `LoggerContext.withContext` | `values` | `Record<string, string>` | 是   | 无     | 非普通对象或任一 entry 无效抛 `TypeError`                                          | 回调返回值/Promise 原样返回                           |
| `LoggerContext.withContext` | `fn`     | `() => T`                | 是   | 无     | 非函数抛 `TypeError`，不得执行                                                     | `T`                                                   |
| `LoggerContext.getStore`    | 无       | -                        | -    | -      | 无作用域时返回 `undefined`                                                         | `ReadonlyMap<string, string> \| undefined` 的独立快照 |

不涉及数据库模型、字段、索引或迁移。

### 7. 测试设计

| 模块                   | 成功分支                                                        | 失败/边界分支                                                             |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| LoggerContext 基础 API | get/set/clear、空字符串 value、多字段                           | 无作用域 set、无作用域 get/clear、空白/非字符串 key、非字符串 value       |
| withContext            | 同步返回、Promise、timer、嵌套继承与覆盖、null prototype values | 非对象/数组 values、坏 entry、非函数 fn、getter 抛错、同步异常、rejection |
| 并发隔离               | 两个 deferred 分支分别 set、子任务继承分支值、父级恢复          | 一个分支 clear 不污染兄弟/父级、交错完成顺序                              |
| getStore               | 快照内容、只读 TypeScript 签名                                  | 强制修改/删除/清空快照不影响 store、无 store 返回 undefined               |
| LoggerFactory plain    | 调用时 traceId、无值 `-`、复用 logger 的不同作用域              | 格式化延迟后作用域已结束、同 pattern 多占位符                             |
| LoggerFactory JSON     | 顶层 traceId、无值省略                                          | Symbol 不泄漏、延迟格式化不读取后续上下文                                 |
| 混合 transport         | plain/JSON 使用同一捕获值                                       | 某 transport 延迟、上下文在两 transport 间变化仍一致                      |
| PatternFormatter       | 预捕获 metadata、独立 formatter fallback                        | 已捕获缺失时不读取格式化阶段上下文                                        |

测试必须使用 deferred Promise/barrier 控制并发交错，不依赖不稳定的真实时间等待；每个测试结束后退出自身作用域，不通过修改内部 AsyncLocalStorage 清理。

## Risks / Trade-offs

- [Breaking Change 导致旧的顶层 `set()` 抛错] → README 提供机械迁移示例，prerelease 搜索调用点并监控错误；错误消息直接指出 `withContext`。
- [Map copy-on-write 增加写操作分配] → 上下文字段通常很少，只在作用域/写操作复制，日志读取保持 O(1)；用基准或高并发测试观察。
- [AsyncLocalStorage `enterWith()` 的执行资源语义易被误用] → 用 barrier 覆盖“先创建兄弟分支、再分别 set/clear”的交错测试，并限定 set 只在活动 run 作用域内。
- [formatter 独立使用与 wrapper 捕获缺失难以区分] → metadata 显式记录 captured 状态，测试两条路径。
- [第三方自定义 transport 可观察 Symbol] → Symbol 不会进入 JSON 或普通枚举；作为内部实现不从包根导出，文档不承诺其名称。
- [getStore 快照复制改变依赖直接修改 Map 的高级用法] → 作为明确兼容收紧记录迁移方式，推荐 `set/clear/withContext`。

## Migration Plan

1. 在仓库和已知下游服务中检索 `LoggerContext.set(` 与 `getStore()` 修改操作，记录迁移点。
2. 先实现 LoggerContext 校验、copy-on-write 和快照，并完成独立单元测试。
3. 实现日志调用边界 traceId metadata，再补齐 plain、JSON、混合 transport 和延迟格式化测试。
4. 将请求入口迁移为 `LoggerContext.withContext({ traceId }, () => next())`；作用域内需要更新字段时继续使用 `set()`。
5. 更新 README/demo，发布 prerelease；监控无作用域错误、traceId 缺失率、跨请求重复率和日志吞吐/延迟。
6. 验证通过后发布；若出现不可接受回归，回滚包版本并保留应用侧已完成的显式作用域迁移，其与旧版本兼容。
