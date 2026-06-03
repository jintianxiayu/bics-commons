## Why

`LoggerConfig.console.format` 字段已在类型定义中声明（`'plain' | 'json'`），但 `LoggerFactory.createTransports` 在创建 Console transport 时并未读取该字段，导致无论用户在 YAML 中如何配置 `console.format`，控制台输出始终走 `createFormat(config.pattern)` 的纯文本分支，配置项形同虚设。该问题使依赖 JSON 结构化日志输出的下游系统（采集器、日志平台）无法按预期工作。

## What Changes

- **修复** `LoggerFactory.createTransports`：按 `config.console.format` 分支选择 winston formatter。
  - `format: 'json'` → 使用 `winston.format.json()`，输出单行 JSON
  - `format: 'plain'` 或未配置 → 保持现有 `createFormat(config.pattern)` 行为不变
- **补全默认配置**：在 `defaultConfig.ts` 的 `defaultConfig.console` 中显式声明 `format: 'plain'`，固化默认行为。
- **新增 JSON 模式下的 traceId 注入**：当 `format: 'json'` 时，将 `AsyncLocalStorage` 中的 `traceId` 写入 `info.traceId` 字段，与现有纯文本模式行为对齐。
- **新增单元测试**：覆盖 `'plain'`、`'json'`、未配置三种场景。
- **更新 README**：在 logger 包 README 中补充 `console.format` 配置说明。

## Capabilities

### New Capabilities

- `logger-console-format`: 描述 LoggerConfig.console.format 配置项的契约——支持的取值、各取值对应的输出格式、与现有 pattern/colorize 选项的组合行为，以及对 traceId 注入的影响。

### Modified Capabilities

无（现有 spec 均为 cache-decorator 领域，与 logger 无关；本变更不修改任何已有 spec 的需求规约）。

## Impact

**受影响文件**

- `packages/logger/src/core/LoggerFactory.ts` — `createTransports` 方法增加 `format` 分支；可能需要新增 `createJsonFormat` 工具函数处理 traceId 注入。
- `packages/logger/src/config/defaultConfig.ts` — `defaultConfig.console` 补充 `format: 'plain'`。
- `packages/logger/src/core/__tests__/LoggerFactory.test.ts`（如不存在则新建）— 新增 `format` 相关用例。
- `packages/logger/README.md` — 配置说明文档更新。

**兼容性评估**

- 无 Breaking Change：现有未配置 `format` 字段的用户行为完全保持一致（fallback 到 `'plain'`）。
- 类型签名未变：`ConsoleConfig.format` 字段本就是可选的，新增实现不改变 API 表面。
- 默认行为变更风险：低——`defaultConfig.console` 新增的 `format: 'plain'` 与代码现状（恒走纯文本分支）等价，属于显式化既有行为。

**依赖与第三方包**

- 无新增依赖：`winston.format.json()`、`winston.format.timestamp()`、`winston.format.combine()` 均已通过 `winston` 间接可用。

**性能影响**

- `'json'` 分支下使用 winston 内置的 JSON 格式化器，性能与现有 `printf` 模式相当，无显著差异。
- 无数据库/索引相关变更。

**受影响角色**

- 库维护者：本变更需在 `LoggerFactory` 中增加约 15~25 行实现代码 + 测试覆盖。
- 库使用者：可正常通过 YAML 配置 `console.format: json` 启用结构化日志输出，无需修改调用代码。

**回滚计划**

- 单一包、单次提交的小范围变更，回滚成本极低。
- 通过 `git revert` 撤销对应提交即可恢复至当前行为（`format` 字段被忽略）。
- 若新分支实现引入回归测试，可直接定位回滚点。
