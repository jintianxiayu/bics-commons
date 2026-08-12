## Purpose

本能力用于保证 logger 接受任意 JavaScript meta 值时都能生成安全、稳定且可诊断的 JSON-compatible 输出，同时在 plain 与 JSON 格式中保持一致语义并优先执行敏感字段保护。

## ADDED Requirements

### Requirement: 普通 JSON-compatible meta 必须保持结构与值

系统 SHALL 保持 null、boolean、有限 number、string、数组以及具有可枚举字符串自有属性的普通对象的结构和值。规范化过程 MUST NOT 修改调用方传入的原始值。

#### Scenario: 记录嵌套普通对象

- **GIVEN** meta 包含有限数字、字符串、布尔值、null、数组和嵌套普通对象
- **WHEN** logger 记录该 meta
- **THEN** 输出保持相同的属性名称、数组顺序和普通值
- **AND** 原始 meta 对象不被修改

#### Scenario: 普通对象具有共享子对象

- **GIVEN** 两个同级属性引用同一个非循环子对象
- **WHEN** logger 记录该对象
- **THEN** 两个属性都输出该子对象的完整内容
- **AND** 任一属性都不被标记为 `[Circular]`

### Requirement: 特殊原始值必须转换为稳定表示

系统 SHALL 将不能由标准 JSON 无损表示的原始值转换为稳定字符串：BigInt 使用十进制字符串，NaN 使用 `NaN`，正负 Infinity 分别使用 `Infinity` 与 `-Infinity`，undefined 使用 `[Undefined]`，symbol 使用其 `String(value)` 表示，function 使用 `[Function: <name>]`；匿名函数的 name MUST 使用 `anonymous`。这些值出现在对象属性、数组或顶层 meta 参数时 MUST 使用相同规则。

#### Scenario: 记录 BigInt 与非有限数字

- **GIVEN** meta 同时包含 `9007199254740993n`、NaN、Infinity 和 -Infinity
- **WHEN** logger 记录该 meta
- **THEN** 对应输出依次为 `9007199254740993`、`NaN`、`Infinity` 和 `-Infinity` 字符串
- **AND** 日志调用不抛出序列化异常

#### Scenario: 记录 undefined、symbol 与 function

- **GIVEN** meta 的对象属性和数组元素包含 undefined、symbol、命名函数与匿名函数
- **WHEN** logger 记录该 meta
- **THEN** 每个值按规定的稳定字符串输出而不是被删除或变成 null
- **AND** 数组长度和元素位置保持不变

### Requirement: Date 必须使用明确的时间表示

系统 SHALL 将有效 Date 输出为 `toISOString()` 对应的 UTC ISO 8601 字符串，并将无效 Date 输出为 `[Invalid Date]`。系统 MUST NOT 因 Date 无效而抛出异常。

#### Scenario: 记录有效 Date

- **GIVEN** meta 包含表示 `2026-08-13T01:02:03.000Z` 的有效 Date
- **WHEN** logger 记录该 meta
- **THEN** 输出值等于 `2026-08-13T01:02:03.000Z`

#### Scenario: 记录无效 Date

- **GIVEN** meta 包含无效 Date
- **WHEN** logger 记录该 meta
- **THEN** 输出值为 `[Invalid Date]`
- **AND** 日志调用不抛出异常

### Requirement: Error 必须保留诊断信息和安全自定义字段

系统 SHALL 将顶层或任意嵌套 Error 规范化为对象。该对象 MUST 包含 `name` 和 `message`，在原值存在时 MUST 包含 `stack` 与递归规范化的 `cause`，并 SHALL 包含 Error 的其他可枚举字符串自有属性。Error 自定义字段与 cause MUST 遵循相同的循环、深度、特殊值和脱敏规则。

#### Scenario: 记录带 cause 的嵌套 Error

- **GIVEN** meta 对象包含具有 name、message、stack 和 Error cause 的异常
- **WHEN** logger 记录该 meta
- **THEN** 输出保留外层与 cause 的 name、message 和可用 stack
- **AND** Error 不会退化为空对象

#### Scenario: Error 包含可枚举自定义字段

- **GIVEN** Error 具有 `code`、`details` 和其他可枚举字符串自有属性
- **WHEN** logger 记录该 Error
- **THEN** 输出在标准 Error 字段之外保留这些自定义字段
- **AND** 自定义字段按统一 meta 规则规范化

### Requirement: 循环引用与深层结构必须安全截断

系统 SHALL 使用当前遍历路径检测真实循环引用，并将回到当前祖先的值输出为 `[Circular]`。超过最大深度 5 的非敏感复合值 MUST 输出为 `[MAX_DEPTH_EXCEEDED]`。循环检测 MUST 与深度限制同时生效，且不得把已离开当前路径的共享引用视为循环。

