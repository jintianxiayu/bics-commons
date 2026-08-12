## Context

参见 [proposal.md](./proposal.md) 的问题背景和 [logger-log-position spec](./specs/logger-log-position/spec.md) 的行为契约。当前 `LogPosition.capture()` 在模块加载时缓存 `process.cwd()`，捕获时把全局 `Error.stackTraceLimit` 临时改为 200，并通过路径正则与方法名前缀过滤栈帧。路径过滤包含所有 `node_modules`，方法过滤包含裸 `debug/info/warn/error`，fallback 则绕过了部分路径规范化。

`LoggerFactory` 的 plain formatter 当前在 Winston transport 格式化阶段调用捕获器。真实集成验证表明，Node 默认栈深会先被 formatter、Winston transport 和 readable-stream 帧耗尽，业务调用帧可能根本不在可解析范围内。因此位置必须在 Logger wrapper 收到业务调用时捕获，再通过内部 Symbol 传给 formatter。`PatternFormatter` 优先复用该 Symbol，并为独立使用场景保留安全 fallback。实现不引入新依赖，不改变公开 API 或 JSON 输出字段。

## Goals / Non-Goals

**Goals:**

- 将“获取栈”“选择外部帧”“规范化路径”“渲染位置”分成明确、可单测的内部步骤。
- 不依赖固定帧偏移或通用方法名，准确选择 logger 边界外的首个调用帧。
- 对 POSIX、Windows、file URL、cwd 变化和项目外路径给出一致、安全输出。
- 在任意栈采集或解析异常下返回稳定 fallback，不修改全局运行时状态。
- 在 Logger wrapper 的业务边界按需捕获一次，并让多个 formatter/placeholder 复用该值。

**Non-Goals:**

- 不增加 source map 反向映射；运行编译后 JavaScript 时输出运行时栈提供的文件位置。
- 不支持用户配置 include/exclude 规则、路径根目录、fallback 或输出模板。
- 不保证识别 eval、匿名 VM、Webpack 虚拟协议等所有非文件栈帧；无法安全解释时降级。
- 不把 log position 加入 JSON 模式的顶层字段。
- 不移除现有 `stacktrace-parser` 依赖，也不改变 `LogPosition.capture()` 公共签名。

## Decisions

### Decision 1: 使用捕获时 cwd 和 path/fileURL 工具规范化文件名

