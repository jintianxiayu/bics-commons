## Why

依赖方目前需要为 dev、qa、prod 等环境维护多份几乎相同的 Logger 配置文件，才能让同一个命名 Logger 使用不同级别。这会造成配置重复，也把稳定的环境级别策略分散到部署文件中，不利于审查和维护。

## What Changes

- 在单份 Logger 配置中新增可选的命名 Logger 级别 Profile，使不同 Profile 只声明需要覆盖的 `loggers.<name>.level`。
- 新增 `LOGGER_PROFILE` 环境变量，在初始化时选择并应用一个 Profile；未设置时继续使用现有基础配置。
- 明确基础配置、Profile 覆盖、校验和冻结的顺序，以及空名称、未知 Profile、非法 Logger 名称和非法级别的失败语义。
- Profile 仅影响日志级别，不允许改变 Console、File、调用位置、脱敏或进程错误处理配置，也不支持运行时热更新。
- 更新 Logger 文档、设计说明和测试，并为 `@jintianxiayu/logger` 添加 minor changeset。

## Capabilities

### New Capabilities

- `logger-level-profiles`: 定义单份配置中的命名 Logger 级别 Profile、`LOGGER_PROFILE` 选择规则、合并优先级和初始化失败行为。

### Modified Capabilities

无。

## Impact

- 受影响包：`@jintianxiayu/logger`，当前版本为 `1.0.1`；本次新增向后兼容能力，按 minor 发布，预期版本为 `1.1.0`。
- 公共契约变更：是。`LoggerConfig` 将增加可选的 Profile 配置类型，YAML 顶层结构将接受新的可选字段，并新增 `LOGGER_PROFILE` 环境变量语义。
- 兼容性结论：向后兼容。未配置 Profile 且未设置 `LOGGER_PROFILE` 时，现有对象配置、YAML 配置、`LOGGER_CONFIG_PATH` 来源优先级、默认值、错误语义、日志格式及命名 Logger 继承行为保持不变；旧配置无需迁移。
- Profile 是启动期配置层，不改变日志格式和字段，不涉及 Redis、HTTP、锁协议、存量数据或跨版本持久化数据处理。
- 不新增或调整第三方依赖，不改变其他子包的 peerDependency。
