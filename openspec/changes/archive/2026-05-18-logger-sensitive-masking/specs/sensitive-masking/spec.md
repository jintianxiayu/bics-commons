## ADDED Requirements

### Requirement: 敏感字段脱敏开关
系统 SHALL 支持通过配置项控制敏感信息脱敏功能的开启和关闭。

#### Scenario: 默认启用脱敏
- **WHEN** 未配置 `sensitive-masking.enabled`
- **THEN** 系统默认启用脱敏功能

#### Scenario: 显式启用脱敏
- **WHEN** 配置 `sensitive-masking.enabled: true`
- **THEN** 系统启用脱敏功能

#### Scenario: 禁用脱敏
- **WHEN** 配置 `sensitive-masking.enabled: false`
- **THEN** 系统跳过脱敏逻辑，原始值直接输出

---

### Requirement: 敏感字段名匹配
系统 SHALL 支持按字段名递归匹配并脱敏敏感数据。

#### Scenario: 顶层敏感字段脱敏
- **WHEN** 调用 `log.info("message", { password: "secret123" })`
- **THEN** 输出 meta 中 `password` 字段值被脱敏为 `********`

#### Scenario: 嵌套对象中的敏感字段脱敏
- **WHEN** 调用 `log.info("message", { user: { password: "secret123" } })`
- **THEN** 输出 meta 中嵌套的 `password` 字段值被脱敏为 `********`

#### Scenario: 数组成员中的敏感字段脱敏
- **WHEN** 调用 `log.info("message", { users: [{ name: "A", password: "pass1" }, { name: "B", password: "pass2" }] })`
- **THEN** 输出 meta 中每个数组成员的 `password` 字段值均被脱敏为 `********`

#### Scenario: 未配置字段名原样输出
- **WHEN** 调用 `log.info("message", { username: "john" })`
- **THEN** 输出 meta 中 `username` 字段值保持原样 `"john"`

---

### Requirement: 模板化脱敏格式
系统 SHALL 支持不同类型敏感字段配置不同的脱敏模板。

#### Scenario: 全掩码模板
- **WHEN** 敏感字段配置模板为 `********`
- **THEN** 任意长度值均被脱敏为 8 个星号

#### Scenario: 部分保留模板 - {lastN}
- **WHEN** 敏感字段配置模板为 `*** *** {last4}` 且值为 `"13812345678"`
- **THEN** 值被脱敏为 `*** *** 5678`

#### Scenario: 部分保留模板 - {firstN}
- **WHEN** 敏感字段配置模板为 `{first3}****` 且值为 `"13812345678"`
- **THEN** 值被脱敏为 `138****`

#### Scenario: 邮箱域名模板 - {domain}
- **WHEN** 敏感字段配置模板为 `{first2}***@{domain}` 且值为 `"john@example.com"`
- **THEN** 值被脱敏为 `jo***@example.com`

#### Scenario: 银行卡号模板
- **WHEN** 敏感字段配置模板为 `**** **** **** {last4}` 且值为 `"6234567812345678"`
- **THEN** 值被脱敏为 `**** **** **** 5678`

---

### Requirement: 值长度不足截断保护
系统 SHALL 在脱敏值长度不足时执行截断保护。

#### Scenario: 值长度小于保留位数
- **WHEN** 应用模板 `{last4}` 到值 `"123"`
- **THEN** 值被脱敏为 `*123`（取可用部分，前补星号至模板位数）

#### Scenario: 空字符串
- **WHEN** 应用模板 `{last4}` 到空字符串 `""`
- **THEN** 值被脱敏为 `""`（空字符串）

---

### Requirement: 异常值容错处理
系统 SHALL 在脱敏过程中遇到异常值时不会抛出异常，保持业务正常运行。

#### Scenario: null 值脱敏
- **WHEN** 敏感字段值为 `null`
- **THEN** 值被脱敏为字符串 `"null"`

#### Scenario: undefined 值脱敏
- **WHEN** 敏感字段值为 `undefined`
- **THEN** 值被脱敏为字符串 `"undefined"`

#### Scenario: 非字符串值脱敏
- **WHEN** 敏感字段值为数字 `12345`（非字符串）
- **THEN** 值被脱敏为字符串 `"12345"`

#### Scenario: 邮箱格式异常
- **WHEN** 敏感字段配置模板为 `{first2}***@{domain}` 且值为 `"justusername"`（无 @）
- **THEN** 值被脱敏为 `********`（降级全掩码）

#### Scenario: 嵌套层级超限
- **WHEN** 调用 `log.info("message", { level1: { level2: { level3: { level4: { level5: { level6: { sensitive: "data" } } } } } } } })`
- **THEN** 超过 5 层嵌套的部分返回 `[MAX_DEPTH_EXCEEDED]`

---

### Requirement: 配置覆盖预定义规则
系统 SHALL 支持用户通过配置覆盖预定义的默认敏感字段规则。

#### Scenario: 覆盖默认字段的脱敏模板
- **WHEN** 配置 `sensitive-masking.fields` 包含 `{ field: "password", mask: "******" }`
- **THEN** `password` 字段使用用户配置的模板 `******`

#### Scenario: 新增额外敏感字段
- **WHEN** 配置 `sensitive-masking.fields` 包含 `{ field: "customSecret", mask: "********" }`
- **THEN** `customSecret` 字段也会被脱敏