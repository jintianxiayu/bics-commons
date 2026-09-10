# logger-sensitive-field-masking Specification

## Purpose

为 Logger 的元数据字段提供默认安全、自定义模板和显式单字段退出三类可组合策略，使调用方能处理与内置字段同名但不承载敏感信息的业务数据，同时避免无意改变其他字段的脱敏保护。

## Requirements

### Requirement: 默认敏感字段继续自动脱敏

系统 MUST 在启用脱敏且调用方未显式配置字段策略时，继续按既有内置规则对敏感元数据字段执行大小写不敏感的递归脱敏。完整遮盖、保留末四位和邮箱脱敏的既有字段集合及输出规则 MUST 保持不变。

#### Scenario: 未配置字段策略时保持默认保护

- **WHEN** 调用方启用脱敏但未配置 `masking.fields`，并记录包含 `password`、`phone` 和 `email` 的元数据
- **THEN** `password` MUST 完整遮盖，`phone` MUST 只保留末四位，`email` MUST 按既有邮箱策略脱敏

#### Scenario: 既有字符串模板配置保持兼容

- **WHEN** 调用方为一个内置字段或业务字段配置字符串脱敏模板
- **THEN** 系统 MUST 按既有模板语法新增或覆盖该字段策略
- **AND** 既有仅包含字符串模板的 TypeScript 与 YAML 配置 MUST 无需修改即可继续使用

### Requirement: 字段策略允许显式取消脱敏

`SensitiveFieldConfig` MUST 允许字段值为字符串模板或布尔值 `false`。当值为 `false` 时，系统 MUST 移除该规范化字段名对应的脱敏策略，而不是为其生成替代文本；未退出的其他字段策略 MUST 保持有效。

#### Scenario: 取消 password 的内置脱敏

- **WHEN** 调用方配置 `masking.fields.password: false` 并记录 `{ password: 'visible', token: 'secret' }`
- **THEN** 输出元数据中的 `password` MUST 等于 `'visible'`
- **AND** `token` MUST 继续按内置策略完整遮盖

#### Scenario: 退出匹配不区分大小写

- **WHEN** 调用方配置 `masking.fields.password: false` 并在任意嵌套层级记录名为 `Password` 或 `PASSWORD` 的字段
- **THEN** 系统 MUST 不因这些字段名对其值执行脱敏

#### Scenario: 相近字段和别名不随之退出

- **WHEN** 调用方只配置 `masking.fields.password: false`，并记录包含 `passwd`、`pwd` 和 `passwordHash` 的元数据
- **THEN** `passwd` 和 `pwd` MUST 继续按各自内置策略脱敏
- **AND** `passwordHash` MUST 继续按其自身是否存在策略决定是否脱敏，不得因前缀相似而自动退出

#### Scenario: 退出父字段不跳过嵌套字段判断

- **WHEN** 调用方配置 `masking.fields.password: false`，且 `password` 的值是包含 `token` 字段的对象
- **THEN** 系统 MUST 不因外层 `password` 字段名整体遮盖该对象
- **AND** 系统 MUST 继续递归处理对象内部的 `token` 并应用其内置脱敏策略

#### Scenario: 单字段退出应用于全部日志输出

- **WHEN** 调用方配置一个字段为 `false`，并通过任意命名 Logger 向 Console 或 File 通道记录该字段
- **THEN** 所有启用的输出通道 MUST 使用同一退出策略
- **AND** 系统 MUST 继续复制元数据而不得修改调用方传入的对象

### Requirement: 字段策略配置在初始化阶段严格校验

系统 MUST 仅接受非空字段名对应的字符串模板或布尔值 `false`。`true`、`null`、数字、对象和数组等其他值 MUST 在 Logger 初始化阶段被拒绝；字符串模板仍 MUST 接受既有语法校验。

#### Scenario: 拒绝不支持的字段策略类型

- **WHEN** TypeScript 调用方将 `true`、`null` 或数字用作 `SensitiveFieldConfig` 的字段值
- **THEN** 类型检查 MUST 拒绝该配置
- **AND** 当等价无效值来自 YAML 等运行时来源时，Logger 初始化 MUST 抛出配置错误

#### Scenario: false 字符串仍是模板

- **WHEN** YAML 将字段值配置为带引号的字符串 `'false'`
- **THEN** 系统 MUST 将其视为输出固定文本 `false` 的字符串模板
- **AND** 系统 MUST NOT 将其解释为取消脱敏

#### Scenario: 拒绝大小写不敏感的重复规则

- **WHEN** 同一配置同时包含规范化后相同的两个字段名，且其值分别为字符串模板、`false` 或二者的组合
- **THEN** Logger 初始化 MUST 抛出重复字段配置错误

### Requirement: 全局脱敏开关语义保持不变

`masking.enabled` MUST 继续控制是否执行全部字段策略。字段级 `false` 只定义启用脱敏时的策略集合，不得改变全局开关、日志结构、消息文本处理边界或元数据规范化行为。

#### Scenario: 全局关闭时不执行任何字段策略

- **WHEN** 调用方配置 `masking.enabled: false`，无论 `masking.fields` 中是否包含字符串模板或 `false`
- **THEN** 系统 MUST 不执行内置或自定义字段脱敏
- **AND** 系统 MUST 继续按既有行为复制和规范化元数据

#### Scenario: 字段退出不解析消息文本

- **WHEN** 调用方配置字段级退出并将相同文本写入日志 `message`
- **THEN** 字段级策略 MUST 仍只作用于元数据字段
- **AND** 系统 MUST NOT 新增对 `message` 文本的解析或替换
