## Context

动机见 proposal.md。当前 `ConfigLoader.load(source?)` 选择显式对象或路径、LOGGER_CONFIG_PATH 或默认配置；`parseDocument` 验证已知字段，命名 Logger 深度继承 root 并冻结结果。`LoggerFactoryRuntime.init` 在配置解析成功后创建脱敏器与 Winston Runtime，首次成功后保持幂等。`NamedLogger` 持有稳定的 EffectiveLoggerProfile，传输层也按这些对象预编译格式，因此覆盖应在配置加载阶段完成。

本次新增公共类型、YAML 结构和选择语义，需要设计明确数据结构、来源与覆盖的区别以及失败边界。当前仅 logger 包需要改动，版本为 1.0.1。

## Goals / Non-Goals

**Goals:**

- 复用现有校验、继承和冻结链路，运行期直接使用最终配置。
- 用完整 logger 名称支持 orders 及带作用域的依赖包名称。
- 对象配置与 YAML 保持等价行为，错误在资源初始化前发现。

**Non-Goals:**

- 本版 Profile 仅含命名 Logger level，不覆盖 root 或其他字段；root 仍由基础配置控制。
- 不增加显式 Profile 选择参数、多 Profile 合并、环境别名、NODE_ENV 推断、通配符、环境变量插值或直接 level 环境变量覆盖。
- 不提供 setLevel、文件监听、配置中心、热更新或额外启动日志。

## Decisions

### 1. 公开窄范围配置类型

在 types/index.ts 新增并从包根以 type 导出以下两个接口；现有 LoggerConfig 增加可选字段 `profiles?: Record<string, LoggerLevelProfile>`，其余字段保留。Record 的键为 Profile 名称，值为该策略的配置；无新增泛型参数。

```ts
/** 环境策略只调整输出级别，避免意外改变输出目标和安全策略。 */
export interface LoggerLevelOverride {
    level: LogLevelName;
}

/** 一组命名日志器的级别覆盖，用于应用启动时选择环境策略。 */
export interface LoggerLevelProfile {
    /** K 为完整日志器名称，V 为必填级别的覆盖配置。 */
    loggers?: Record<string, LoggerLevelOverride>;
}
```

`LoggerFactory.init(source?: string | LoggerConfig): void` 保持原签名。新覆盖类型的 level 必填，避免 `{ orders: {} }` 拼写或配置遗漏被误认为有效调整；空 Profile 则允许显式表达 prod 沿用基础配置。运行时仍严格拒绝未知字段，不能仅依赖 TypeScript 对象字面量的多余属性检查。

相较复用 LoggerOptions，此结构将范围固定为 level，防止一次环境切换改变文件路径、脱敏或进程处理器。相较字符串映射，保留 `loggers.<name>.level` 的现有阅读习惯。

### 2. 单文件与显式环境选择器

```yaml
root:
    level: info
loggers:
    orders:
        console:
            enabled: true
profiles:
    dev:
        loggers:
            orders:
                level: debug
    qa:
        loggers:
            orders:
                level: debug
    prod:
        loggers:
            orders:
                level: info
```

部署设置 LOGGER_CONFIG_PATH 指向同一文件，LOGGER_PROFILE 分别为 dev、qa、prod。Profile 名称区分大小写，必须非空且已修剪；选择器存在但为空也报错，undefined 才表示不启用。保留 dev/qa 两个简单差异块，不引入继承或组合语言。

选择器适用于显式对象和显式路径：它选择的是该对象或文件自己声明的策略，并不引入另一个配置来源。文档须分别说明“来源选择”和“文档内策略覆盖”，避免把显式来源优先误读成禁用 LOGGER_PROFILE。仅在启动初始化时读取环境，不自动把 production 映射成 prod。本版不新增显式选择参数，以减少公共 API 扩张。

### 3. 校验后覆盖并冻结

ConfigLoader 将三个来源统一收敛到同一个解析出口，携带本次读取的选择器。先校验基础文档与所有 Profile，再验证所选名称存在，最后生成覆盖后的完整配置；禁止用合法覆盖值掩盖基础错误。

基础命名配置先按现有方式继承 root。只对选中 Profile 的条目调用现有合并能力，基准为该名称的基础有效配置，不存在则使用 root；patch 仅含 level。返回新的映射和冻结的 EffectiveLoggerProfile，不修改输入或现有基础对象。未选中 Profile 的名称不进入 NormalizedLoggerConfig，传输工厂因此只编译真正生效的对象。

使用 Map 或自有属性检查处理外部映射，不通过原型链查询 Profile 或 logger 名称，不进行点路径展开。已有 ILogger 写入、传输及关闭路径保持不变。所有文档校验均在 createWinstonRuntime 前完成，初始化失败仍允许下一次重试，ACTIVE 状态不重新读配置。

只验证选中 Profile 可以容忍其他环境错误，但会让同一配置的问题延迟到生产部署才发现，因此选择完整验证。错误沿用 LoggerConfigError，标注字段路径或选择器，禁止附带整份文档。

### 4. 验证落点

- 在 ConfigLoader 单元测试中覆盖 P01–P03、P05–P12，用对象/YAML 两种入口验证语义。
- 在 LoggerFactory 单元测试中覆盖 P13–P15，验证幂等、失败重试、懒初始化与资源创建时序。
- 通过 Console/File 集成测试或独立进程 fixture 验证 P04 的真实 debug/info 输出过滤及 P08 的输出策略保留，进程之间隔离 LOGGER_PROFILE。
- 扩展现有 test/type-contract/contract.ts，基于构建后的包根声明验证 P16–P17，包含带 @ts-expect-error 的精确负例。
- 测试须隔离并恢复 LOGGER_PROFILE，避免开发机环境影响原有默认配置测试。

## Risks / Trade-offs

- [配置中尚未使用的 Profile 错误也会阻止启动] → 文档明确完整校验，在测试或发布检查中提前发现。
- [环境变量遗留导致选错或找不到策略] → 精确匹配并失败，不静默回退；配置示例说明清除选择器可恢复基础策略。
- [debug 增加日志量] → 默认仍为基础 info，prod 示例显式为 info，由依赖方审查部署设置。
- [依赖在应用初始化前获取 Logger] → 现有 http-client-decorator/debug.ts 在模块加载时获取 Logger，README 提醒通过进程启动环境预先配置，或在相关依赖加载前初始化；本次不调整其他包加载行为。
- [结构类型允许某些非字面量额外属性] → 编译负例约束公开用法，运行时严格验证所有字段。
- [共享 YAML 被旧包拒绝] → 先升级所有读取该文档的消费者再启用 profiles；灰度期保留旧格式配置。

## Migration Plan

1. 实现、验证并添加 logger minor changeset；基于当前 1.0.1 预计发布 1.1.0，最终版本以执行发布时的版本计划为准。其他子包无需同步功能改动。
2. 先将依赖方升级到支持 Profile 的版本，继续使用旧格式配置验证基础行为。
3. 再部署单文件 profiles 并设置 LOGGER_PROFILE。新旧包共存时，不把含 profiles 的同一文档提供给旧包。
4. 仅撤销 Profile 选择可通过清除 LOGGER_PROFILE 恢复新包的基础配置；若回滚到旧包，须同时移除 profiles 或恢复旧 YAML，并清除选择器。
5. 本提案只规划发布，不执行版本提升、npm 发布或部署。
