## Why

`@HttpClient()` 装饰器当前缺少对 traceId 注入和请求调试输出的内置支持。用户每次需要这些常见能力时，必须手动编写重复的中间件代码。通过将 `tracing` 和 `debug` 提升为一级配置字段，可以将这些常见模式简化为声明式的一行配置。

## What Changes

- 在 `HttpClientConfig` 接口新增 `tracing` 字段，支持自动注入 traceId 到请求头
- 在 `HttpClientConfig` 接口新增 `debug` 字段，支持输出完整的请求/响应详情
- 新增 `TracingOptions` 和 `DebugOptions` 接口定义
- 内部将配置选项翻译为 middleware，插入到用户中间件之前执行
- 新增内置 `tracingMiddleware` 和 `debugMiddleware` 工厂函数（可独立导出复用）

## Capabilities

### New Capabilities

- `tracing-header`: 自动从 LoggerContext（或自定义 provider）读取 traceId 并注入到请求头
- `debug-logging`: 开启 debug 模式时输出完整的请求 URL、headers、body 及响应详情（含耗时）

### Modified Capabilities

（无）

## Impact

**影响模块和文件范围：**
- `packages/http-client-decorator/src/core/http-client-config.ts` — 扩展 Config 接口
- `packages/http-client-decorator/src/core/proxy-factory.ts` — 组装内置 middleware 到执行链
- `packages/http-client-decorator/src/index.ts` — 导出新类型和内置中间件工厂
- 新增文件：`packages/http-client-decorator/src/middlewares/tracing.ts`
- 新增文件：`packages/http-client-decorator/src/middlewares/debug.ts`

**依赖：**
- 依赖 `@jintianxiayu/logger` 的 `LoggerContext`（已有依赖关系）和 `LoggerFactory`
- 无新增第三方 npm 包

**API 兼容性：**
- 完全向后兼容，新增字段均为可选，现有用法无需修改

**性能影响：**
- tracing middleware：一次 Map.get() 调用 + 条件性 header 写入，开销可忽略
- debug middleware：仅在开启时产生日志序列化开销，不影响未启用 debug 的客户端

**回滚计划：**
- 配置字段为可选，移除后不影响任何现有功能
- 内置 middleware 与用户 middleware 解耦，可独立移除
