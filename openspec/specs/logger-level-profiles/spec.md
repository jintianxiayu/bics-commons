# logger-level-profiles Specification

## Purpose

允许依赖方在一份 Logger 配置中维护多个命名日志器级别策略，通过启动环境变量选择实际策略，消除开发、测试和生产环境间重复配置文件，同时保留基础配置继承、严格校验及首次初始化后配置稳定的契约。

## Requirements

### Requirement: 单份配置声明命名日志器级别 Profile

系统 MUST 接受可选的 `profiles` 映射，键为区分大小写、非空且无首尾空白的 Profile 名称，值为包含可选 `loggers` 映射的对象。Profile 内每个日志器配置 MUST 仅包含必填 `level`，值为 `debug`、`info`、`warn` 或 `error`。日志器名称 MUST 非空且无首尾空白，按完整名称区分大小写匹配，不支持通配符或名称编码。空 `profiles`、空 Profile 及空 `loggers` MUST 合法。

#### Scenario: P01 在同一文档中声明多个策略

- **WHEN** 配置定义 dev、qa、prod，分别将 orders.level 定义为 debug、debug、info
- **THEN** 对象配置和 YAML 配置均接受该文档

#### Scenario: P02 精确支持包名和大小写

- **WHEN** Profile 定义 `@jintianxiayu/cache-decorator` 和 `Orders` 的 level
- **THEN** 覆盖仅作用于这两个完整名称，不影响 `orders` 或其他日志器

#### Scenario: P03 接受空策略

- **WHEN** 配置包含空 profiles，或选中空 Profile、含空 loggers 的 Profile
- **THEN** 初始化接受配置且保留全部基础日志策略

### Requirement: 启动时选择一个 Profile

系统 MUST 在首次初始化尝试时读取 `LOGGER_PROFILE`，仅在其为 undefined 时不选择 Profile。已设置的值 MUST 是合法且存在的精确名称；空值、首尾空白和不存在的名称 MUST 同步导致配置错误，不回退。系统 MUST NOT 根据 NODE_ENV 推断 Profile，也不支持多个 Profile 组合。配置来源选择 MUST 保持显式对象或路径优先于 LOGGER_CONFIG_PATH、再使用内置默认配置；Profile MUST 只在选中的配置文档中查找，并适用于所有来源。

#### Scenario: P04 选择开发测试或生产策略

- **WHEN** 独立进程使用同一配置分别设置 LOGGER_PROFILE 为 dev、qa、prod
- **THEN** orders 在 dev 和 qa 输出 debug，在 prod 过滤 debug 并输出 info

#### Scenario: P05 未设置选择器

- **WHEN** 未设置 LOGGER_PROFILE，配置含合法 profiles，NODE_ENV 为 dev 或 production
- **THEN** 仅基础配置生效，不自动选择任何 Profile

#### Scenario: P06 拒绝非法选择器

- **WHEN** LOGGER_PROFILE 为空、只有空白、含首尾空白或指定不存在的名称（包括配置没有 profiles）
- **THEN** 初始化同步抛出配置错误，指出 LOGGER_PROFILE，不回退或自动修剪

#### Scenario: P07 保持来源优先级

- **WHEN** 使用显式对象、显式 YAML 路径或 LOGGER_CONFIG_PATH 初始化，并设置合法 LOGGER_PROFILE
- **THEN** 仅从所选文档应用 Profile；显式来源不读取 LOGGER_CONFIG_PATH 指向的文件
- **AND** 显式来源缺少所选 Profile 或来源无效时直接失败，不搜索其他文件

### Requirement: 仅覆盖命名日志器级别

系统 MUST 先按既有规则得到基础 root 与命名日志器配置，再对选中 Profile 中的名称覆盖 level。Profile 独有的名称 MUST 继承基础 root 的其他配置。未匹配名称及 root MUST 保持基础行为；未选中 Profile 的名称 MUST NOT 被加入生效配置。系统 MUST NOT 修改调用者传入的配置对象。

