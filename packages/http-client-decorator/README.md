# @bics/http-client-decorator

基于装饰器的 HTTP 客户端框架，提供 RPC-like 调用体验。

## 特性

- 基于装饰器的声明式 HTTP 客户端定义
- 支持 `@Get`、`@Post`、`@Put`、`@Delete`、`@Patch` 方法装饰器
- 支持 `@Path`、`@Query`、`@Body`、`@Header` 参数装饰器
- Koa 风格洋葱模型中间件机制
- HTTP 4xx/5xx 错误自动抛出 `HttpError` 异常
- 底层使用 axios，支持所有 axios 特性

## 安装

```bash
npm install @bics/http-client-decorator
```

## 快速开始

### 定义 HTTP 客户端

```typescript
import {
  HttpClient,
  Get,
  Post,
  Path,
  Query,
  Body,
  Header,
} from '@bics/http-client-decorator';

@HttpClient({
  baseURL: 'https://api.example.com',
})
class UserService {
  @Get('/users/:id')
  getUser(
    @Path('id') id: string,
    @Header('Authorization') token: string
  ): Promise<User> {
    // 实际不会调用，仅用于类型标注
    return Promise.resolve({} as User);
  }

  @Post('/users')
  createUser(@Body() dto: CreateUserDto): Promise<User> {
    return Promise.resolve({} as User);
  }

  @Get('/users')
  listUsers(
    @Query('page') page: string,
    @Query('size') size: string
  ): Promise<User[]> {
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

## 中间件

### 定义中间件

```typescript
import type { Middleware, HttpContext } from '@bics/http-client-decorator';

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

## 错误处理

HTTP 4xx/5xx 响应会抛出 `HttpError` 异常：

```typescript
import { HttpError } from '@bics/http-client-decorator';

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

- `@Get(path: string)` - GET 请求
- `@Post(path: string)` - POST 请求
- `@Put(path: string)` - PUT 请求
- `@Delete(path: string)` - DELETE 请求
- `@Patch(path: string)` - PATCH 请求

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

type Middleware = (
  ctx: HttpContext,
  next: () => Promise<void>
) => Promise<void>;

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
