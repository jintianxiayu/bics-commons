# @jintianxiayu/http-client-decorator

基于装饰器的 HTTP 客户端框架，提供 RPC-like 调用体验。

## 特性

- 基于装饰器的声明式 HTTP 客户端定义
- 支持 `@Get`、`@Post`、`@Put`、`@Delete`、`@Patch` 方法装饰器
- 支持 `@Path`、`@Query`、`@Body`、`@Header` 参数装饰器
- Koa 风格洋葱模型中间件机制
- 支持基于 `axios-retry` 的方法级重试配置
- HTTP 4xx/5xx 错误自动抛出 `HttpError` 异常
- 内置 `tracing` 支持：自动注入 traceId 到请求头（与 `@jintianxiayu/logger` 的 `LoggerContext` 集成）
- 内置 `debug` 支持：一行配置开启完整的请求/响应日志输出
- 底层使用 axios，支持所有 axios 特性

## 安装

```bash
pnpm add @jintianxiayu/http-client-decorator
```

## 快速开始

### 定义 HTTP 客户端

```typescript
import { HttpClient, Get, Post, Path, Query, Body, Header } from '@jintianxiayu/http-client-decorator';

@HttpClient({
    baseURL: 'https://api.example.com',
})
class UserService {
    @Get('/users/:id')
    getUser(@Path('id') id: string, @Header('Authorization') token: string): Promise<User> {
        // 实际不会调用，仅用于类型标注
        return Promise.resolve({} as User);
    }

    @Post('/users')
    createUser(@Body() dto: CreateUserDto): Promise<User> {
        return Promise.resolve({} as User);
    }

    @Get('/users')
    listUsers(@Query('page') page: string, @Query('size') size: string): Promise<User[]> {
        return Promise.resolve([] as User[]);
    }
}
```

### 使用客户端

```typescript
const userService = new UserService();

// GET https://api.example.com/users/123
const user = await userService.getUser('123', 'Bearer xxx');

// POST https://api.example.com/users
const newUser = await userService.createUser({ name: 'John' });

// GET https://api.example.com/users?page=1&size=10
const users = await userService.listUsers('1', '10');
```

## 方法级重试

五种 HTTP 方法装饰器都接受可选的第二参数。其 `retry` 字段直接使用 `axios-retry` 的
`IAxiosRetryConfig`，因此可以配置该版本公开的全部重试字段：

```typescript
import { Body, Get, HttpClient, Path, Post } from '@jintianxiayu/http-client-decorator';

@HttpClient({
    baseURL: 'https://api.example.com',
    timeout: 5_000,
})
class UserService {
    @Get('/users/:id', {
        retry: {
            retries: 2,
            shouldResetTimeout: true,
            retryCondition: async (error) => error.response?.status === 503,
            retryDelay: (retryCount) => retryCount * 100,
            onRetry: async (retryCount, error, requestConfig) => {
                await refreshCredentials(requestConfig);
                console.log(`retry ${retryCount}: ${error.message}`);
            },
            onMaxRetryTimesExceeded: async (error, retryCount) => {
                console.error(`failed after ${retryCount} retries: ${error.message}`);
            },
            validateResponse: (response) => response.status < 500,
        },
    })
    getUser(@Path('id') id: string): Promise<User> {
        return Promise.resolve({} as User);
    }

    @Post('/users', { retry: { retries: 0 } })
    createUser(@Body() dto: CreateUserDto): Promise<User> {
        return Promise.resolve({} as User);
    }
}
```

重试由方法显式控制：

| 方法配置                                     | 行为                                    |
| -------------------------------------------- | --------------------------------------- |
| 不传第二参数、传 `{}`，或 `retry: undefined` | 不重试，只发送一次                      |
| `retry: {}`                                  | 使用插件默认配置，默认最多额外尝试 3 次 |
| `retry: { retries: 0 }`                      | 显式关闭重试                            |
| `retry: { ... }`                             | 浅复制并透传全部原生字段                |

未自定义 `validateResponse` 或将其设为 `null` 时，状态码小于 400 的响应保持成功；其他响应先进入插件的重试判断，最终失败再转换为 `HttpError`。自定义判定可以接受 503，也可以拒绝 200；判定拒绝响应后，是否继续尝试仍由 `retryCondition`、次数和超时预算决定。

