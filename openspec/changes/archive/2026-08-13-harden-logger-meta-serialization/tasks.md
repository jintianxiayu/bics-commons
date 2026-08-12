## 1. MetaSerializer 类型与测试基础

- [x] 1.1 新建内部 `MetaSerializer.ts`，定义 JSON-safe 值类型、最大深度和固定占位符常量（后续依赖：2.x、3.x、4.x）
- [x] 1.2 新建 MetaSerializer 单元测试文件和表驱动 helper，支持断言顶层/嵌套结果、输入不变性及安全 stringify（依赖：1.1）
- [x] 1.3 为普通 primitive、数组、嵌套对象和空对象增加结构保持测试（依赖：1.2；后续依赖：2.1）
- [x] 1.4 增加共享子对象测试，验证同级重复引用均完整输出且不误标 `[Circular]`（依赖：1.2；后续依赖：3.1）

## 2. 特殊值与 Date 规范化

- [x] 2.1 实现 null、boolean、有限 number 与 string 的原值返回，并创建普通对象/数组的无副作用快照（依赖：1.1）
- [x] 2.2 实现 BigInt、NaN、正负 Infinity、undefined、symbol 和命名/匿名 function 的稳定字符串映射（依赖：2.1）
- [x] 2.3 实现有效 Date 的 ISO 8601 表示与无效 Date 的 `[Invalid Date]` 降级（依赖：2.1）
- [x] 2.4 增加特殊值在顶层 meta 参数、对象属性和数组元素中的参数化测试，覆盖数组长度与位置保持（依赖：2.2）
- [x] 2.5 增加有效/无效 Date 以及输入对象未被修改的测试（依赖：2.3）

## 3. 循环、深度与不可信属性

- [x] 3.1 使用当前遍历路径 Set 实现直接/间接循环检测，并在 `finally` 中移除已完成节点（依赖：2.1）
- [x] 3.2 实现最大深度 5 的复合值截断，同时允许边界外原始值直接表示（依赖：3.1）
- [x] 3.3 使用 `Object.keys` 和单属性 try/catch 实现可枚举字符串自有属性读取，getter 失败时输出 `[Property Access Error]`（依赖：2.1）
- [x] 3.4 捕获对象枚举失败并输出 `[Unserializable]`，确保占位符不拼接异常消息（依赖：3.3）
- [x] 3.5 确保自定义 `toJSON` 不被调用，并将可枚举 toJSON function 仅作为普通字段规范化（依赖：3.3）
- [x] 3.6 增加直接循环、数组/对象间接循环、共享引用、深度边界与超限测试（依赖：3.1、3.2）
- [x] 3.7 增加正常 getter、抛错 getter、ownKeys 抛错 Proxy、toJSON 抛错/副作用和敏感错误消息不泄露测试（依赖：3.3、3.4、3.5）

## 4. Error 诊断信息规范化

- [x] 4.1 实现 Error 的 name、message、可用 stack 与递归 cause 读取，并让标准字段读取失败局部降级（依赖：2.1、3.3）
- [x] 4.2 合并 Error 的其他可枚举字符串自有属性，跳过已处理标准字段并复用统一规范化逻辑（依赖：4.1）
- [x] 4.3 增加顶层/嵌套 Error、cause 链、code/details、自定义特殊值字段和输入不变性测试（依赖：4.1、4.2）
- [x] 4.4 增加 Error cause 自循环、嵌套深度超限及标准字段读取失败测试（依赖：3.1、3.2、4.1）

## 5. 脱敏策略协作

- [x] 5.1 为 MaskingPolicy 增加内部字段级匹配/脱敏能力，保持现有 enabled 与精确大小写语义（依赖：1.1）
- [x] 5.2 在 MetaSerializer 安全读取属性后优先调用字段级脱敏，命中时跳过特殊值与子树遍历（依赖：3.3、5.1）
- [x] 5.3 让现有对象级 `mask()` 复用统一有界规范化遍历，移除 Date/Error 变空对象和循环语义分叉（依赖：3.x、4.x、5.2）
- [x] 5.4 迁移并扩展 SensitiveMasker 回归测试，覆盖普通字段、数组、Error 自定义字段、BigInt/Date/Error 敏感值和循环结构（依赖：5.2、5.3）
- [x] 5.5 增加禁用策略与大小写不匹配测试，验证仍安全规范化但不替换普通字段值（依赖：5.3）

## 6. Formatter 与 LoggerFactory 集成

- [x] 6.1 实现 `safeStringify()`，对 JSON-safe 快照输出合法 JSON，并在意外失败时返回 `"[Unserializable]"` 的 JSON 文本（依赖：2.x、3.x、4.x）
- [x] 6.2 将 LoggerFactory wrapper 的四个日志方法接入 MetaSerializer，移除顶层 Error 特判与先脱敏后不安全序列化路径（依赖：5.3、6.1）
- [x] 6.3 将 plain `createFormat` 的 `%{meta}` 替换为 `safeStringify`，保持普通 meta 输出格式不变（依赖：6.1、6.2）
- [x] 6.4 将 `PatternFormatter` 的 meta resolver 接入 `safeStringify`，补充 formatter 独立测试（依赖：6.1）
- [x] 6.5 增加 JSON 模式回归测试，验证安全快照位于 `meta` 字段且 traceId、level、message 行为不变（依赖：6.2）

## 7. 跨格式与端到端验证

- [x] 7.1 增加 plain YAML 输出集成测试，覆盖 BigInt、Date、嵌套 Error、循环引用、失败 getter及合法 `%{meta}` JSON 文本（依赖：6.3）
- [x] 7.2 增加相同输入的 JSON YAML 输出集成测试，并比较 plain 解析结果与 JSON `meta` 结构一致（依赖：6.5、7.1）
- [x] 7.3 增加 debug/info/warn/error 四级日志混合不安全 meta 测试，验证调用均不抛错且实际输出合法（依赖：7.1、7.2）
- [x] 7.4 增加敏感字段与特殊值/循环/错误属性组合的端到端泄露断言（依赖：5.4、7.1、7.2）
- [x] 7.5 运行 logger 完整测试并启用 open-handle 检查，确认安全序列化未回归配置、脱敏、生命周期与格式行为（依赖：7.3、7.4）

## 8. 文档、性能与发布准备

- [x] 8.1 更新 README 的 meta 支持矩阵，记录 BigInt、非有限数、Date、Error 和不可表示值的精确输出（依赖：7.5）
- [x] 8.2 更新 README/demo，说明 `[Circular]`、`[MAX_DEPTH_EXCEEDED]`、属性失败占位符、toJSON 行为和脱敏优先级（依赖：7.5）
- [x] 8.3 增加普通 meta 与最大深度混合 meta 的轻量基准或重复执行检查，记录有界 O(n) 遍历的可接受开销（依赖：7.5）
- [x] 8.4 运行 logger build、lint 与 README/demo TypeScript 示例编译，确认公开 API 和依赖清单未变化（依赖：8.1、8.2、8.3）
- [x] 8.5 记录 prerelease 对比项：日志解析失败率、事件丢弃、平均体积、特殊值字段类型与敏感值扫描，并注明版本回滚方案（依赖：8.4）
