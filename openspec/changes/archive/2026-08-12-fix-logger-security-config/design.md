## Context

参见 [proposal.md](./proposal.md) 的问题背景。当前配置加载、配置继承和脱敏执行分散在三个全局模块中：`ConfigLoader` 缓存合并配置，`LoggerFactory` 创建 wrapper，`SensitiveMasker` 则在第一次调用 `mask()` 时使用默认规则初始化全局状态。结果是 YAML 脱敏配置无法进入输出链路，而且任一 logger 都无法拥有独立策略。

当前 `validateConfigValue` 依赖字符串路径判断日志级别，实际命名 logger 路径为 `loggers.<name>.level`，与硬编码的 `loggers.*.level` 不匹配。配置加载失败与“未提供可选配置文件”也被合并成同一降级路径，造成正常默认用法持续告警。

本设计必须保持现有 Logger 调用 API，并避免引入新的运行时依赖。

## Goals / Non-Goals

**Goals:**

- 建立单一的配置处理管线：解析、别名规范化、schema 校验、默认值合并、命名 logger 合并。
- 为每个 logger 编译不可变且隔离的脱敏策略。
- 让所有配置错误具有稳定的 `ConfigError` 类型和准确路径。
- 在不增加第三方依赖的前提下保持日志热路径的 O(1) 规则查找。
- 用跨模块集成测试证明 YAML 配置最终影响真实日志输出。

**Non-Goals:**

- 不修改 `shutdown()`、wrapper 生命周期或信号处理。
- 不处理 BigInt、循环引用、Date、嵌套 Error 等通用 meta 序列化问题。
- 不改变脱敏模板语法、最大递归深度和字段名精确匹配规则。
- 不增加动态配置重载。
- 不公开新的独立脱敏 API。

## Decisions

### Decision 1: 使用分阶段配置管线

配置处理顺序固定为：

```text
YAML parse
   ↓
原始结构与未知字段校验
   ↓
sensitive-masking → sensitiveMasking 别名规范化
   ↓
字段值与敏感规则校验
   ↓
内置默认配置 + root 配置
   ↓
root 有效配置 + 命名 logger 配置
   ↓
只读 EffectiveLoggerConfig
```

别名规范化不能先于冲突检查，否则同时配置两个键时会静默覆盖。校验失败前不得更新 `ConfigLoader` 的已缓存状态；只有整份配置成功规范化并合并后才原子替换缓存。

替代方案：延续当前递归遍历并按路径字符串校验。该方案代码短，但动态 logger 名称、数组成员路径和未知字段很容易再次漏检，因此不采用。

### Decision 2: 手写 schema 校验，不引入第三方校验库

配置对象规模固定且字段较少，使用按对象层级划分的校验函数：

| 校验函数                         | 功能                                         | 依赖            |
| -------------------------------- | -------------------------------------------- | --------------- |
| `validateParsedConfig`           | 校验顶层 `root`、`loggers` 及未知字段        | logger 配置校验 |
| `validateLoggerConfig`           | 校验 level、pattern、console、file、敏感配置 | 子配置校验      |
| `validateConsoleConfig`          | 校验 enabled、colors、format                 | 基础类型校验    |
| `validateFileConfig`             | 校验 enabled 及所有字符串选项                | 基础类型校验    |
| `validateSensitiveMaskingConfig` | 校验 enabled、fields 数组和规则              | 敏感规则校验    |
| `assertKnownKeys`                | 拒绝当前 schema 之外的键                     | `ConfigError`   |

所有函数都接收当前路径并抛出统一 `ConfigError`。路径使用点号和数组下标，例如 `loggers.database.sensitiveMasking.fields[0].mask`。

替代方案：引入 Zod、Joi 或 JSON Schema。它们能减少部分校验代码，但会为一个小型基础工具包增加运行时体积、错误格式适配和依赖维护成本，本次不采用。

### Decision 3: 每个 logger 持有实例级 `MaskingPolicy`

将现有全局可变 `SensitiveMasker` 重构为可实例化或可编译的策略：