`axios-retry` 的默认条件会重试网络错误，也会重试幂等方法的部分 5xx 响应。网络错误不代表服务端一定没有完成写操作，因此对 POST 等可能产生副作用的请求启用重试前，应由业务提供幂等键、去重机制或其他可安全重放的保证。Readable、表单流等一次性请求体不会被本包缓存或重建。

`shouldResetTimeout: false` 时，插件会从原 timeout 中扣除已用时间和等待时间，预算不足便停止重试；设为 `true` 时，每次尝试重新使用该 timeout。它不是包含 middleware 和所有回调在内的严格全链路截止时间。异步 `retryCondition`、`onRetry` 和 `onMaxRetryTimesExceeded` 会按插件原生时机执行并等待，回调抛出的普通异常会原样传播。

插件内置延迟会处理 `Retry-After`；自定义 `retryDelay` 的返回值由插件直接使用，本包不会再追加 `Retry-After` 等待或固定退避策略。

## Axios 实例与隔离边界

每个 `@HttpClient` 对象在构造时通过 `axios.create()` 创建一个请求实例。该对象的所有方法复用此实例，重试插件只注册一次；同一个类构造出的不同对象各自持有实例。宿主默认 Axios 实例在对象创建前后注册的 request/response 拦截器都不会作用于子包请求，子包的重试拦截器也不会修改宿主默认实例。

这是部分隔离。对象创建时仍按 Axios 原生规则继承当时已有的普通 defaults，例如 timeout 和默认 headers；创建后双方对这些普通字段的修改不会自动同步。Agent、类实例、函数闭包和数组内对象等引用不会被保证深拷贝，修改其内部状态仍可能同时影响双方；传入空 `headers` 也不会清除 Axios 在创建时继承的默认请求头。

重试命名空间是例外：私有实例会移除从宿主 defaults 继承的 `axios-retry` 配置，方法配置与插件默认值是子包重试策略的唯一来源。关闭方法重试不会恢复旧实现中宿主拦截器对请求的隐式影响。既有单参数装饰器调用无需迁移。

## 中间件

### 定义中间件

```typescript
import type { Middleware, HttpContext } from '@jintianxiayu/http-client-decorator';

const authMiddleware: Middleware = async (ctx: HttpContext, next) => {
    // 请求前处理
    ctx.request.headers['Authorization'] = `Bearer ${getToken()}`;

    await next(); // 调用下一个中间件

    // 响应后处理
    console.log(`Response status: ${ctx.response?.status}`);
};
```

### 洋葱模型执行顺序

```
请求前: middlewareA.before → middlewareB.before
       ↓
    [HTTP 请求]
       ↓
响应后: middlewareB.after → middlewareA.after
```

### 使用中间件

```typescript
@HttpClient({
    baseURL: 'https://api.example.com',
    middlewares: [authMiddleware, logMiddleware],
})
class UserService {}
```

## 内置功能

### tracing — 自动注入 traceId

