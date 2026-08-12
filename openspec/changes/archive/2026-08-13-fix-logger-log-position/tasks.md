## 1. 帧模型与测试基础

- [x] 1.1 在 `LogPosition.ts` 定义统一内部 StackFrame、`unknown:0:0` fallback 和安全整数规范化 helper（后续依赖：2.x、3.x）
- [x] 1.2 重构 `LogPosition.test.ts` 的表驱动测试 helper，使其可注入合成帧、cwd 和 parser 失败（依赖：1.1）
- [x] 1.3 增加 `path:line:column`、缺失/非法行列归零和真实调用栈格式测试（依赖：1.2）

## 2. 外部调用帧选择

- [x] 2.1 实现基于明确文件身份的 logger src/dist 内部帧过滤，并覆盖 LoggerFactory、LogPosition 与 PatternFormatter（依赖：1.1）
- [x] 2.2 实现 Node internal、Winston 和 stacktrace-parser 基础设施帧过滤，不再全局排除 `node_modules`（依赖：2.1）
- [x] 2.3 移除裸 `debug/info/warn/error` 方法名过滤，仅保留可由明确文件身份佐证的内部判断（依赖：2.1）
- [x] 2.4 实现按 parser 顺序选择首个具有安全文件名的外部帧，删除“最后一帧”fallback（依赖：2.1、2.2）
- [x] 2.5 增加内部帧后业务帧、第三方依赖帧、业务同名方法、缺失文件和全内部栈测试（依赖：2.2、2.3、2.4）

## 3. 跨平台安全路径

- [x] 3.1 实现 POSIX/Windows 路径统一为 `/` 分隔符，并按完整 segment 判断 cwd containment（依赖：1.1）
- [x] 3.2 实现捕获时动态读取 cwd，项目内输出相对路径、项目外仅输出 basename（依赖：3.1）
- [x] 3.3 实现 `file://` URL 解码与规范化，解码失败或不支持协议时拒绝选择原始路径（依赖：3.1）
- [x] 3.4 增加 POSIX、Windows 盘符/大小写、路径前缀碰撞、cwd 切换、项目外路径和 file URL 参数化测试（依赖：3.1、3.2、3.3）
- [x] 3.5 增加绝对目录、盘符、用户主目录与 file URL 前缀不泄露断言（依赖：3.4）

## 4. 安全捕获适配层

- [x] 4.1 重写 `capture()`，在局部边界内完成 Error 创建、stack 读取、parser 映射、帧选择和渲染（依赖：2.4、3.3）
- [x] 4.2 移除对 `Error.stackTraceLimit` 的读取和写入，捕获过程不修改任何进程级状态（依赖：4.1）
- [x] 4.3 对空 stack、空帧、parser/cwd/路径异常统一返回 `unknown:0:0` 且不传播异常（依赖：4.1）
- [x] 4.4 增加连续捕获、parser 抛错、空结果、仅内部帧及 `Error.stackTraceLimit` 保持不变测试（依赖：4.2、4.3）

## 5. Formatter 按需集成

- [x] 5.1 定义内部 log-position Symbol，并在 LoggerFactory 根据启用的 plain/file transport 预计算是否需要位置（依赖：4.3）
- [x] 5.2 在四个 Logger wrapper 方法的业务调用边界按需捕获一次，并通过 Symbol metadata 传入 Winston（依赖：5.1）
- [x] 5.3 让 LoggerFactory plain/file formatter 读取预捕获 Symbol 并替换全部同名占位符，缺失时使用 `unknown:0:0`（依赖：5.2）
- [x] 5.4 让 PatternFormatter 优先复用预捕获 Symbol，独立使用且需要位置时仅执行一次安全 fallback（依赖：5.1）
- [x] 5.5 增加 LoggerFactory plain pattern 的单个/重复位置占位符和最终 `path:line:column` 输出测试（依赖：5.3）
- [x] 5.6 增加 plain 无占位符与仅 JSON 模式零捕获测试，并验证 mixed JSON/plain transport 的 Symbol 不进入 JSON（依赖：5.2、5.3）
- [x] 5.7 扩展 PatternFormatter 测试，覆盖预捕获复用、独立 fallback 单次捕获、无占位符零捕获和 fallback 替换（依赖：5.4）

## 6. 集成、性能与兼容验证

- [x] 6.1 增加从业务 helper 经 LoggerFactory 输出的 plain YAML 集成测试，验证位置指向业务调用文件而非 logger/Winston 内部（依赖：5.5）
- [x] 6.2 增加编译后 dist 路径或等价合成帧测试，验证 src/dist 内部帧均被过滤（依赖：2.5、5.5）
- [x] 6.3 增加含/不含位置 placeholder 的重复执行检查，确认 wrapper 无需求分支不产生 stack 捕获开销（依赖：5.6、5.7）
- [x] 6.4 运行 logger 完整测试并启用 open-handle 检查，确认配置、生命周期、meta 序列化和格式行为无回归（依赖：6.1、6.2、6.3）

## 7. 文档与发布准备

- [x] 7.1 更新 README 的 `%{log_position}` 格式为 `relative/path:line:column`，说明 `unknown:0:0`、项目外 basename 与按需捕获（依赖：6.4）
- [x] 7.2 更新 `src/demo.ts` 与 `examples/demo.ts`，展示包含位置的 pattern 和跨两段/三段采集兼容提示（依赖：7.1）
- [x] 7.3 记录 prerelease 对比项：业务帧命中率、unknown 比例、绝对路径泄露、解析失败率和平均日志耗时（依赖：7.1）
- [x] 7.4 运行 logger build、lint、Prettier、README/demo TypeScript 示例编译和严格 OpenSpec 校验（依赖：7.2、7.3）
- [x] 7.5 确认未新增公共配置、运行时依赖、数据库迁移或权限变更，并记录直接版本回滚与临时移除 placeholder 方案（依赖：7.4）