```ts
interface MaskingPolicy {
    readonly enabled: boolean;
    mask(value: unknown): unknown;
}

function createMaskingPolicy(config?: SensitiveMaskingConfig): MaskingPolicy;
```

`LoggerFactory.getLogger(name)` 获取有效配置后创建一次策略，并让 wrapper 的四个日志方法通过闭包复用。策略内部继续使用预编译 renderer cache、字段 Map 和 Set；不得读取或修改进程级全局脱敏状态。

| 模块              | 功能                                                      | 依赖关系                               |
| ----------------- | --------------------------------------------------------- | -------------------------------------- |
| `ConfigLoader`    | 输出 root 和命名 logger 的有效配置                        | defaultConfig、配置类型、ConfigError   |
| `SensitiveMasker` | 从有效敏感配置编译隔离策略并递归脱敏                      | 默认字段、脱敏配置类型                 |
| `LoggerFactory`   | 为每个 logger 绑定 transport、formatter 和 masking policy | ConfigLoader、SensitiveMasker、Winston |
| `defaultConfig`   | 提供不可污染的默认配置和默认敏感字段                      | 配置类型                               |
| `types`           | 描述外部配置和内部有效配置                                | 无运行时依赖                           |

替代方案：在每次日志调用前重新初始化全局 `SensitiveMasker`。这会产生并发串扰、额外热路径开销，并使输出依赖调用顺序，因此不采用。

### Decision 4: 采用三层敏感规则合并

规则合并顺序为：

```text
内置规则
   ↓ 按 field 覆盖/追加
root 自定义规则
   ↓ 按 field 覆盖/追加
命名 logger 自定义规则
```

数组不能沿用通用 merge 的“整体替换”语义，而应单独按 `field` 合并。`fields` 未配置和 `fields: []` 都不改变已继承规则。`enabled` 使用普通配置继承：命名 logger 未配置时继承 root，显式 `false` 时仅关闭自身策略。

规则输出顺序保持稳定：被覆盖字段保留原位置，新字段按配置顺序追加，方便测试与诊断。若同一层 `fields` 内重复声明同一字段，校验阶段抛出 `ConfigError`，避免最后一项覆盖前一项的隐式行为。

替代方案：自定义 fields 完全替换默认规则。虽然与普通数组合并一致，但容易因只添加一个业务字段而意外关闭 password/token 等默认保护，因此不采用。

### Decision 5: 兼容历史 kebab-case 键一个版本周期

配置解析在 root 和每个命名 logger 层级接受 `sensitiveMasking` 或 `sensitive-masking`。内部类型和 README 只使用 camelCase。二者同层同时出现视为冲突，并在规范化前抛错。

不在本变更中输出弃用 warning，避免每次启动增加噪声；README 将标注历史键兼容但已弃用，计划在后续主版本移除。

替代方案：立即拒绝历史键。这会让按照旧 OpenSpec/文档编写的配置直接失效，迁移成本不必要，因此不采用。

### Decision 6: 将配置文件来源纳入加载决策

`ConfigLoader` 区分：

| 来源                                 | 文件不存在         | 显式 `init()`    | 懒加载           |
| ------------------------------------ | ------------------ | ---------------- | ---------------- |
| 未设置环境变量的默认 `./logger.yaml` | 视为未提供外部配置 | 安静使用默认配置 | 安静使用默认配置 |
| `LOGGER_CONFIG_PATH` 显式路径        | 配置错误           | 抛 `ConfigError` | 告警并完整降级   |
| 方法参数显式传入路径                 | 配置错误           | 抛 `ConfigError` | 不适用           |

“完整降级”表示丢弃本次无效文件中所有已解析字段，不能保留部分 root 或命名 logger 配置。

### Decision 7: 无 transport 时返回显式 no-op wrapper

在有效配置中 console 和 file 都禁用时，`LoggerFactory` 不向 Winston Container 添加 logger，而是缓存实现同一 Logger 接口的 no-op wrapper。这样可以支持按命名空间关闭日志，同时避免 Winston 的无 transport 警告和潜在内存累积。

no-op wrapper 仍按名称缓存，且其方法不执行脱敏和格式化，避免无意义开销。