每次 `capture()` 调用时读取 `process.cwd()`，而不是使用模块级 `PROJECT_ROOT`。内部路径规范化先处理 `file://` URL，再将 Windows `\` 转为 `/` 并以平台无关方式判断文件是否位于 cwd 下。项目内文件渲染相对路径；项目外文件只保留 basename，避免日志泄露部署目录和用户名。

路径 containment 必须按完整路径 segment 判断，不能只用字符串 `startsWith`：`/app-other` 不属于 `/app`。Windows 盘符比较大小写不敏感，输出不包含盘符。file URL 解码失败时作为无法安全解释的帧处理，不把原始 URL直接输出。

替代方案：继续模块级缓存 cwd。它在测试、CLI 切换目录和嵌入式运行场景中会过期，不满足捕获时语义。

### Decision 2: 帧过滤依据明确文件身份和基础设施路径，不依据通用方法名

内部帧集合包含 logger 包的 `src/core/LogPosition`、`src/core/LoggerFactory`、`src/formatters/PatternFormatter` 及对应编译产物，并识别 `node:`/Node internal 帧、Winston formatter/transport 和 stacktrace-parser 帧。其他 `node_modules` 帧保留，因为直接调用 logger 的依赖就是外部调用方。

方法名仅作明确类/命名空间的辅助判断，不再排除裸 `debug/info/warn/error`。文件名优先于方法名，避免业务类碰巧名为 `Logger` 时被无条件跳过。遍历按 parser 返回顺序进行，选择首个具有安全文件名的外部帧，不使用 fallback 的“最后一帧”。

替代方案：固定跳过前 N 帧。两个 formatter、Winston 版本、测试封装和用户 wrapper 会改变栈深，固定偏移不可维护。

### Decision 3: 捕获过程完全局部化并统一失败降级

`capture()` 不读取或写入 `Error.stackTraceLimit`。它在单个 try/catch 边界内创建 Error、读取 stack、调用 parser、选择及渲染帧；任意失败均返回常量 `unknown:0:0`。没有外部帧时也返回同一常量，不再使用可能泄露路径或误报内部位置的最后一帧。

正常 Error stack 默认深度通常足以越过 logger/Winston 帧；若极深 wrapper 导致外部帧超出默认上限，稳定 fallback 优先于修改进程全局配置。未来若证明需要更深栈，应通过 V8 局部 `Error.captureStackTrace` 能力另立提案评估。

替代方案：保存并恢复 `Error.stackTraceLimit`。并发 JavaScript 代码可在修改与恢复之间观察全局值，且 getter/setter 也可能抛错，无法提供真正隔离。

### Decision 4: 提取内部纯函数和依赖适配边界以支持确定性测试

`LogPosition.ts` 内部定义统一 `StackFrame`，把第三方 parser 输出映射后交给纯函数：`isInternalFrame`、`formatFramePath`、`selectCallerFrame` 和 `renderPosition`。这些函数可通过内部命名导出或受控测试入口测试，不从包根 `index.ts` 公开。

parser 和 cwd 访问保留在薄适配层。为了覆盖 parser 抛错、空栈和 cwd 变化，可以让 `capture()` 内部调用可 spy 的静态/模块函数，或提供仅测试使用的依赖参数；不得因此扩展用户 API。

替代方案：仅通过真实 `Error.stack` 做集成测试。不同 Node/Jest 版本的栈形状和行号变化会造成脆弱测试，无法可靠覆盖 Windows/file URL 等分支。

### Decision 5: 在 Logger wrapper 业务边界按需捕获并通过内部 Symbol 传递

LoggerFactory 创建 wrapper 时，根据有效 transport 预计算 `needsLogPosition`：启用的 plain console 或 file transport 的实际 pattern 包含 `%{log_position}` 时为 true；仅 JSON console 或所有 pattern 均不含该占位符时为 false。四个日志方法仅在 true 时调用一次 `LogPosition.capture()`，并将结果写入内部 Symbol-keyed metadata。

plain/file formatter 读取该 Symbol 并替换全部 `%{log_position}`。Symbol 不会被 JSON.stringify 枚举，因此即使 JSON console 与 plain file 同时启用，也不会污染 JSON 字段。`PatternFormatter` 优先读取同一 Symbol；若作为独立 formatter 使用且上游未提供预捕获值，才在确认 pattern 需要位置后本地捕获一次作为兼容 fallback。

替代方案：继续在 formatter 内捕获。真实集成栈显示默认 10 层先被 logform、winston-transport 和 readable-stream 消耗，业务帧不可恢复；扩大基础设施过滤只会得到 unknown。另一替代是提高 `Error.stackTraceLimit`，但它修改进程全局状态，违反隔离要求。

### 模块、功能与依赖关系

| 模块                            | 功能                                                            | 依赖关系                               |
| ------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| `LogPosition` 捕获适配层        | 创建 Error、解析 stack、读取当前 cwd、统一异常降级              | `stacktrace-parser`、Node `path`/`url` |
| 帧选择核心                      | 过滤明确内部/基础设施帧，选择首个外部帧                         | 统一 StackFrame；无运行时状态          |
| 路径格式化核心                  | file URL 解码、跨平台 containment、相对路径/basename 和行列渲染 | Node path 语义与安全规则               |
| `LoggerFactory` wrapper         | 按有效 transport 预判需求，在业务调用边界捕获并写入内部 Symbol  | LogPosition、有效 logger 配置          |
| `LoggerFactory` plain formatter | 读取预捕获 Symbol，替换全部位置占位符                           | 内部 Symbol、Winston                   |
| `PatternFormatter`              | 优先复用 Symbol，独立使用时执行一次兼容 fallback                | LogPosition、内部 Symbol、Winston      |
| 单元/集成测试                   | 覆盖帧过滤、路径矩阵、失败分支、按需捕获和最终输出              | Jest、LoggerFactory、PatternFormatter  |
| README/demo                     | 记录格式、fallback、性能和迁移影响                              | 公开 Logger API                        |

### 内部 API 与参数

| API/参数                | 类型             | 必填 | 默认值                 | 行为                                              |
| ----------------------- | ---------------- | ---: | ---------------------- | ------------------------------------------------- |
| `LogPosition.capture()` | `() => string`   |   是 | 无                     | 返回 `path:line:column` 或 `unknown:0:0`          |
| parser stack            | `string`         |   是 | 无                     | 转换为统一 StackFrame 数组；异常整体降级          |
| frame file              | `string`         |   是 | 无                     | 支持 POSIX、Windows 和 file URL；不安全协议不选取 |
| frame line/column       | `number \| null` |   否 | `0`                    | 非有限值、负值或缺失统一为 `0`                    |
| cwd                     | `string`         |   是 | 捕获时 `process.cwd()` | 仅用于项目内相对路径，不写入全局缓存              |

不涉及 HTTP/REST API、数据库模型、Entity 字段、索引或迁移。

### 测试矩阵

| 模块             | 成功分支                                                         | 失败/边界分支                                                  |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 帧选择           | LoggerFactory/formatter 后的业务帧、第三方依赖帧、业务同名方法   | 仅内部帧、Node internal、缺失文件、未知协议                    |
| 路径格式化       | POSIX 相对路径、Windows 路径、file URL、cwd 动态变化             | cwd 外路径 basename、前缀相似目录、URL 解码失败、缺失行列      |
| 捕获适配         | 真实调用栈、连续多次调用、稳定 `path:line:column`                | Error/stack/parser/cwd 异常、空结果、全局 stackTraceLimit 不变 |
| LoggerFactory    | wrapper 命中业务调用方、单个/重复 placeholder、console/file 复用 | 无占位符零捕获、仅 JSON 零捕获、Symbol 不进入 JSON             |
| PatternFormatter | 复用预捕获 Symbol、独立 formatter 单次 fallback                  | 无占位符零捕获、fallback 替换                                  |
| 文档/demo        | 示例编译、格式说明与实际一致                                     | prerelease 两段/三段采集兼容说明                               |

## Risks / Trade-offs

- [默认 stack 深度不足时更容易输出 unknown] → 优先保证全局状态隔离；通过 prerelease 监控 `unknown:0:0` 比例，确有数据后再评估局部深栈方案。
- [仅靠文件路径识别内部帧可能受打包目录变化影响] → 同时覆盖 src/dist 和明确包路径，并用真实构建产物集成测试验证。
- [项目外路径只保留 basename 可能发生同名文件歧义] → 安全优先于目录诊断；日志中的 logger name、message 和 traceId 可辅助区分。
- [输出增加 column 会改变下游解析] → README 明确兼容窗口，prerelease 期间让采集表达式同时接受 `path:line` 与 `path:line:column`。
- [第三方依赖帧不再一律跳过，位置可能从应用 wrapper 改为直接调用 logger 的依赖] → 这是“直接调用方”契约的预期结果，并用调用链样本验证诊断价值。

## Migration Plan

1. 提取帧选择和路径格式化核心，先用合成栈帧覆盖完整矩阵。
2. 重写捕获适配层，移除 `Error.stackTraceLimit` 修改和最后帧 fallback，验证异常不传播。
3. 将捕获前移到 LoggerFactory wrapper，以内部 Symbol 传递给 plain/file formatter；PatternFormatter 增加 Symbol 复用与独立 fallback。
4. 运行 plain/JSON 输出集成、完整 logger 测试、open-handle、build、lint 和 demo 编译。
5. 更新 README/demo，并在 prerelease 同时支持下游两段和三段位置解析。
6. 监控业务帧命中率、unknown 比例、绝对路径泄露、解析失败率和日志耗时；异常时回滚包版本或暂时移除 placeholder。
