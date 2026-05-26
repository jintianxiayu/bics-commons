## 1. 项目初始化

- [x] 1.1 创建 `packages/http-client-decorator` 目录结构
- [x] 1.2 初始化 package.json，添加依赖：axios、reflect-metadata
- [x] 1.3 配置 tsconfig.json（开启 experimentalDecorators、emitDecoratorMetadata）
- [x] 1.4 配置 lerna 将新包加入 workspaces

## 2. 核心类型定义

- [x] 2.1 定义 HttpClientConfig 接口
- [x] 2.2 定义 MethodMetadata 接口
- [x] 2.3 定义 ParamMetadata 接口
- [x] 2.4 定义 HttpContext 接口
- [x] 2.5 定义 Middleware 类型
- [x] 2.6 定义 HttpError 类

## 3. 装饰器实现

- [x] 3.1 实现 @HttpClient 类装饰器
- [x] 3.2 实现 @Get/@Post/@Put/@Delete/@Patch 方法装饰器
- [x] 3.3 实现 @Path 参数装饰器
- [x] 3.4 实现 @Query 参数装饰器
- [x] 3.5 实现 @Body 参数装饰器
- [x] 3.6 实现 @Header 参数装饰器

## 4. 代理核心

- [x] 4.1 实现 ProxyFactory 创建代理实例
- [x] 4.2 实现方法元数据读取逻辑
- [x] 4.3 实现参数映射逻辑（Path/Query/Body/Header 提取）

## 5. 中间件机制

- [x] 5.1 实现洋葱模型中间件链 executeMiddlewareChain
- [x] 5.2 实现请求/响应上下文构建
- [x] 5.3 中间件单元测试

## 6. HTTP 客户端封装

- [x] 6.1 封装 axios 创建 HTTP 请求
- [x] 6.2 实现 URL 构建逻辑（baseURL + path + path params）
- [x] 6.3 实现错误处理（4xx/5xx → HttpError）
- [x] 6.4 集成 @bics/logger 日志记录

## 7. 导出和入口

- [x] 7.1 实现 index.ts 导出所有公共 API
- [x] 7.2 验证包可正常导出

## 8. 测试

- [x] 8.1 单元测试：装饰器元数据存储和读取
- [x] 8.2 单元测试：代理方法拦截
- [x] 8.3 单元测试：中间件链执行顺序
- [x] 8.4 单元测试：参数映射
- [x] 8.5 集成测试：完整 HTTP 请求流程

## 9. 文档

- [x] 9.1 编写 README.md 使用示例
