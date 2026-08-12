## Why

logger 当前的调用位置捕获会临时修改全局 `Error.stackTraceLimit`，并使用过宽的 `node_modules`、通用方法名过滤规则，可能跳过真实业务调用方；模块加载时固化 cwd、fallback 未统一规范化路径，还会造成 monorepo、切换工作目录、Windows 与未知栈格式下输出不稳定。与此同时 README 声明 `%{log_position}` 为“文件:行号:列号”，实际只输出文件和行号，因此需要在前三项安全与生命周期修复后收敛调用位置契约。

## What Changes

- 将调用位置输出统一为稳定的 `relative/path.ts:line:column`，所有平台使用 `/` 分隔符；栈缺少列号时使用 `0`，完全无法定位时使用 `unknown:0:0`。
- 仅排除 logger 自身文件、Node 内部帧和明确的 Winston/stack parser 基础设施帧，不再全局排除所有 `node_modules` 或仅凭 `debug/info/warn/error` 方法名跳帧，确保依赖包与业务同名方法仍可成为调用方。
- 在每次捕获时基于当前工作目录生成相对路径；工作目录之外的文件使用安全、可诊断且不泄露绝对路径的表示，Windows 路径和 `file://` URL 采用一致规范化规则。
- 捕获过程不再修改全局 `Error.stackTraceLimit`，并隔离 Error 创建、stack 读取和 parser 异常，保证 `%{log_position}` 不会使日志调用抛错。
- 统一 LoggerFactory plain formatter 与内部 PatternFormatter 的位置语义，仅当 pattern 包含 `%{log_position}` 时才捕获调用栈；JSON 模式和不含该占位符的 pattern 不产生额外 stack 捕获成本。
- 增加表驱动单元测试与 plain 输出集成测试，覆盖业务帧、依赖帧、内部帧、路径规范化、未知/异常栈以及位置捕获按需执行，并修正文档和 demo。

## Capabilities

### New Capabilities

- `logger-log-position`: 定义 logger 调用位置的帧选择、跨平台路径、行列号、失败降级、全局状态隔离与按需捕获行为。

### Modified Capabilities

无。

## Impact

### 影响模块和文件

- `packages/logger/src/core/LogPosition.ts`：重构栈采集、帧过滤、路径规范化及失败降级。
- `packages/logger/src/core/LoggerFactory.ts`：保持 plain formatter 按需解析 `%{log_position}`，并支持可测试的位置捕获边界。
- `packages/logger/src/formatters/PatternFormatter.ts`：与 LoggerFactory 共用相同位置格式与按需行为。
- `packages/logger/test/LogPosition.test.ts`、`LoggerFactory.test.ts` 及 formatter 测试：增加跨平台、异常与端到端覆盖。
- `packages/logger/README.md`、`src/demo.ts` 与 `examples/demo.ts`：对齐 `文件:行:列`、fallback 和性能说明。

### API 与兼容性

- `LogPosition.capture()`、Logger 的四个日志方法及配置 schema 保持原签名，不构成源代码级 Breaking Change。
- `%{log_position}` 从 `path:line` 调整为 `path:line:column`，并收紧绝对路径与错误 fallback；依赖旧字符串拆分规则的日志采集配置需在 prerelease 阶段更新，属于有意的输出格式修复。
- `LogPosition` 仍作为公开类导出；本变更不新增用户可配置的 frame filter 或路径根目录选项。

### 依赖、性能、数据库与权限

- 不引入新的第三方 npm 包，继续使用现有 `stacktrace-parser`；替代方案是手写 V8/Firefox/Safari 栈解析器，但维护跨运行时格式的成本更高。
- 含 `%{log_position}` 的日志仍需创建并解析一次调用栈，复杂度为 O(f)，f 为解析的栈帧数量；通过合理上限和提前命中停止遍历控制开销。不含该占位符及 JSON 模式不捕获调用栈，预期无新增运行时成本。
- 不涉及数据库 Entity、迁移、网络 API、权限或用户角色变化。
- 受影响团队包括 logger 包维护者、依赖源码位置排障的服务开发团队，以及解析 `%{log_position}` 的日志采集、检索与告警平台团队。

### 回滚计划

- 可直接回滚 logger 包版本恢复旧的 `path:line` 输出，不需要配置或数据迁移。
- prerelease 阶段对比业务帧命中率、`unknown:0:0` 比例、绝对路径泄露扫描、平均日志耗时及日志采集解析失败率。
- 若下游尚未兼容列号，可暂时从 pattern 移除 `%{log_position}` 或让采集规则同时接受两段/三段位置格式；不得通过保留绝对路径来规避兼容问题。
