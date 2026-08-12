## Context

参见 [proposal.md](./proposal.md) 的问题背景和 [logger-meta-serialization spec](./specs/logger-meta-serialization/spec.md) 的行为契约。当前 LoggerFactory wrapper 先对顶层 Error 做一次特判，再让 `SensitiveMasker` 递归克隆普通对象，plain formatter 最后直接 `JSON.stringify`。这一管线对特殊对象缺少统一语义：Date 和嵌套 Error 在脱敏阶段丢失属性，BigInt 在 stringify 时抛错，循环结构只能偶然依靠深度限制结束。

`PatternFormatter.ts` 另有一个直接 stringify meta 的实现，目前不在 LoggerFactory 主路径中，但仍属于包内 formatter，必须与主路径共享防御逻辑。实现必须保持 Logger API 和配置 schema，不引入第三方依赖，并避免执行不可信对象的 `toJSON`。

## Goals / Non-Goals

**Goals:**

- 通过一次有界遍历生成 JSON-compatible、可脱敏的 meta 快照。
- 为特殊原始值、Date、Error、循环、深度截断和属性失败建立唯一语义。
- 让 plain、JSON 与 PatternFormatter 使用同一安全 stringify 边界。
- 保持普通 JSON-compatible 输入的结构和值，并且不修改调用方对象。
- 对失败对象采取局部降级，保证日志方法不成为业务异常源。

**Non-Goals:**

- 不实现任意 class 实例、Map、Set、RegExp、Buffer 或 TypedArray 的专用业务表示；它们按可枚举字符串自有属性处理。
- 不保留对象 identity、property descriptor、prototype、symbol-keyed 属性或稀疏数组 hole 的差异。
- 不增加用户可配置 replacer、深度上限或占位符。
- 不捕获 message 参数本身的运行时类型错误；本能力只处理 meta 参数。
- 不导出公共 MetaSerializer API，也不改变脱敏字段匹配的大小写精确语义。

## Decisions

### Decision 1: 新增单一 MetaSerializer 并在脱敏后输出 JSON-safe 快照

新增内部 `MetaSerializer.ts`，提供两个内部函数：

```ts
normalizeMeta(value: unknown, maskingPolicy: MaskingPolicy): JsonSafeValue;
safeStringify(value: unknown): string;
```

Logger wrapper 对每个 meta 参数调用 `normalizeMeta`，把 JSON-safe 快照传给 Winston。plain formatter 与 `PatternFormatter` 使用 `safeStringify` 作为最后防线；JSON formatter 接收的 meta 已不包含 BigInt、循环引用或自定义 `toJSON`。

为避免 `SensitiveMasker.mask()` 先把 Date/Error 变空对象，MetaSerializer 在单次遍历中通过 MaskingPolicy 的新增内部字段级方法应用规则。现有 `mask(obj)` 仍保留并复用同一规范化核心，以维持内部测试接口和独立策略行为。

替代方案：给所有 `JSON.stringify` 增加 replacer。replacer 会在自定义 `toJSON` 之后执行，无法可靠防止 toJSON 抛错，也难以安全读取 Error 非枚举字段，因此不采用。

### Decision 2: 使用当前路径 Set 而非全局 seen Set 检测循环

遍历复合值前将对象加入当前路径 Set，处理完成后在 `finally` 中删除。若遇到已存在于当前路径的对象，输出 `[Circular]`。这样只有回到祖先才被视为循环；两个同级属性共享同一子对象时会分别生成完整快照。

路径 Set 使用对象 identity，深度从根值 0 开始；当 `depth > 5` 且当前值为复合值时输出 `[MAX_DEPTH_EXCEEDED]`。原始值即使出现在边界外仍可直接表示，避免无必要丢失。

替代方案：全局 WeakSet。它实现简单，但会将 DAG 中的共享引用误标记为循环，违反规范。

### Decision 3: 在读取值前按字段名解析脱敏规则

MaskingPolicy 增加内部 `maskField(field, value)` 能力，返回是否匹配和 mask 结果。对象属性流程为：安全读取属性 → 若字段命中则立即输出 mask → 否则递归规范化。命中字段不再遍历 Error、Date 或循环值，因此不会从特殊值泄露诊断内容。