### Decision 8: 保持公开 API，不导出内部策略

| API/配置项                       | 类型                     | 必填 | 默认值                     | 本次行为                           |
| -------------------------------- | ------------------------ | ---: | -------------------------- | ---------------------------------- |
| `LoggerFactory.getLogger(name)`  | `name: string`           |   是 | 无                         | API 不变；绑定名称对应的有效策略   |
| `LoggerFactory.init()`           | 无参数                   |   否 | 使用配置来源规则           | API 不变；非法配置抛 `ConfigError` |
| `ConfigLoader.load(configPath?)` | `configPath?: string`    |   否 | 环境变量或 `./logger.yaml` | 显式路径缺失时报错                 |
| `sensitiveMasking.enabled`       | boolean                  |   否 | `true`                     | 可在 root 或命名 logger 覆盖       |
| `sensitiveMasking.fields`        | `SensitiveFieldConfig[]` |   否 | 内置规则                   | 按字段覆盖和追加                   |
| `sensitive-masking`              | 历史别名                 |   否 | 无                         | 当前兼容周期接受，内部规范化       |

`ConfigError` 可以继续通过 `ConfigLoader.ConfigError` 访问，避免额外公共导出变更。本次不处理 README 中其他公共类型导出不一致问题。

### Decision 9: 测试采用单元、集成和配置矩阵三层结构

| 模块            | 成功分支                                                          | 失败/边界分支                                                            |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ConfigLoader    | 完整配置、部分继承、两个合法键分别规范化、默认文件缺失            | 每个字段类型错误、未知字段、重复规则、双键冲突、显式文件缺失、缓存原子性 |
| SensitiveMasker | 默认规则、root 覆盖/追加、命名覆盖/追加、空 fields、enabled 继承  | 策略隔离、创建顺序反转、大小写不匹配、禁用策略                           |
| LoggerFactory   | YAML 配置真实影响 plain/JSON 输出、未配置时安静默认、no-op logger | 懒加载完整降级、不同 logger 不串扰、无 transport 不产生 warning          |
| 公共回归        | 现有 Logger API、console format、traceId、配置继承                | 非法配置统一错误类型与路径                                               |

集成测试必须通过实际 YAML 文件和公开 LoggerFactory 调用触发，不得直接调用内部策略代替端到端验证。

## Risks / Trade-offs

- [未知字段改为拒绝可能暴露历史配置中的拼写或私有扩展] → 在发布说明中列出合法 schema，并通过懒加载降级保留非严格启动能力。
- [自定义规则开始生效会改变日志内容] → 提供命名 logger 级 `enabled: false` 灰度开关，并以安全默认值优先。
- [实例级策略会增加少量内存] → 每个 logger 仅保存有限 Map/Set 和模板 renderer，随 wrapper 缓存共同复用。
- [兼容两个配置键增加短期复杂度] → 只在解析边界处理别名，内部模型保持单一 camelCase，并明确后续主版本移除计划。
- [no-op logger 跳过脱敏意味着禁用日志路径不再执行相关逻辑] → 该路径无任何输出，跳过处理不会降低信息安全性，并减少无用开销。
- [手写校验未来可能随字段扩展遗漏] → 每个配置接口新增字段时必须同步 known-key 列表和成功/失败测试矩阵。

## Migration Plan

1. 先引入配置校验、别名规范化和不可污染的有效配置模型，保持现有输出链路不变并运行回归测试。
2. 引入实例级 masking policy，接入每个 logger wrapper，并增加双 logger 隔离测试。
3. 接入无 transport 的 no-op 分支和配置来源区分。
4. 增加 YAML 到输出的端到端测试，确认推荐键、历史键、禁用、覆盖、追加和降级场景。
5. 更新 README 和示例，发布 prerelease 供使用方验证现有 YAML。
6. 若出现不可接受问题，回滚该包版本；局部日志格式问题可临时对受影响命名 logger 设置 `sensitiveMasking.enabled: false`，但生产环境不建议全局关闭默认脱敏。

本变更不需要数据库迁移，也不引入新的第三方依赖。
