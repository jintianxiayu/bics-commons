## 1. 路径行为测试

- [x] 1.1 为路径格式化增加表驱动单元测试，覆盖 Windows/POSIX 项目相对路径、`file://` 与空格/非 ASCII、scoped/unscoped 依赖、pnpm/嵌套 `node_modules` 选择最后边界及 `node_modules-mock` 非边界，并通过对应 Jest 用例验证规格中的路径规范化场景
- [x] 1.2 增加 120 字符以内、恰好 120、超过 120 的“前三段 + `...` + 后两段”、五段以内超长名称不截断、碰撞不加哈希和项目外路径回退用例，并通过对应 Jest 用例验证规格中的压缩与回退场景
- [x] 1.3 增加运行时初始化目录固定、首个有效帧与 `file:line` 保持、无有效帧降级为 `-` 的聚焦测试，并通过 Logger 单元或集成测试验证 `process.chdir()`、列号丢弃和日志继续写入场景

## 2. 调用位置实现

- [x] 2.1 在 `LogPosition.ts` 中实现纯路径规范化与按段压缩，将捕获结果统一为规范化 `path:line`，并通过任务 1.1、1.2 的测试验证所有路径组合
- [x] 2.2 在 `LoggerFactoryRuntime` 首次成功初始化时固定项目目录并传给调用位置捕获，保持失败初始化、延迟初始化、栈帧过滤和采集失败语义不变，并通过任务 1.3 的测试验证

## 3. 文档与发布记录

- [x] 3.1 更新 logger README 与 DESIGN，说明相对路径、依赖路径、120 字符软阈值、`...` 压缩、允许碰撞和回退行为，并人工核对文档示例与规格一致
- [x] 3.2 为 `@jintianxiayu/logger@1.0.0` 创建 patch changeset，基于实际代码说明 `logPosition` 路径表现变化，并通过 `pnpm run release:status` 验证版本计划

## 4. 验证

- [x] 4.1 运行 logger 的 format:check、lint、typecheck、build 和完整 Jest 测试，确认 TypeScript 规范、输出契约及所有新增场景通过
- [x] 4.2 运行 workspace 全量测试与 `openspec validate shorten-logger-log-position-path --strict`，确认下游子包兼容且 OpenSpec 变更严格校验通过
