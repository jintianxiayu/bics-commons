## Why

当前 logger 包虽然声明支持敏感信息脱敏和 YAML 配置，但 `sensitiveMasking` 配置没有接入实际日志输出，命名 logger 的非法日志级别也会绕过校验。这会造成使用者误以为敏感数据已被保护，同时让错误配置静默进入运行环境，因此需要优先恢复配置契约与安全行为的一致性。

## What Changes

- 将 root 与命名 logger 合并后的 `sensitiveMasking` 配置接入对应 logger 的实际输出链路，避免全局脱敏状态在不同 logger 之间相互污染。
- 明确定义敏感字段规则的合并语义：内置规则作为基线，自定义同名字段覆盖默认模板，自定义新字段追加，`enabled: false` 完全关闭脱敏，空 `fields` 不清空默认规则。
- 统一推荐使用 `sensitiveMasking` 配置键，并在一个兼容周期内接受历史文档中的 `sensitive-masking` 别名；两个键同时出现时拒绝启动，避免歧义。
- 完善 logger 配置结构校验，覆盖 root、命名 logger、console、file、pattern 与敏感字段规则；所有校验错误统一为包含准确字段路径的 `ConfigError`。
- 区分“未显式指定配置且默认文件不存在”和“显式指定的配置文件不存在”：前者安静使用内置默认配置，后者在显式初始化时抛错、懒加载时告警并降级。
- console 与 file 同时关闭时使用显式 no-op logger，避免创建无 transport 的 Winston logger。
- 增加 YAML 到最终日志输出的端到端测试，并同步修正 README 中配置命名、合并规则、默认脱敏字段和降级行为。

本变更不包含 logger 生命周期、shutdown、通用 meta 安全序列化或 LogPosition 重构，这些内容由后续 change 独立处理。

## Capabilities

### New Capabilities

- `logger-security-config`: 定义 logger 配置校验、敏感字段规则解析、命名 logger 隔离、兼容配置键及配置降级行为。

### Modified Capabilities

无。

## Impact

### 影响模块和文件

- `packages/logger/src/core/ConfigLoader.ts`：配置规范化、完整校验和错误路径。
- `packages/logger/src/core/LoggerFactory.ts`：按有效 logger 配置创建脱敏策略及 no-op logger。
- `packages/logger/src/core/SensitiveMasker.ts`：从全局可变状态调整为可隔离使用的策略实现。
- `packages/logger/src/config/defaultConfig.ts`：默认敏感字段和默认配置复制策略。
- `packages/logger/src/types/index.ts`：规范化配置及脱敏策略相关类型。
- `packages/logger/test/**`：配置校验、命名 logger 隔离和端到端输出测试。
- `packages/logger/README.md`、示例配置：对齐实际支持的配置与行为。

### API 与兼容性

- Logger 的 `debug/info/warn/error`、`LoggerFactory.getLogger/init` 等公开调用方式保持不变，不构成源代码级 Breaking Change。
- 过去被静默接受的非法配置将由 `LoggerFactory.init()` 拒绝，这属于有意的行为收紧；懒加载仍按现有契约告警并降级。
- 历史 `sensitive-masking` 键暂时兼容，`sensitiveMasking` 为推荐写法；同时配置二者会抛出 `ConfigError`。
- 自定义敏感字段开始真正生效，可能改变已有日志内容，但这是安全缺陷修复的预期结果。

### 依赖、性能、数据库与权限

- 不引入新的第三方 npm 包；配置规模较小，采用手写校验和预编译 Map/Set，避免额外 schema 运行时依赖。
- 每个 logger 在首次创建时编译一次脱敏策略，预计仅增加与敏感字段数量线性相关的初始化成本；单条日志仍使用 O(1) 字段规则查找，不增加额外配置解析。
- 不涉及数据库结构、数据迁移、API 权限或用户角色变化。
- 受影响团队包括 logger 包维护者、使用该包的服务开发团队，以及依赖日志脱敏和采集配置的运维/安全团队。

### 回滚计划

- 实现将保持原有配置类型和 Logger API，可通过回滚该版本恢复旧行为。
- 灰度期间可对指定 logger 配置 `sensitiveMasking.enabled: false`，用于隔离脱敏策略引起的日志格式问题。
- 若旧键兼容逻辑出现问题，可继续使用推荐的 `sensitiveMasking` 键；不得以关闭默认脱敏作为全局回滚手段。