getter 抛错时没有可读取原值，直接输出 `[Property Access Error]`。该占位符不携带错误 message；即使字段敏感，也不存在被降级泄露的原值。

替代方案：先完整规范化再脱敏。这会让未捕获的规范化失败有机会暴露敏感内容，也会对命中字段执行无意义的深层遍历，因此不采用。

### Decision 4: 忽略 toJSON 并只复制可枚举字符串自有属性

普通对象通过 `Object.keys` 获取 key，并逐个在 try/catch 中读取；不会调用 `JSON.stringify` 原对象，也不会主动调用 `toJSON`。如果 key 为 `toJSON` 且值为 function，它只会按 `[Function: toJSON]` 规范化到无 prototype 的新对象，因此最终 stringify 不会执行它。

若 `Object.keys` 本身因 Proxy trap 等原因抛错，整个值降级为 `[Unserializable]`；单个 getter 抛错只降级该属性。两个占位符都不拼接错误消息，避免诊断路径泄密。

替代方案：通过 property descriptor 跳过所有 accessor。这会让正常 getter 与普通 JSON 行为差异过大，也无法处理 Proxy get trap；按属性局部 try/catch 更符合兼容目标。

### Decision 5: Error 使用显式字段加安全自有属性

Error 分支不依赖枚举性，先安全读取 `name`、`message`、`stack` 和 `cause`；name/message 总是输出字符串，stack/cause 仅在存在时输出。然后遍历其他可枚举字符串自有属性，跳过已处理的标准字段并应用相同脱敏/规范化规则。

cause 参与当前路径循环检测，因此 `error.cause = error` 会稳定输出 `[Circular]`。若标准字段 getter 被恶意覆盖并抛错，对应字段使用 `[Property Access Error]`，整体日志仍可用。

替代方案：只保留 message/stack。它继续丢失异常类型、因果链和常用 code/details，不足以支持故障诊断。

### Decision 6: 特殊值使用字符串而不是 tagged object

BigInt、非有限 number、undefined、symbol、function 和无效 Date 使用规范中固定的字符串表示。这能保持所有输出可被标准 JSON 解析，也避免为每个值引入额外对象层级。

BigInt 仅输出十进制数字字符串，不加 `n`，便于日志查询；symbol 使用原生 `String(value)`；function 仅输出名称而不输出源码。函数名或 symbol description 位于敏感字段时，字段脱敏优先，原表示不会生成。

替代方案：`{ type, value }` tagged object。类型信息更明确，但会显著放大日志、改变数组/属性形状，兼容成本更高，因此不采用。

### Decision 7: safeStringify 只处理内部快照并保留最后兜底

`safeStringify` 主要接收已经规范化的值，正常使用原生 JSON.stringify。若仍遇到意外异常，它返回 JSON 字符串形式的 `"[Unserializable]"`，保证 formatter 不抛错。它不吞掉 LoggerFactory 之外的业务错误，只覆盖日志格式化边界。

plain `createFormat` 和 `PatternFormatter` 都改用该函数。JSON formatter 无需自定义 Winston serializer，因为 wrapper 已提供安全快照；集成测试负责验证最终输出。

替代方案：仅在 plain formatter catch JSON.stringify。JSON 模式和备用 formatter 仍可能失败，且无法提供一致的 meta 结构，因此不采用。

### 模块、功能与依赖关系

| 模块 | 功能 | 依赖关系 |
| --- | --- | --- |
| `MetaSerializer` | 单次有界遍历、特殊值规范化、Error 展开、循环/失败降级和安全 stringify | MaskingPolicy；无第三方依赖 |
| `SensitiveMasker` | 编译字段规则并提供对象级与字段级脱敏能力 | 默认敏感规则、MetaSerializer 的遍历契约 |
| `LoggerFactory` | wrapper 调用规范化器，将安全快照交给 plain/JSON formatter | MetaSerializer、MaskingPolicy、Winston |
| `PatternFormatter` | 对 formatter 自身收集的 meta 使用 safeStringify | MetaSerializer、LogPosition |
| `MetaSerializer` 单元测试 | 验证值矩阵、对象不变性、循环/共享引用、getter/toJSON 和脱敏组合 | Jest、MetaSerializer |
| LoggerFactory 集成测试 | 验证四级日志以及 plain/JSON 最终输出一致性 | Jest、YAML 配置、LoggerFactory |
| README/demo | 说明支持值、稳定占位符、Error 结构及迁移影响 | 已实现的 Logger API |

