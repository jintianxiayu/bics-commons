## 1. 类型定义扩展

- [x] 1.1 在 `src/core/http-client-config.ts` 中新增 `TracingOptions` 和 `DebugOptions` 接口定义
- [x] 1.2 在 `HttpClientConfig` 接口中新增 `tracing` 和 `debug` 可选字段

## 2. Tracing Middleware 实现

- [x] 2.1 创建 `src/middlewares/tracing.ts`，实现 `createTracingMiddleware(options: TracingOptions): Middleware` 工厂函数
- [x] 2.2 编写 tracing middleware 单元测试，覆盖：默认 provider、自定义 provider、provider 返回 undefined、自定义 headerName

## 3. Debug Middleware 实现

- [x] 3.1 创建 `src/middlewares/debug.ts`，实现 `createDebugMiddleware(options: DebugOptions): Middleware` 工厂函数
- [x] 3.2 移除 `src/core/http-client.ts` 中现有的 `logger.debug()` 调用，HTTP 日志输出统一由 debug middleware 负责
- [x] 3.3 编写 debug middleware 单元测试，覆盖：完整输出、logBody=false、logHeaders=false、自定义 logger、请求失败场景、duration 计算、未开启时零输出

## 4. Proxy Factory 集成

- [x] 4.1 修改 `src/core/proxy-factory.ts`，在组装中间件链时根据 config 的 `tracing` 和 `debug` 字段创建并插入内置 middleware（顺序：tracing → debug → user middlewares）
- [x] 4.2 处理 `boolean | Options` 简写的规范化逻辑（`true` 转为 `{}`）

## 5. 导出与集成测试

- [x] 5.1 在 `src/index.ts` 中导出 `TracingOptions`、`DebugOptions` 类型和 `createTracingMiddleware`、`createDebugMiddleware` 工厂函数
- [x] 5.2 编写集成测试：tracing + debug 同时启用时 debug 输出包含已注入的 traceId header
- [x] 5.3 编写集成测试：内置 middleware + 用户自定义 middleware 的执行顺序验证

## 6. 文档更新

- [x] 6.1 更新 `packages/http-client-decorator/README.md`，添加 `tracing` 和 `debug` 配置说明和使用示例