自动从 [`LoggerContext`](../logger/README.md#日志与上下文) 读取 `traceId`，并注入到每次请求的指定 header 中。

```typescript
import { LoggerContext } from '@jintianxiayu/logger';

@HttpClient({
    baseURL: 'https://api.example.com',
    tracing: true, // 默认注入到 x-trace-id header
})
class UserService {
    @Get('/users/:id')
    getUser(@Path('id') id: string): Promise<User> {
        return Promise.resolve({} as User);
    }
}

// 在请求链路入口包裹完整异步调用链（如 Koa/Express 中间件）
await LoggerContext.withContext({ traceId: 'req-abc-123' }, async () => {
    await new UserService().getUser('42');
});
// 每次请求自动携带 x-trace-id: req-abc-123
```

**自定义配置：**

```typescript
@HttpClient({
    baseURL: 'https://api.example.com',
    tracing: {
        headerName: 'x-request-id', // 自定义 header 名称
        provider: () => myStore.getTraceId(), // 自定义 traceId 来源
    },
})
class UserService {}
```

`provider` 返回 `undefined` 时自动跳过注入，不会产生空 header。

---

### debug — 请求/响应详情输出

开启后输出完整的请求 URL、headers、body 及响应 status、headers、body、耗时。

```typescript
@HttpClient({
    baseURL: 'https://api.example.com',
    debug: true, // 使用包内 Logger 输出
})
class UserService {}
```

**输出示例（text 格式）：**

```
DEBUG [@jintianxiayu/http-client-decorator] HTTP Request {"method":"GET","url":"https://api.example.com/users/1","headers":{"x-trace-id":"abc-123"}}
DEBUG [@jintianxiayu/http-client-decorator] HTTP Response {"method":"GET","url":"https://api.example.com/users/1","status":200,"body":{...},"duration":142}
```

**自定义配置：**

```typescript
@HttpClient({
    baseURL: 'https://api.example.com',
    debug: {
        logBody: false, // 不输出 body（适合含敏感信息的接口）
        logHeaders: false, // 不输出 headers
        logger: (msg, meta) => console.log(msg, meta), // 自定义输出函数
    },
})
class UserService {}
```

> **提示**：`debug: true` 在生产环境可能输出敏感信息（如 Authorization header、请求体中的密码字段），建议配合 `logBody: false` / `logHeaders: false` 使用，或仅在开发/测试环境开启。

内置 middleware 也可独立导出用于非装饰器场景：

```typescript
import { createTracingMiddleware, createDebugMiddleware } from '@jintianxiayu/http-client-decorator';

const middlewares = [createTracingMiddleware({ headerName: 'x-trace-id' }), createDebugMiddleware({ logBody: false })];
```

---

## 错误处理

HTTP 4xx/5xx 响应会抛出 `HttpError` 异常：

```typescript
import { HttpError } from '@jintianxiayu/http-client-decorator';

try {
    await userService.getUser('not-found');
} catch (e) {
    if (e instanceof HttpError) {
        console.error(`HTTP ${e.status}: ${e.message}`);
        console.error('Response data:', e.data);
    }
}
```

## API 参考

### 装饰器

#### 类装饰器

- `@HttpClient(config: HttpClientConfig)` - 标记并配置 HTTP 客户端类

#### 方法装饰器

- `@Get(path: string, options?: HttpMethodOptions)` - GET 请求
- `@Post(path: string, options?: HttpMethodOptions)` - POST 请求
- `@Put(path: string, options?: HttpMethodOptions)` - PUT 请求
- `@Delete(path: string, options?: HttpMethodOptions)` - DELETE 请求
- `@Patch(path: string, options?: HttpMethodOptions)` - PATCH 请求

#### 参数装饰器

- `@Path(name: string)` - URL 路径参数
- `@Query(name: string)` - URL 查询参数
- `@Body()` - 请求体
- `@Header(name: string)` - 请求头

### 类型

```typescript
interface HttpClientConfig {
    baseURL: string;
    middlewares?: Middleware[];
    timeout?: number;
    headers?: Record<string, string>;
    tracing?: boolean | TracingOptions;
    debug?: boolean | DebugOptions;
}

interface TracingOptions {
    headerName?: string; // 默认 'x-trace-id'
    provider?: () => string | undefined; // 默认从 LoggerContext.get('traceId') 读取
}

interface DebugOptions {
    logger?: (message: string, meta?: Record<string, unknown>) => void;
    logBody?: boolean; // 默认 true
    logHeaders?: boolean; // 默认 true
}

interface HttpMethodOptions {
    retry?: IAxiosRetryConfig;
}

interface HttpContext {
    request: {
        method: string;
        url: string;
        headers: Record<string, string>;
        body?: unknown;
    };
    response?: {
        status: number;
        headers: Record<string, string>;
        data: unknown;
    };
    state: Record<string, unknown>;
    error?: Error;
}

type Middleware = (ctx: HttpContext, next: () => Promise<void>) => Promise<void>;

class HttpError extends Error {
    constructor(
        public status: number,
        public data: unknown,
        message: string
    ) {
        super(message);
        this.name = 'HttpError';
    }
}
```

## License

MIT
