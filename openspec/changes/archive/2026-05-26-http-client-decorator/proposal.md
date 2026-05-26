## Why

团队在多个项目中存在大量重复的 HTTP 调用代码，调用方式不统一（有的用 fetch，有的用 axios），缺乏类型安全，请求参数和响应处理逻辑分散在各处。期望一种统一的 RPC-like 调用体验：开发者只需为类和方法加上装饰器、配置好选项，调用方完全不知道 HTTP 的存在，就像调用本地方法一样完成远程请求。

## What Changes

- 新增 `@HttpClient` 类装饰器，用于标记 HTTP 客户端服务类
- 新增 `@Get/@Post/@Put/@Delete/@Patch` 方法装饰器，用于标记 HTTP 接口方法
- 新增 `@Path/@Query/@Body/@Header` 参数装饰器，用于映射方法参数到 HTTP 请求各部分
- 使用 ES Proxy 实现代理，new UserService() 返回的实例直接具备 HTTP 能力
- 内置可插拔中间件机制，采用 Koa 风格洋葱模型，支持请求前后的拦截逻辑
- 错误处理：HTTP 4xx/5xx 抛出 HttpError 异常
- 底层使用 axios 发送 HTTP 请求
- 日志使用已有的 @bics/logger 子包

## Capabilities

### New Capabilities

- `http-client-decorator`: 基于装饰器的 HTTP 客户端框架，提供 RPC-like 调用体验

## Impact

- **新增包**: `packages/http-client-decorator`
- **依赖包**: `axios`, `reflect-metadata`, `@bics/logger`
- **Breaking Change**: 无，不影响现有代码
- **受影响的团队**: 所有使用 HTTP API 调用的团队

## Rollback Plan

如需回滚，删除 `packages/http-client-decorator` 目录，并从 `@bics/logger` 依赖中移除即可。