# logger-security-config Specification

## Purpose

本能力用于保证 logger 的 YAML 配置经过一致、可诊断的校验，并确保 root 与命名 logger 的敏感字段规则真实作用于各自日志输出，避免配置静默失效导致敏感信息泄露。

## Requirements

### Requirement: 配置结构必须被完整校验

系统 SHALL 在使用配置前校验 `root`、`loggers`、`level`、`pattern`、`console`、`file` 和敏感字段配置的结构、字段名与值类型。校验失败时系统 MUST 产生 `ConfigError`，并在错误信息中包含无效字段的完整配置路径；未知配置字段 MUST 被视为无效配置。

#### Scenario: root 配置合法

- **GIVEN** YAML 中的 root 配置仅包含受支持字段且字段值类型正确
- **WHEN** 应用调用 `LoggerFactory.init()`
- **THEN** 配置校验成功并可用于创建 logger

#### Scenario: 命名 logger 使用非法日志级别

- **GIVEN** YAML 配置包含 `loggers.database.level: verbose`
- **WHEN** 应用调用 `LoggerFactory.init()`
- **THEN** 系统抛出 `ConfigError`
- **AND** 错误信息包含路径 `loggers.database.level`

#### Scenario: 嵌套配置字段类型错误

- **GIVEN** YAML 配置包含 `root.console.enabled: "yes"`
- **WHEN** 应用调用 `LoggerFactory.init()`
- **THEN** 系统抛出 `ConfigError`
- **AND** 错误信息包含路径 `root.console.enabled`

#### Scenario: 敏感字段规则结构错误

- **GIVEN** YAML 配置中的敏感字段规则缺少非空的 `field` 或 `mask` 字符串
- **WHEN** 应用调用 `LoggerFactory.init()`
- **THEN** 系统抛出 `ConfigError`
- **AND** 错误信息指向对应规则和字段

#### Scenario: 配置包含未知字段

- **GIVEN** YAML 配置包含 schema 未声明的字段 `root.console.colours`
- **WHEN** 应用调用 `LoggerFactory.init()`
- **THEN** 系统抛出 `ConfigError`
- **AND** 错误信息包含路径 `root.console.colours`

### Requirement: 严格初始化与懒加载必须采用一致的校验结果

系统 SHALL 对 `LoggerFactory.init()` 与首次 `LoggerFactory.getLogger()` 使用相同的配置规范化和校验规则。显式初始化遇到无效配置 MUST 抛出 `ConfigError`；懒加载遇到相同错误 MUST 输出警告、使用完整内置默认配置并返回可用 logger。

#### Scenario: 显式初始化拒绝无效配置

- **GIVEN** 显式配置文件存在但包含无效配置
- **WHEN** 应用调用 `LoggerFactory.init()`
- **THEN** 系统抛出 `ConfigError`
- **AND** 不缓存部分解析或部分合并的配置

#### Scenario: 懒加载从无效配置降级

- **GIVEN** 显式配置文件存在但包含无效配置
- **WHEN** 应用未调用 `init()` 而直接获取 logger
- **THEN** 系统输出包含配置错误原因的警告
- **AND** 返回使用完整内置默认配置的可用 logger
- **AND** 无效配置中的任何 root 或命名 logger 字段均不得进入降级配置

### Requirement: 缺省配置文件与显式配置文件必须区别处理

当未设置 `LOGGER_CONFIG_PATH` 且默认 `logger.yaml` 不存在时，系统 SHALL 安静使用内置默认配置。当 `LOGGER_CONFIG_PATH` 显式指定的文件不存在时，系统 MUST 将其视为配置错误。

#### Scenario: 未显式配置且默认文件不存在

- **GIVEN** 未设置 `LOGGER_CONFIG_PATH` 且当前工作目录不存在 `logger.yaml`
- **WHEN** 应用显式初始化或首次获取 logger
- **THEN** 系统使用内置默认配置
- **AND** 不输出配置文件缺失警告

#### Scenario: 显式指定的配置文件不存在

- **GIVEN** `LOGGER_CONFIG_PATH` 指向不存在的文件
- **WHEN** 应用调用 `LoggerFactory.init()`
- **THEN** 系统抛出包含该文件路径的 `ConfigError`

#### Scenario: 懒加载时显式文件不存在

- **GIVEN** `LOGGER_CONFIG_PATH` 指向不存在的文件
- **WHEN** 应用直接获取 logger
- **THEN** 系统输出包含该文件路径的警告
- **AND** 返回使用内置默认配置的可用 logger

### Requirement: 敏感字段配置键必须兼容并消除歧义

