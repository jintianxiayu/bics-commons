## Why

logger 当前直接对 meta 使用 `JSON.stringify`，并在脱敏阶段按普通对象递归处理特殊值，导致 BigInt 使日志调用抛错、嵌套 Error/Date 丢失语义、循环引用输出不可诊断，带异常 getter 的对象还可能中断业务流程。日志本应是诊断保障而不是新的故障源，因此需要在生命周期修复后统一加固 meta 规范化与序列化。

## What Changes

- 建立统一的 JSON-safe meta 规范化契约，供 plain、JSON 和 pattern formatter 共用，避免各输出路径行为分叉。
- 将 BigInt 转为十进制字符串，将有效 Date 转为 ISO 8601 字符串，并完整保留顶层及嵌套 Error 的 name、message、stack、cause 与可枚举自定义字段。
- 对真实循环引用输出稳定的 `[Circular]` 标记，对超过既有深度限制的内容保留 `[MAX_DEPTH_EXCEEDED]`，同时不将普通的共享引用误判为循环。
- 对 undefined、symbol、function、无效 Date、抛错 getter 等不能安全表示的值使用明确的稳定占位符，保证日志方法不会因 meta 序列化失败而抛错。
- 保证敏感字段规则在特殊值、Error 自定义属性、数组和循环结构中继续生效，且不会因为安全降级泄露原始敏感值。
- 增加单元与 plain/JSON 端到端测试，并更新 README 中支持值类型、降级标记与兼容行为。

## Capabilities

### New Capabilities

- `logger-meta-serialization`: 定义 logger 对普通值、特殊 JavaScript 值、Error、循环引用、深层结构和读取失败属性的安全规范化及跨格式输出行为。

### Modified Capabilities

无。

## Impact

### 影响模块和文件

- `packages/logger/src/core/LoggerFactory.ts`：在 wrapper 输出链路接入统一 meta 规范化结果，移除分散的 Error 特判与不安全 stringify。
- `packages/logger/src/core/SensitiveMasker.ts`：与规范化遍历协作，确保特殊对象、循环结构和失败属性中的敏感字段安全处理。
- `packages/logger/src/formatters/PatternFormatter.ts`：复用统一安全 stringify，消除备用 formatter 的同类风险。
- `packages/logger/src/core/MetaSerializer.ts`（新增）：集中实现 JSON-safe 规范化、循环检测、错误降级和确定性序列化。
- `packages/logger/test/**`：增加特殊值矩阵、脱敏组合及 plain/JSON 输出集成测试。
- `packages/logger/README.md` 与 demo：说明特殊类型表示、占位符和无抛错保障。

### API 与兼容性

- Logger 的 `debug/info/warn/error` 签名和配置 schema 保持不变，不构成源代码级 Breaking Change。
- 普通 JSON-compatible meta 的输出结构保持不变；特殊值的输出会从“抛错、丢失或隐式 null/空对象”调整为稳定的字符串或结构化表示，属于有意的行为修复。
- Error 输出继续包含 message 与 stack，并新增 name、cause 和安全的可枚举自定义字段；日志采集规则若依赖旧的空对象行为需同步调整。
- 本变更不导出新的公共 serializer API，内部实现可在不改变行为规范的前提下演进。

### 依赖、性能、数据库与权限

- 不引入新的第三方 npm 包，使用原生 WeakSet/对象描述符和现有 formatter API。
- 每条带对象 meta 的日志增加一次受深度限制的规范化遍历；时间复杂度为 O(n)，n 为限制内访问的属性数量。遍历与脱敏合并或紧邻执行，避免重复无界扫描。
- 不涉及数据库 Entity、迁移、网络 API、权限或用户角色变化。
- 受影响团队包括 logger 包维护者、依赖结构化日志的服务开发团队，以及维护日志采集、告警和故障排查规则的平台团队。

### 回滚计划

- 可直接回滚 logger 包版本恢复旧输出，不需要配置或数据迁移。
- prerelease 阶段对比 plain/JSON 中普通 meta、Error 和特殊值字段，重点观察日志丢弃、格式解析失败、体积增长与敏感值泄露指标。
- 若特殊值表示影响下游解析，可先回滚版本并让应用侧显式预处理对应字段，不得通过关闭敏感信息脱敏规避兼容问题。
