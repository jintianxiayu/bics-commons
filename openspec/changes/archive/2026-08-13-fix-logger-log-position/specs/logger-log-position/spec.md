## Purpose

本能力用于让 logger 在不同运行平台、工作目录和调用链中稳定定位真实调用方，以统一且不泄露绝对文件系统路径的 `路径:行:列` 表示辅助日志检索和故障排查，同时保证位置解析失败不影响业务日志。

## ADDED Requirements

### Requirement: 调用位置必须包含规范化路径、行号和列号

系统 SHALL 将可定位的日志调用位置输出为 `<path>:<line>:<column>`。path MUST 使用 `/` 分隔符；line 和 column MUST 为非负整数；栈帧缺少行号或列号时对应值 MUST 使用 `0`。

#### Scenario: 捕获项目内业务调用方

- **GIVEN** 日志由当前工作目录内的 TypeScript 业务文件调用，栈帧包含行号和列号
- **WHEN** pattern 解析 `%{log_position}`
- **THEN** 输出当前工作目录的相对文件路径、行号和列号
- **AND** 输出匹配 `<relative-path>:<line>:<column>`

#### Scenario: 栈帧缺少列号

- **GIVEN** 选中的调用方栈帧包含文件和行号但不包含列号
- **WHEN** 系统格式化调用位置
- **THEN** 输出该路径与行号
- **AND** column 输出为 `0`

### Requirement: 系统必须选择第一个真实外部调用帧

系统 MUST 跳过 logger 包自身实现帧、Node 内部帧以及明确的日志基础设施帧，并 SHALL 选择其后的第一个外部调用帧。系统 MUST NOT 仅因帧位于 `node_modules` 或方法名为 `debug`、`info`、`warn`、`error` 而排除该帧。

#### Scenario: 调用栈包含 logger 内部帧和业务帧

- **GIVEN** 调用栈先包含 formatter、LoggerFactory 和 LogPosition 内部帧，随后包含业务文件帧
- **WHEN** 系统选择调用位置
- **THEN** 输出业务文件帧
- **AND** 不输出任一 logger 内部文件帧

#### Scenario: 调用方来自第三方依赖

- **GIVEN** logger 由 `node_modules` 中非日志基础设施的依赖代码直接调用
- **WHEN** 系统选择调用位置
- **THEN** 该依赖帧可被选择为真实调用方
- **AND** 系统不因路径包含 `node_modules` 而跳过该帧

#### Scenario: 业务方法名与日志级别同名

- **GIVEN** 真实业务调用帧的方法名为 `info` 或 `error`
- **WHEN** 系统选择调用位置
- **THEN** 该帧仍可被选择
- **AND** 系统不只按方法名排除该帧

### Requirement: 位置路径必须跨平台且不泄露绝对路径

系统 SHALL 在每次捕获时以当前工作目录为相对路径根，并 MUST 规范化 POSIX、Windows 和 `file://` 文件表示。项目内路径 SHALL 输出相对路径；项目外路径 MUST 使用不包含目录前缀的安全文件名表示，不得输出绝对路径、盘符或用户主目录。

#### Scenario: 捕获 Windows 项目内路径

- **GIVEN** 当前工作目录和调用帧使用 Windows 盘符及反斜杠路径
- **WHEN** 系统格式化调用位置
- **THEN** 输出不含盘符的项目相对路径
- **AND** 路径分隔符全部为 `/`

#### Scenario: 工作目录在模块加载后改变

- **GIVEN** logger 模块加载后进程切换到另一个工作目录，调用帧位于新工作目录内
- **WHEN** 系统捕获调用位置
- **THEN** 使用捕获时的当前工作目录计算相对路径
- **AND** 不使用模块加载时的旧工作目录

#### Scenario: 调用文件位于工作目录之外

- **GIVEN** 选中的调用帧文件不在当前工作目录中
- **WHEN** 系统格式化调用位置
- **THEN** path 仅保留安全文件名表示
- **AND** 输出不包含绝对目录、盘符或用户主目录

#### Scenario: 调用帧使用 file URL

- **GIVEN** 选中的调用帧文件使用 `file://` URL 和 URL 编码字符
- **WHEN** 系统格式化调用位置
- **THEN** 系统解码并规范化为安全路径表示
- **AND** 输出不包含 `file://` 前缀

### Requirement: 位置捕获失败不得影响日志调用或全局状态

系统 MUST NOT 修改 `Error.stackTraceLimit` 或其他进程级全局状态。创建 Error、读取 stack、解析 stack 或规范化帧任一步骤失败时，系统 MUST 返回 `unknown:0:0`，且日志调用不得因位置捕获失败而抛出异常。

#### Scenario: parser 抛出异常

- **GIVEN** 调用栈 parser 在解析时抛出异常
- **WHEN** 系统捕获调用位置
- **THEN** 返回 `unknown:0:0`
- **AND** 异常不会传播到日志调用方

#### Scenario: 调用栈为空或没有可用帧

- **GIVEN** Error stack 为空、解析结果为空或所有帧均为内部帧
- **WHEN** 系统捕获调用位置
- **THEN** 返回 `unknown:0:0`

#### Scenario: 保持全局 stackTraceLimit

- **GIVEN** 应用为 `Error.stackTraceLimit` 设置了自定义值
- **WHEN** 系统捕获一次或多次调用位置
- **THEN** 捕获前后的 `Error.stackTraceLimit` 值完全相同

### Requirement: formatter 必须按需捕获调用位置

plain formatter 与内部 pattern formatter SHALL 使用相同的位置捕获语义。仅当实际 pattern 包含 `%{log_position}` 时系统 MUST 捕获一次调用栈；不含该占位符的 plain pattern 和 JSON 输出 MUST NOT 捕获调用栈。

#### Scenario: plain pattern 包含位置占位符

- **GIVEN** plain logger pattern 包含一个或多个 `%{log_position}`
- **WHEN** logger 输出一条日志
- **THEN** 系统仅捕获一次调用位置
- **AND** 所有位置占位符替换为同一个值

#### Scenario: plain pattern 不含位置占位符

- **GIVEN** plain logger pattern 不包含 `%{log_position}`
- **WHEN** logger 输出日志
- **THEN** 系统不创建或解析调用栈

#### Scenario: JSON 模式输出日志

- **GIVEN** logger 配置为 JSON 模式，即使配置的 pattern 文本包含 `%{log_position}`
- **WHEN** logger 输出日志
- **THEN** 系统不捕获调用位置
- **AND** JSON 输出的既有字段语义保持不变