系统 SHALL 将 `sensitiveMasking` 作为推荐配置键，并在当前兼容周期内接受历史别名 `sensitive-masking`。两个键在同一配置对象中同时出现时系统 MUST 拒绝该配置。

#### Scenario: 使用推荐配置键

- **GIVEN** root 或命名 logger 使用 `sensitiveMasking` 配置
- **WHEN** 系统加载并使用该配置
- **THEN** 对应敏感字段策略按配置生效

#### Scenario: 使用历史配置键

- **GIVEN** root 或命名 logger 仅使用 `sensitive-masking` 配置
- **WHEN** 系统加载并使用该配置
- **THEN** 系统将其规范化为与 `sensitiveMasking` 相同的行为

#### Scenario: 同时使用两个配置键

- **GIVEN** 同一个 root 或命名 logger 配置对象同时包含 `sensitiveMasking` 和 `sensitive-masking`
- **WHEN** 系统校验配置
- **THEN** 系统产生 `ConfigError`
- **AND** 错误信息包含发生冲突的配置对象路径

### Requirement: 敏感字段规则必须按确定性语义合并

系统 SHALL 以内置敏感字段规则为基线，按字段名执行确定性合并。root 自定义同名规则覆盖内置规则并追加新字段；命名 logger 自定义同名规则覆盖 root 的最终规则并追加新字段。`fields: []` MUST 表示不增加或覆盖规则，不得清空已继承规则。字段名匹配 MUST 保持大小写敏感和精确匹配。

#### Scenario: root 覆盖默认规则

- **GIVEN** root 将 `password` 的 mask 配置为 `******`
- **WHEN** root logger 记录包含 `password: "secret"` 的 meta
- **THEN** 输出中的 password 值为 `******`
- **AND** 未被 root 覆盖的内置规则仍然生效

#### Scenario: root 追加自定义规则

- **GIVEN** root 新增字段 `customSecret` 的脱敏规则
- **WHEN** logger 记录包含 `customSecret` 的 meta
- **THEN** 输出中的 `customSecret` 按自定义规则脱敏

#### Scenario: 命名 logger 覆盖 root 规则

- **GIVEN** root 和命名 logger 对同一字段配置不同 mask
- **WHEN** 该命名 logger 记录该敏感字段
- **THEN** 输出使用命名 logger 配置的 mask
- **AND** 其他 logger 继续使用各自的有效规则

#### Scenario: 空字段列表保留继承规则

- **GIVEN** 命名 logger 配置 `sensitiveMasking.fields: []`
- **WHEN** 该 logger 记录内置或 root 配置的敏感字段
- **THEN** 已继承的敏感字段规则仍然生效

#### Scenario: 字段名大小写不同

- **GIVEN** 有效策略只包含字段名 `password`
- **WHEN** logger 记录字段 `Password`
- **THEN** 系统不将 `Password` 视为 `password` 规则的匹配项

### Requirement: 每个命名 logger 必须使用隔离的脱敏策略

系统 SHALL 根据每个命名 logger 的最终合并配置创建并复用其独立脱敏策略。一个 logger 的开关或字段规则 MUST NOT 改变其他 logger 的输出行为，且策略结果不得依赖 logger 的首次获取顺序。

#### Scenario: 两个 logger 使用不同规则

- **GIVEN** logger A 和 logger B 对同一敏感字段配置不同 mask
- **WHEN** 两个 logger 分别记录该字段
- **THEN** logger A 和 logger B 的输出分别使用各自 mask

#### Scenario: 一个 logger 禁用脱敏

- **GIVEN** logger A 配置 `enabled: false`，logger B 继承已启用的 root 策略
- **WHEN** 两个 logger 记录相同敏感字段
- **THEN** logger A 输出原始字段值
- **AND** logger B 输出脱敏后的字段值

#### Scenario: 获取顺序不影响策略

- **GIVEN** 两个命名 logger 具有不同的有效脱敏配置
- **WHEN** 应用以任意顺序首次获取两个 logger
- **THEN** 每个 logger 的输出结果保持一致

### Requirement: 禁用全部 transport 时 logger 必须安全静默

当某个 logger 的有效配置同时禁用 console 和 file transport 时，系统 SHALL 返回满足 Logger 接口的静默 logger。调用其日志方法 MUST 不输出日志、不产生无 transport 警告且不抛出异常。

#### Scenario: 全部 transport 被禁用

- **GIVEN** 某个 logger 的有效配置中 console 和 file 均为 disabled
- **WHEN** 应用获取该 logger 并调用任意日志级别方法
- **THEN** 系统不写入 console 或文件
- **AND** 不产生 Winston 无 transport 警告
- **AND** 日志方法不抛出异常
