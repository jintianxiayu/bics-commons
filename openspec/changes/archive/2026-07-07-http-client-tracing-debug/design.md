## Context

`@jintianxiayu/http-client-decorator` 是基于装饰器的声明式 HTTP 客户端框架，使用 Koa 风格洋葱模型中间件。当前 `HttpClientConfig` 仅支持 `baseURL`、`timeout`、`headers`、`middlewares` 四个字段。

现状中，traceId 注入和 debug 输出需要用户手动编写中间件。本设计将这两个常见模式提升为 Config 的一级字段，内部翻译为 middleware 统一走洋葱模型。

已有依赖：`@jintianxiayu/logger`（`LoggerFactory` + `LoggerContext`）。

## Goals / Non-Goals

**Goals:**
- 通过 `tracing` 配置字段实现 traceId 自动注入请求头
- 通过 `debug` 配置字段实现请求/响应完整详情输出
- 保持完全向后兼容
- 内置 middleware 可独立导出供非装饰器场景复用

**Non-Goals:**
- 不引入 retry、circuit breaker 等高级中间件
- 不改变现有中间件机制和洋葱模型
- 不新增第三方依赖

## Decisions

### 1. API 设计：扁平 Config 字段 + `boolean | Options` 简写

`tracing` 和 `debug` 作为 `HttpClientConfig` 的可选字段，支持 `true`（全默认）或对象形式（自定义）。

**接口定义：**

| 接口 | 字段 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `HttpClientConfig` | `tracing` | `boolean \| TracingOptions` | `undefined` | 启用 traceId 注入 |
| `HttpClientConfig` | `debug` | `boolean \| DebugOptions` | `undefined` | 启用 debug 输出 |

| 接口 | 字段 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `TracingOptions` | `headerName` | `string` | `'x-trace-id'` | 注入的请求头名称 |
| `TracingOptions` | `provider` | `() => string \| undefined` | `LoggerContext.get('traceId')` | 自定义 traceId 来源 |

| 接口 | 字段 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `DebugOptions` | `logger` | `(message: string, meta?: unknown) => void` | 包内 `logger.debug()` | 自定义日志输出 |
| `DebugOptions` | `logBody` | `boolean` | `true` | 是否输出 body |
| `DebugOptions` | `logHeaders` | `boolean` | `true` | 是否输出 headers |

**理由：** 扁平字段比 `builtins: {}` 嵌套更直观，对于仅两个内置能力无需引入额外抽象层。

### 2. 内部实现：Config 翻译为 Middleware

配置选项在 `proxy-factory.ts` 中被翻译为 middleware，插入到用户中间件之前：

```
执行链：[tracingMiddleware] → [debugMiddleware] → [user middlewares...] → [sendRequest]
```

**理由：** 统一走洋葱模型，debug middleware 的 `next()` 前后分别记录请求和响应，可计算耗时。tracing 先于 debug 执行确保 debug 输出中已包含注入的 traceId header。

### 3. traceId provider 返回 undefined 时跳过注入

当 `provider()` 返回 `undefined`（如 AsyncLocalStorage 中无 traceId），不注入 header，静默跳过。

**理由：** 避免注入空值或占位符，保持请求干净。

### 4. Debug 默认关闭 + 输出方式

`debug` 默认不开启。未配置时不产生任何 HTTP 调试日志——包括移除现有 `http-client.ts` 中的 `logger.debug()` 调用，将所有 HTTP 日志输出统一收归到 debug middleware 中。

开启后，使用包内 `LoggerFactory.getLogger('@jintianxiayu/http-client-decorator')` 的 `debug()` 方法，以 meta 对象形式输出结构化数据：

```typescript
// 请求阶段
logger.debug('HTTP Request', { method, url, headers, body });

// 响应阶段
logger.debug('HTTP Response', { method, url, status, headers, body, duration });
```

**理由：** 复用已有日志基础设施，text 模式下 meta 通过 `%{meta}` 展开为人类可读格式，json 模式下字段自然扁平化，适合日志采集。未开启时零噪音，避免生产环境产生不必要的日志。

## 模块设计

| 模块 | 文件路径 | 功能 | 依赖 |
|------|----------|------|------|
| TracingMiddleware | `src/middlewares/tracing.ts` | 从 provider 获取 traceId 并注入请求头 | `@jintianxiayu/logger` (LoggerContext) |
| DebugMiddleware | `src/middlewares/debug.ts` | 记录请求/响应完整详情 | `@jintianxiayu/logger` (LoggerFactory) |
| HttpClientConfig | `src/core/http-client-config.ts` | 扩展接口定义 | — |
| ProxyFactory | `src/core/proxy-factory.ts` | 组装内置 middleware 到执行链 | TracingMiddleware, DebugMiddleware |

## 测试用例

### tracing 模块

| 场景 | 预期结果 |
|------|----------|
| `tracing: true`，LoggerContext 有 traceId | 请求头包含 `x-trace-id: <value>` |
| `tracing: true`，LoggerContext 无 traceId | 请求头不包含 `x-trace-id` |
| `tracing: { headerName: 'x-request-id' }` | 请求头使用自定义名称 |
| `tracing: { provider: () => 'custom-123' }` | 使用自定义 provider 返回值 |
| `tracing: { provider: () => undefined }` | 跳过注入 |
| 未配置 `tracing` | 不注入任何 tracing header |

### debug 模块

| 场景 | 预期结果 |
|------|----------|
| `debug: true`，请求成功 | 输出请求 URL/method/headers/body 和响应 status/headers/body/duration |
| `debug: true`，请求失败 | 输出请求详情和错误信息 |
| `debug: { logBody: false }` | 输出中不包含 body |
| `debug: { logHeaders: false }` | 输出中不包含 headers |
| `debug: { logger: customFn }` | 使用自定义 logger 函数 |
| 未配置 `debug` | 无额外日志输出 |

### 集成测试

| 场景 | 预期结果 |
|------|----------|
| `tracing` + `debug` 同时启用 | debug 输出的 headers 中包含已注入的 traceId |
| 内置 middleware + 用户自定义 middleware | 执行顺序正确：tracing → debug → user → send |

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| debug 模式输出敏感信息（headers 中的 token、body 中的密码） | `logBody: false` / `logHeaders: false` 可关闭；文档中提示生产环境慎用 |
| 内置 middleware 执行顺序固定，用户无法插入到 tracing 和 debug 之间 | 当前场景足够；如有需求可退回到手动 middleware 方式 |
| `HttpClientConfig` 依赖 `@jintianxiayu/logger` 的类型 | 依赖已存在，不引入新耦合 |
