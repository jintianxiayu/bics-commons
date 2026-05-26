## ADDED Requirements

### Requirement: HttpClient 装饰器
`@HttpClient` 装饰器 SHALL 标记一个类为 HTTP 客户端服务类，并接受配置对象 `HttpClientConfig`。

#### Scenario: 基本配置
- **WHEN** 开发者使用 `@HttpClient({ baseURL: 'https://api.example.com' })` 装饰类
- **THEN** 该类的配置被存储到 Reflect Metadata

#### Scenario: 带中间件配置
- **WHEN** 开发者使用 `@HttpClient({ baseURL: '...', middlewares: [mw1, mw2] })` 装饰类
- **THEN** 中间件链被保存到配置中

### Requirement: HTTP 方法装饰器
`@Get/@Post/@Put/@Delete/@Patch` 装饰器 SHALL 标记方法为 HTTP 接口方法。

#### Scenario: Get 方法
- **WHEN** 开发者使用 `@Get('/users/:id')` 装饰方法
- **THEN** 方法元数据 `{ method: 'GET', path: '/users/:id' }` 被存储

#### Scenario: Post 方法
- **WHEN** 开发者使用 `@Post('/users')` 装饰方法
- **THEN** 方法元数据 `{ method: 'POST', path: '/users' }` 被存储

### Requirement: 参数装饰器
`@Path/@Query/@Body/@Header` 装饰器 SHALL 将方法参数映射到 HTTP 请求各部分。

#### Scenario: Path 参数
- **WHEN** 开发者使用 `@Path('id') id: string` 标记参数
- **THEN** 参数元数据 `{ paramIndex: 0, paramType: 'path', paramName: 'id' }` 被存储

#### Scenario: Query 参数
- **WHEN** 开发者使用 `@Query('pageSize') pageSize: number` 标记参数
- **THEN** 参数元数据 `{ paramIndex: 1, paramType: 'query', paramName: 'pageSize' }` 被存储

#### Scenario: Body 参数
- **WHEN** 开发者使用 `@Body dto: CreateUserDto` 标记参数
- **THEN** 参数元数据 `{ paramIndex: 2, paramType: 'body' }` 被存储

#### Scenario: Header 参数
- **WHEN** 开发者使用 `@Header('Authorization') token: string` 标记参数
- **THEN** 参数元数据 `{ paramIndex: 3, paramType: 'header', paramName: 'Authorization' }` 被存储

### Requirement: 代理实例化
`new ServiceClass()` SHALL 返回一个代理实例，而不是原实例。

#### Scenario: 代理返回
- **WHEN** 开发者调用 `new UserService()`
- **THEN** 返回一个 Proxy 包装的实例

### Requirement: 方法拦截
调用代理实例的方法 SHALL 触发 HTTP 请求。

#### Scenario: GET 请求
- **WHEN** 开发者调用 `userService.getUser('123')`，其中 `@Get('/users/:id')` 和 `@Path('id') id: string`
- **THEN** 发送 GET 请求到 `baseURL/users/123`

#### Scenario: POST 请求带 Body
- **WHEN** 开发者调用 `userService.createUser(dto)`，其中 `@Post('/users')` 和 `@Body dto`
- **THEN** 发送 POST 请求到 `baseURL/users`，Body 为 dto

### Requirement: 中间件链
中间件 SHALL 以洋葱模型顺序执行。

#### Scenario: 请求前中间件
- **WHEN** 中间件 A 和 B 按顺序配置，中间件 A 的 `await next()` 被调用
- **THEN** 中间件 A 的 `next()` 前的代码先于 B 执行

#### Scenario: 响应后中间件
- **WHEN** 中间件 A 和 B 按顺序配置
- **THEN** 中间件 B 的响应后代码先于 A 执行

### Requirement: HttpError 异常
HTTP 4xx/5xx SHALL 抛出 HttpError 异常。

#### Scenario: 404 错误
- **WHEN** HTTP 请求返回 404
- **THEN** 抛出 `HttpError` 包含 status=404 和 response.data

#### Scenario: 500 错误
- **WHEN** HTTP 请求返回 500
- **THEN** 抛出 `HttpError` 包含 status=500 和 response.data

### Requirement: HttpContext 结构
中间件 SHALL 接收包含请求、响应、state 的 HttpContext 对象。

#### Scenario: 请求上下文
- **WHEN** 中间件被调用
- **THEN** ctx.request 包含 method、url、headers、body

#### Scenario: 响应上下文
- **WHEN** HTTP 请求完成后
- **THEN** ctx.response 包含 status、headers、data

#### Scenario: State 共享
- **WHEN** 中间件 A 设置 `ctx.state.user = { id: 1 }`
- **THEN** 后续中间件 B 可以通过 `ctx.state.user` 访问

### Requirement: 日志记录
HTTP 客户端 SHALL 使用 @bics/logger 记录日志。

#### Scenario: 日志记录
- **WHEN** HTTP 请求发送或响应接收
- **THEN** 使用 `@bics/logger` 记录日志