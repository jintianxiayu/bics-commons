# logger-console-format Specification

## Purpose
TBD - created by archiving change fix-console-format-option. Update Purpose after archive.
## Requirements
### Requirement: 控制台日志格式支持 plain 与 json 两种模式
`LoggerConfig.console.format` 字段必须被 `LoggerFactory` 正确消费。系统 SHALL 根据该字段的取值选择对应的 winston formatter：
- 当 `format === 'json'` 时，控制台 transport SHALL 输出单行 JSON 格式
- 当 `format === 'plain'` 时，控制台 transport SHALL 输出按 `pattern` 模板渲染的纯文本
- 当 `format` 字段未配置时，行为 SHALL 等价于 `format: 'plain'`

#### Scenario: 显式配置为 json 时输出单行 JSON
- **WHEN** 用户在 YAML 中配置 `console.format: json` 并触发任意日志输出
- **THEN** 控制台写入的每条日志必须为可被 `JSON.parse` 解析的单行字符串
- **AND** JSON 对象必须包含 `level`、`message`、`timestamp` 三个顶层字段

#### Scenario: 显式配置为 plain 时输出纯文本
- **WHEN** 用户在 YAML 中配置 `console.format: plain`（或留空）并触发任意日志输出
- **THEN** 控制台写入的每条日志必须为经过 `pattern` 模板渲染的纯文本
- **AND** 输出内容必须不可被 `JSON.parse` 解析为合法对象（即不为 JSON 格式）

#### Scenario: 未配置 format 字段时回退到 plain
- **WHEN** 用户未在配置中提供 `console.format` 字段
- **THEN** 控制台输出必须与 `format: 'plain'` 完全一致

### Requirement: json 模式下正确注入 traceId
当 `format === 'json'` 且当前 `AsyncLocalStorage` 上下文中存在 `traceId` 时，系统 MUST 将该 `traceId` 写入日志输出的顶层 `traceId` 字段。

#### Scenario: json 模式下 traceId 出现在顶层字段
- **WHEN** `console.format: json` 且 `AsyncLocalStorage` 中存在 `traceId: 'abc-123'`
- **THEN** 输出 JSON 字符串的 `traceId` 字段必须等于 `'abc-123'`

#### Scenario: json 模式下无 traceId 时不输出该字段
- **WHEN** `console.format: json` 且 `AsyncLocalStorage` 中未设置 `traceId`
- **THEN** 输出 JSON 字符串中不得包含 `traceId` 字段（或其值为 `undefined` 不出现在序列化结果中）

### Requirement: plain 模式保留 colorize 与 pattern 行为
`format: 'plain'`（含未配置）时系统 MUST 与变更前行为完全一致：尊重 `console.colors` 决定是否 colorize，使用 `pattern` 模板渲染。

#### Scenario: plain 模式下 colors 字段控制着色
- **WHEN** `console.format: plain` 且 `console.colors: false`
- **THEN** 输出字符串中不得包含 ANSI 颜色转义序列
- **AND** 当 `console.colors: true`（或未配置）时，输出字符串中 SHALL 包含 level 对应的 ANSI 转义序列

#### Scenario: plain 模式下 pattern 占位符被正确替换
- **WHEN** `console.format: plain` 且 `pattern` 含 `%{name}` 占位符
- **THEN** 输出字符串中 `%{name}` 必须被实际 logger 名称替换

### Requirement: json 模式关闭 colorize
`format: 'json'` 时 system MUST 跳过 `winston.format.colorize` formatter，以避免 ANSI 转义序列污染 JSON 字符串。

#### Scenario: json 模式下输出无 ANSI 序列
- **WHEN** `console.format: json` 且 `console.colors: true`
- **THEN** 输出字符串中不得包含任何 ANSI 颜色转义序列

### Requirement: 默认配置显式声明 format
`defaultConfig.console.format` 字段 MUST 显式声明为 `'plain'`，固化默认行为，避免静默回退。

#### Scenario: 默认配置中 format 字段可见
- **WHEN** 读取 `getDefaultConfig().console.format`
- **THEN** 必须返回字符串 `'plain'`