### 内部 API 与参数

| API/参数 | 类型 | 必填 | 默认值 | 行为 |
| --- | --- | ---: | --- | --- |
| `normalizeMeta(value, policy)` | `unknown, MaskingPolicy` | 是 | 无 | 返回 JSON-compatible 深拷贝快照，不修改输入 |
| `value` | `unknown` | 是 | 无 | 支持任意 JavaScript meta 值 |
| `policy` | `MaskingPolicy` | 是 | 无 | 字段匹配时优先输出 mask；禁用时只规范化 |
| `safeStringify(value)` | `unknown` | 是 | 无 | 输出合法 JSON 文本，意外失败时输出 `"[Unserializable]"` |
| `MaskingPolicy.maskField(field, value)` | `string, unknown` | 是 | 无 | 返回字段是否命中及安全 mask，不作为公共包 API 导出 |

不涉及 HTTP/REST API、数据库模型、Entity 字段、索引或迁移。

### 测试矩阵

| 模块 | 成功分支 | 失败/边界分支 |
| --- | --- | --- |
| 普通值 | primitive、普通对象、数组、共享引用、输入不变 | 空对象、稀疏数组、深度边界 |
| 特殊值 | BigInt、NaN、±Infinity、undefined、symbol、命名/匿名函数、有效 Date | 无效 Date、顶层与嵌套位置一致性 |
| Error | 顶层/嵌套 Error、stack、cause、code/details、自定义敏感字段 | cause 循环、标准字段读取失败、嵌套深度超限 |
| 对象安全 | 普通 getter、toJSON 作为普通属性 | getter 抛错、ownKeys 抛错 Proxy、toJSON 抛错但不执行 |
| 脱敏 | 普通字段、Error 自定义字段、数组内对象、BigInt/Date/Error 敏感值 | 循环结构、禁用策略、大小写不匹配 |
| 输出集成 | plain `%{meta}`、JSON `meta`、四个日志级别 | 混合不安全 meta 不抛错、两种格式结构一致、备用 PatternFormatter |

## Risks / Trade-offs

- [特殊值从丢失/null/空对象变为字符串，可能影响下游 schema] → README 列出精确表示，prerelease 对比采集结果并为新字段类型调整解析规则。
- [有界遍历增加每条对象日志开销] → 限制最大深度为 5、只访问可枚举字符串自有属性，并在敏感字段命中后立即停止子树遍历。
- [读取普通 getter 可能产生副作用] → 与常规属性读取/JSON 行为保持接近，单属性 try/catch 隔离失败；明确不调用自定义 toJSON。
- [字符串占位符可能与业务真实字符串重名] → 采用带方括号的固定保留值并在文档中声明；不引入更破坏兼容性的 tagged object。
- [Error stack 增加日志体积] → 保持现有顶层 Error 已输出 stack 的行为，只将一致语义扩展到嵌套 Error。

## Migration Plan

1. 新增 MetaSerializer 和值矩阵单元测试，先覆盖普通值、特殊值、Error、循环、深度和属性失败。
2. 为 MaskingPolicy 增加内部字段级能力，并让对象级 mask 复用统一遍历；运行既有安全配置与脱敏回归。
3. 将 LoggerFactory wrapper 接入规范化器，替换 plain formatter 的直接 stringify。
4. 将 PatternFormatter 接入 safeStringify，并增加独立 formatter 测试。
5. 增加 plain/JSON YAML 端到端测试与四级日志无抛错测试，运行完整 logger test/build/lint。
6. 更新 README/demo，发布 prerelease，对比日志解析失败率、事件丢弃、平均日志大小及敏感字段扫描结果。
7. 若出现不兼容，回滚 logger 包版本；应用侧可临时预处理特殊字段，但不得关闭脱敏。