#### Scenario: P08 覆盖优先级与字段保留

- **WHEN** root.level 为 warn、基础 orders.level 为 info、所选 Profile orders.level 为 debug
- **THEN** orders 使用 debug，root 仍为 warn，orders 的输出、显式 false、位置及全局脱敏和异常策略保持基础配置

#### Scenario: P09 新名称与未匹配名称

- **WHEN** 所选 Profile 仅定义基础配置未声明的 database，其他 Profile 定义 orders
- **THEN** database 继承 root 并使用所选 level，orders 和其余名称保持基础策略

#### Scenario: P10 输入对象保持不变

- **WHEN** 应用传入配置对象并成功应用 Profile
- **THEN** 输入对象及嵌套配置保持原值，后续修改输入对象也不改变运行中的日志级别

### Requirement: 严格校验整个配置文档

系统 MUST 校验基础配置及全部 Profile，即使未选择 Profile 或错误位于未选中的 Profile 也 MUST 同步失败。系统 MUST 拒绝非映射结构、非法名称、非法或缺失 level、未知字段及 YAML 重复映射键。Profile MUST NOT 包含 root、console、file、captureLogPosition、masking、processErrors 或嵌套 profiles 等扩展字段。错误 MUST 定位字段或名称，MUST NOT 输出整份配置。非法基础配置 MUST NOT 因覆盖而被修复或绕过。

#### Scenario: P11 拒绝结构及字段错误

- **WHEN** profiles、Profile、loggers 或日志器项不是映射，名称非法，level 缺失或非法，或存在禁止字段及 YAML 重复键
- **THEN** 初始化同步抛出包含出错字段或名称的配置错误

#### Scenario: P12 校验未选中的策略及基础值

- **WHEN** 未选中的 Profile 非法，或基础 level 非法但所选 Profile 提供合法 level
- **THEN** 初始化失败，不静默忽略或掩盖错误

### Requirement: 保持首次成功初始化的稳定性

Profile MUST 在创建日志输出资源前解析完成；配置失败 MUST 不产生部分生效的运行时，并允许修正后重试。首次成功初始化后，已有及后来获取的日志器 MUST 使用同一配置快照；后续 init、环境变量或文件变化 MUST 不切换策略。首次 getLogger 的延迟初始化 MUST 遵循相同 Profile 规则。

#### Scenario: P13 成功后不切换策略

- **WHEN** 首次初始化选择 dev，随后修改环境变量和文件并再次 init
- **THEN** 已缓存和新获取的日志器仍使用首次成功加载的配置

#### Scenario: P14 失败后修正重试

- **WHEN** 首次因非法 Profile 初始化失败，随后修正配置或选择器并重试
- **THEN** 失败尝试未建立日志输出资源，重试成功使用修正后的配置

#### Scenario: P15 延迟初始化

- **WHEN** 未调用 init，首次 getLogger 时已设置 LOGGER_CONFIG_PATH 与 LOGGER_PROFILE
- **THEN** 成功时使用选中 Profile，非法配置时抛出相同配置错误

### Requirement: 提供兼容的公共配置类型

包根入口 MUST 导出 `LoggerLevelOverride` 和 `LoggerLevelProfile` 类型，并在 LoggerConfig 中增加可选 profiles；既有 init(source?) 调用 MUST 继续合法。公开类型 MUST 约束覆盖项 level 必填且使用现有级别联合类型，不扩展 LoggerOptions 或 LoggerInterface。

#### Scenario: P16 类型正例

- **WHEN** 调用方从包根导入新类型并传入合法 Profile 配置，或继续使用不含 profiles 的旧配置
- **THEN** TypeScript 类型检查通过

#### Scenario: P17 类型负例

- **WHEN** 调用方使用对象字面量声明缺失 level、非法级别或额外输出配置的 Profile
- **THEN** TypeScript 类型检查报告对应错误
