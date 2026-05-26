## Context

团队在多个项目中存在大量重复的 HTTP 调用代码，调用方式不统一（有的用 fetch，有的用 axios），缺乏类型安全，请求参数和响应处理逻辑分散在各处。期望一种统一的 RPC-like 调用体验。

## Goals / Non-Goals

**Goals:**
- 提供基于装饰器的 HTTP 客户端框架
- 开发者只需为类和方法加上装饰器、配置好选项，调用方完全不知道 HTTP 的存在
- 支持可插拔中间件机制，采用 Koa 风格洋葱模型
- 类型安全，开发者手动标注返回类型
- 错误处理：HTTP 4xx/5xx 抛出 HttpError 异常

**Non-Goals:**
- 不兼容现有的 fetch/axios 代码（全新项目使用）
- 不提供内置重试机制（由调用方自行实现）
- 不支持参数名自动推断（@Query 必须指定参数名）

## Decisions

### 1. 装饰器设计

| 装饰器 | 位置 | 功能 |
|--------|------|------|
| `@HttpClient` | 类 | 标记 HTTP 客户端服务类，存储配置 |
| `@Get/@Post/@Put/@Delete/@Patch` | 方法 | 标记 HTTP 接口方法 |
| `@Path` | 参数 | 映射到 URL 路径参数 |
| `@Query` | 参数 | 映射到 URL Query 参数 |
| `@Body` | 参数 | 映射到请求 Body |
| `@Header` | 参数 | 映射到请求 Header |

**配置存储**：使用 `reflect-metadata` + `Symbol.for` 全局 key，不污染原类。

### 2. 代理实现

使用 ES Proxy 实现代理，`new UserService()` 返回代理实例：

```typescript
function HttpClient(config: HttpClientConfig) {
  return function <T extends new (...args: any[]) => any>(Target: T): T {
    Reflect.defineMetadata(HTTP_CLIENT_CONFIG_KEY, config, Target);

    return class extends Target {
      constructor(...args: any[]) {
        const instance = new Target(...args);
        return new Proxy(instance, {
          get(target, prop, receiver) {
            const methodMeta = getMethodMetadata(target, prop);
            if (methodMeta) {
              return createHttpMethod(config, methodMeta);
            }
            return Reflect.get(target, prop, receiver);
          }
        });
      }
    };
  };
}
```

### 3. 中间件机制

采用 Koa 风格洋葱模型：

```typescript
interface Middleware {
  (ctx: HttpContext, next: () => Promise<void>): Promise<void>;
}

@HttpClient({
  baseURL: 'https://api.example.com',
  middlewares: [authMiddleware, logMiddleware]
})
class UserService {}
```

**洋葱模型执行顺序**：
```
auth before next
log before next
[HTTP 请求]
log after next
auth after next
```

### 4. HttpContext 结构

```typescript
interface HttpContext {
  request: {
    method: string;        // GET/POST/...
    url: string;           // 完整 URL
    headers: Record<string, string>;
    body?: unknown;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    data: unknown;
  };
  state: Record<string, any>;  // 中间件共享数据
  error?: Error;
}
```

### 5. 错误处理

HTTP 4xx/5xx 抛出 HttpError 异常：

```typescript
class HttpError extends Error {
  constructor(
    public status: number,
    public data: unknown,
    message: string
  ) { super(message); }
}
```

### 6. 底层 HTTP

使用 axios 发送 HTTP 请求。

### 7. 模块结构

| 模块 | 功能 | 依赖 |
|------|------|------|
| `decorators/http-client.ts` | @HttpClient 类装饰器 | reflect-metadata |
| `decorators/http-methods.ts` | @Get/@Post/@Put/@Delete/@Patch | reflect-metadata |
| `decorators/params.ts` | @Path/@Query/@Body/@Header | reflect-metadata |
| `core/proxy.ts` | 代理创建和方法拦截 | decorators |
| `core/middleware.ts` | 洋葱模型中间件链 | axios, @bics/logger |
| `core/http-context.ts` | HttpContext 定义 | - |
| `core/http-error.ts` | HttpError 异常类 | - |
| `core/http-client.ts` | HTTP 客户端封装 | axios |
| `index.ts` | 导出所有公共 API | - |

### 8. 使用示例

```typescript
@HttpClient({
  baseURL: 'https://api.example.com',
  middlewares: [authMiddleware, logMiddleware]
})
class UserService {
  @Get('/users/:id')
  getUser(@Path('id') id: string, @Header('Authorization') token: string): Promise<User> { ... }

  @Post('/users')
  createUser(@Body dto: CreateUserDto): Promise<User> { ... }
}

const userService = new UserService();
const user = await userService.getUser('123', 'Bearer xxx');
```

## Risks / Trade-offs

- **依赖 reflect-metadata**：需要开启 `experimentalDecorators` 和 `emitDecoratorMetadata`
- **装饰器元数据限制**：TypeScript 反射能力有限，参数类型推断依赖编译器设置