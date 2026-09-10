## Purpose

为 Logger 的调用位置提供跨平台、稳定且紧凑的路径表示，使控制台和结构化日志能够定位实际日志调用点，同时避免携带运行机器的冗长目录前缀。

## ADDED Requirements

### Requirement: 调用位置路径必须规范化

启用调用位置采集时，系统 SHALL 将首个有效调用帧转换为稳定的 `path:line` 值：路径分隔符统一为 `/`，项目内路径相对于 Logger 初始化时确定的工作目录，依赖路径从最后一个完整 `node_modules` 目录段之后开始。系统 MUST 保留 scoped 或非 scoped 包名、文件名和行号，并 MUST 丢弃列号。

#### Scenario: Windows 项目路径转换为相对路径

- **WHEN** Logger 初始化目录为 `D:\app`，调用帧为 `D:\app\src\modules\order\service.js:42:9`
- **THEN** 调用位置必须为 `src/modules/order/service.js:42`

#### Scenario: POSIX 项目路径转换为相对路径

- **WHEN** Logger 初始化目录为 `/srv/app`，调用帧为 `/srv/app/src/modules/order/service.js:42:9`
- **THEN** 调用位置必须为 `src/modules/order/service.js:42`

#### Scenario: 文件 URL 按文件路径处理

- **WHEN** 调用帧以 `file://` 文件 URL 表示且位于 Logger 初始化目录内
- **THEN** 系统必须去除文件 URL 协议并按项目相对路径输出，且不得改变路径中的合法空格或非 ASCII 字符

#### Scenario: scoped 依赖保留完整包名

- **WHEN** 调用帧位于 `node_modules/@jintianxiayu/http-client-decorator/dist/middlewares/debug.js:17:5`
- **THEN** 调用位置必须为 `@jintianxiayu/http-client-decorator/dist/middlewares/debug.js:17`

#### Scenario: pnpm 或嵌套依赖使用最后一个 node_modules 目录段

- **WHEN** 调用帧包含多个完整的 `node_modules` 目录段
- **THEN** 系统必须从最后一个 `node_modules` 目录段之后输出依赖路径
- **AND** `.pnpm` 物理存储目录、外层依赖路径和包版本目录不得出现在调用位置中

#### Scenario: 相似目录名称不被识别为依赖边界

- **WHEN** 项目文件路径包含 `node_modules-mock` 或其他非完整 `node_modules` 目录段
- **THEN** 系统必须继续按项目路径处理该文件

### Requirement: 超长路径必须按目录段压缩

路径规范化完成后，系统 MUST 仅在路径部分超过 120 个字符且包含可省略的中间目录段时进行压缩。压缩结果 SHALL 保留前三个路径段和最后两个路径段，并将其余中间目录统一替换为单个 `...` 路径段；系统 MUST NOT 截断或缩写保留的目录名、包名和文件名。

#### Scenario: 不超过阈值的路径保持完整

- **WHEN** 规范化后的路径部分长度小于或等于 120 个字符
- **THEN** 系统不得插入 `...` 或进行其他压缩

#### Scenario: 超过阈值的深层路径折叠中间目录

- **WHEN** 规范化后的路径部分超过 120 个字符并且包含六个或更多路径段
- **THEN** 系统必须输出“前三个路径段、`...`、最后两个路径段”的路径
- **AND** 行号必须保持不变

#### Scenario: 没有可省略目录的超长路径不截断名称

- **WHEN** 路径部分超过 120 个字符但总共不超过五个路径段
- **THEN** 系统必须保留完整路径，不得截断其中的包名、目录名或文件名

#### Scenario: 压缩结果允许发生碰撞

- **WHEN** 两个调用位置仅在被折叠的中间目录段不同
- **THEN** 系统可以为它们输出相同的压缩路径
- **AND** 系统不得添加哈希或其他消歧标识

### Requirement: 规范化失败不得影响日志写入

系统 SHALL 保持现有调用帧选择和失败降级语义。无法相对于项目目录或 `node_modules` 边界识别的有效文件路径 MUST 以统一分隔符保留原始路径；无法解析有效文件与行号时，调用位置 MUST 按现有格式输出缺失值 `-`，且不得阻止日志写入。

#### Scenario: 项目目录之外的路径安全回退

- **WHEN** 有效调用帧不位于 Logger 初始化目录内且不包含完整 `node_modules` 目录段
- **THEN** 系统必须保留规范化后的原始路径和行号

#### Scenario: 工作目录在初始化后改变

- **WHEN** Logger 初始化成功后进程工作目录发生变化
- **THEN** 后续调用位置仍必须相对于初始化时确定的目录进行规范化

#### Scenario: 调用帧无法解析

- **WHEN** 调用栈中不存在可解析的有效文件和行号
- **THEN** 日志输出中的调用位置必须为 `-`
- **AND** 日志消息及其他字段必须继续正常输出
