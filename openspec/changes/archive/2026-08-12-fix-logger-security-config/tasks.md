## 1. 配置类型与默认值基础

- [x] 1.1 定义原始兼容配置和内部有效配置所需类型，保持现有公开 Logger API 不变（后续任务依赖：2.x、3.x、4.x）
- [x] 1.2 将默认敏感字段和默认 logger 配置调整为不可被调用方浅层修改污染的返回值（依赖：1.1）
- [x] 1.3 为默认配置的深层隔离增加单元测试，覆盖 console、file 和敏感字段数组的修改场景（依赖：1.2）

## 2. 配置校验与错误模型

- [x] 2.1 实现统一 `ConfigError` 构造和配置路径格式，支持对象字段及数组下标（依赖：1.1）
- [x] 2.2 实现顶层、root 与命名 logger 的对象结构和未知字段校验（依赖：2.1）
- [x] 2.3 实现 level、pattern、console 与 file 字段的类型和值域校验（依赖：2.2）
- [x] 2.4 实现 `sensitiveMasking` 的 enabled、fields、field、mask 及同层重复字段校验（依赖：2.2）
- [x] 2.5 增加配置校验参数化测试，覆盖 root/命名 logger 的合法配置、非法 level、错误类型、未知字段和准确错误路径（依赖：2.3、2.4）
- [x] 2.6 增加敏感配置失败测试，覆盖空 field/mask、非数组 fields、重复字段及数组下标路径（依赖：2.4）

## 3. 配置别名、来源与原子加载

- [x] 3.1 实现 root 和命名 logger 层的 `sensitive-masking` 别名识别、冲突检查及 camelCase 规范化（依赖：2.4）
- [x] 3.2 增加推荐键、历史键和双键冲突的 ConfigLoader 单元测试（依赖：3.1）
- [x] 3.3 区分默认 `./logger.yaml`、环境变量显式路径和 `load(configPath)` 显式参数的配置来源（依赖：2.1）
- [x] 3.4 实现缺省文件安静使用默认配置、显式文件缺失抛错以及失败时不更新缓存的原子加载（依赖：3.3、2.3、2.4）
- [x] 3.5 增加默认文件缺失、环境路径缺失、显式参数缺失及加载失败后缓存不变的测试（依赖：3.4）
- [x] 3.6 增加 LoggerFactory 严格初始化抛错与懒加载完整降级测试，确认无效配置字段不进入降级结果（依赖：3.4）

## 4. 敏感规则合并与实例级策略

- [x] 4.1 实现按 field 稳定覆盖/追加的敏感规则合并函数，支持内置、root、命名 logger 三层输入（依赖：1.2、3.1）
- [x] 4.2 增加规则合并单元测试，覆盖默认保留、root 覆盖/追加、命名覆盖/追加和空 fields（依赖：4.1）
- [x] 4.3 将 SensitiveMasker 重构为无全局可变状态的 `MaskingPolicy` 创建器，并保留现有模板和递归脱敏行为（依赖：1.1、4.1）
- [x] 4.4 迁移 SensitiveMasker 现有测试到实例级策略 API，覆盖 enabled、大小写精确匹配、模板、嵌套和边界分支（依赖：4.3）
- [x] 4.5 增加多策略隔离测试，覆盖不同 mask、一个策略禁用和反转创建顺序（依赖：4.3）

## 5. LoggerFactory 集成

- [x] 5.1 让 ConfigLoader 为 root 和命名 logger 生成包含最终敏感规则的有效配置（依赖：3.4、4.1）
- [x] 5.2 在 LoggerFactory 创建 wrapper 时编译并闭包持有对应的 MaskingPolicy，移除日志热路径对全局 SensitiveMasker 的依赖（依赖：4.3、5.1）
- [x] 5.3 增加双命名 logger 输出测试，验证各自 mask、enabled 和首次获取顺序不会互相污染（依赖：5.2）
- [x] 5.4 实现 console 与 file 均禁用时的缓存 no-op wrapper，跳过 Winston logger、脱敏和格式化创建（依赖：5.1）
- [x] 5.5 增加 no-op logger 测试，覆盖四个日志级别、无输出、无 Winston warning、无异常及同名缓存（依赖：5.4）

## 6. 端到端安全配置验证

- [x] 6.1 增加推荐 `sensitiveMasking` YAML 的 plain 输出集成测试，覆盖默认规则、覆盖规则和新增规则（依赖：5.2）
- [x] 6.2 增加历史 `sensitive-masking` YAML 的等价输出集成测试，并验证冲突配置在严格模式失败（依赖：5.2）
- [x] 6.3 增加命名 logger YAML 集成测试，覆盖继承、覆盖、空 fields、单 logger 禁用和策略隔离（依赖：5.3）
- [x] 6.4 增加 JSON console 格式回归测试，确认敏感配置接入后仍输出合法 JSON 且 traceId 行为不变（依赖：5.2）
- [x] 6.5 运行 logger 包完整测试、构建和 lint，并确认新增配置场景不引入测试残留文件（依赖：6.1、6.2、6.3、6.4、5.5）

## 7. 文档与发布准备

- [x] 7.1 更新 README 配置 schema，说明推荐 camelCase 键、历史别名兼容周期、规则三层合并和 `enabled: false` 行为（依赖：6.5）
- [x] 7.2 修正 README 与 demo 中 `auth`、`cardNumber`、`cvv` 等未列入默认规则却声称自动脱敏的示例（依赖：6.5）
- [x] 7.3 更新 README 的配置文件缺失、严格初始化、懒加载降级及全部 transport 关闭行为（依赖：6.5）
- [x] 7.4 编译校验 README 中本变更涉及的 YAML 与 TypeScript 示例，并记录 prerelease 验证和版本回滚说明（依赖：7.1、7.2、7.3）