#### Scenario: 对象直接引用自身

- **GIVEN** meta 对象的 `self` 属性引用该对象自身
- **WHEN** logger 记录该 meta
- **THEN** `self` 输出为 `[Circular]`
- **AND** 对象的其他属性继续正常输出

#### Scenario: 数组与对象形成间接循环

- **GIVEN** meta 中数组与嵌套对象互相引用形成循环
- **WHEN** logger 记录该 meta
- **THEN** 回到当前祖先的位置输出 `[Circular]`
- **AND** 日志调用不抛出异常

#### Scenario: 非循环结构超过最大深度

- **GIVEN** meta 包含超过 5 层的非循环嵌套复合值
- **WHEN** logger 记录该 meta
- **THEN** 超出边界的复合值输出为 `[MAX_DEPTH_EXCEEDED]`

### Requirement: 属性访问失败不得中断日志调用

系统 SHALL 只遍历可枚举字符串自有属性，并 MUST NOT 调用对象自定义的 `toJSON`。读取某个属性时抛错，该属性 MUST 输出为 `[Property Access Error]` 且其他属性继续处理；若无法枚举整个对象，整个值 MUST 输出为 `[Unserializable]`。占位符不得包含原始错误消息或失败属性值。

#### Scenario: 可枚举 getter 抛错

- **GIVEN** meta 对象具有一个抛错 getter 和一个可正常读取的同级属性
- **WHEN** logger 记录该对象
- **THEN** 抛错属性输出为 `[Property Access Error]`
- **AND** 正常属性仍按原值输出
- **AND** 日志调用不抛出异常

#### Scenario: 对象无法枚举

- **GIVEN** meta 值在枚举自有属性时抛出异常
- **WHEN** logger 记录该值
- **THEN** 整个值输出为 `[Unserializable]`
- **AND** 占位符不包含异常消息中的潜在敏感内容

#### Scenario: 对象定义自定义 toJSON

- **GIVEN** meta 对象具有会抛错或产生副作用的自定义 `toJSON`
- **WHEN** logger 记录该对象
- **THEN** 系统不调用该 `toJSON`
- **AND** 仅按普通可枚举字符串自有属性生成输出

### Requirement: 敏感字段保护必须先于不安全值降级

系统 MUST 对每个可读取的敏感字段应用当前 logger 的脱敏策略，再生成最终 JSON-compatible 输出。该规则 SHALL 覆盖普通对象、数组成员、Error 自定义字段、Date、BigInt 和循环结构中的敏感字段；安全降级不得输出敏感字段的原始值。禁用脱敏时，系统 SHALL 仍执行安全规范化。

#### Scenario: 特殊值位于敏感字段

- **GIVEN** 当前策略包含 `token`，且 meta 的 token 值为 BigInt、Date 或 Error
- **WHEN** logger 记录该 meta
- **THEN** token 输出为配置的 mask
- **AND** 输出不包含特殊值的原始表示或 Error 诊断内容

#### Scenario: 循环对象包含敏感字段

- **GIVEN** 循环 meta 对象在形成循环前包含 password 字段
- **WHEN** logger 记录该对象
- **THEN** password 按当前策略脱敏
- **AND** 循环边输出为 `[Circular]`

#### Scenario: 当前 logger 禁用脱敏

- **GIVEN** 当前 logger 配置 `sensitiveMasking.enabled: false`
- **WHEN** logger 记录包含 BigInt、Date、Error 或循环引用的 meta
- **THEN** 系统不替换普通敏感字段值
- **AND** 仍按本能力的安全规则规范化全部值

### Requirement: plain 与 JSON 输出必须采用一致的 meta 语义

系统 SHALL 在 plain、JSON 和内部 pattern formatter 路径使用同一规范化语义。对同一 meta，plain 输出中 `%{meta}` 的 JSON 文本解析结果 MUST 与 JSON 模式中 `meta` 字段的结构和值一致。任意日志级别的方法 MUST NOT 因 meta 的支持类型、循环引用或读取失败而抛出异常。

#### Scenario: 同一特殊 meta 分别输出为 plain 和 JSON

- **GIVEN** 同一 meta 包含 BigInt、Date、嵌套 Error、循环引用和失败 getter
- **WHEN** 分别由 plain logger 与 JSON logger 记录
- **THEN** plain `%{meta}` 可被 `JSON.parse` 解析
- **AND** 解析后的值与 JSON 输出的 `meta` 字段一致

#### Scenario: 四个日志级别记录不安全 meta

- **GIVEN** meta 包含循环引用、BigInt 和抛错 getter
- **WHEN** 依次调用 debug、info、warn 和 error
- **THEN** 四次调用均不抛出异常
- **AND** 每条实际输出的日志均为合法的目标格式
