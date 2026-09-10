## Why

`@jintianxiayu/logger` 会无条件为 `password` 等常见字段注册内置脱敏策略，而现有 `masking.fields` 只能用字符串模板新增或覆盖策略，无法按字段取消不适合当前业务语义的内置规则。需要提供显式、可审计的单字段退出能力，同时保持默认脱敏保护不变。

## What Changes

- 扩展 `masking.fields`，允许字段值使用布尔值 `false`，表示移除该字段的内置或自定义脱敏策略。
- 保持字符串模板的现有新增和覆盖语义，并保持字段名大小写不敏感、递归匹配以及 `masking.enabled` 的全局开关语义。
- 明确单字段退出只影响指定的规范化字段名；例如 `password: false` 同时作用于 `Password`，但不影响 `passwd`、`pwd` 或其他内置字段。
- 在初始化阶段拒绝 `true`、`null`、数字等不受支持的字段策略值，并继续拒绝大小写不敏感的重复字段名。
- 补充配置说明、安全警告、公共类型契约以及覆盖配置解析、脱敏执行和最终输出的验证。

## Capabilities

### New Capabilities

- `logger-sensitive-field-masking`: 定义 Logger 内置敏感字段策略、自定义模板、单字段显式退出、配置校验和默认安全行为。

### Modified Capabilities

无。

## Impact

- 受影响包：`@jintianxiayu/logger`，当前版本为 `1.0.0`；这是新增兼容能力，需记录 `minor` changeset。
- 受影响代码：公共类型 `SensitiveFieldConfig`、配置解析与冻结模型、`SensitiveMasker` 策略构建，以及对应单元测试和输出集成测试。
- 受影响文档：`packages/logger/README.md` 的配置项说明、敏感字段脱敏章节和安全提示。
- 公共契约变更：是。`SensitiveFieldConfig` 从 `Record<string, string>` 扩展为 `Record<string, string | false>`，YAML 的 `masking.fields.<field>` 同步接受布尔值 `false`。
- 兼容性结论：向后兼容。既有 TypeScript 配置、YAML 配置、默认行为、错误语义和日志结构均保持不变；只有调用方显式配置 `false` 时，对应字段才会以原值进入后续格式化流程。
- 跨版本 YAML 配置协议：包含 `false` 的新配置不能由旧版 Logger 读取，旧版会在初始化阶段将其作为非字符串模板拒绝。部署时应先升级 Logger，再启用该配置；不需要处理存量数据，也不要求新旧版本共享同一份新配置。
- 安全影响：显式退出会使指定字段在所有命名 Logger、所有输出通道和任意嵌套层级中不再脱敏，文档必须提示调用方仅在字段名与敏感信息无关时使用。`message` 文本处理边界不变。
- 日志、Redis 与 HTTP 契约：日志事件结构和格式不变，但显式退出字段的元数据内容会从掩码值变为原值；不涉及 Redis key/value、锁协议或 HTTP 传输契约。
- 第三方依赖：不新增、不升级，也不改变现有依赖分类。
