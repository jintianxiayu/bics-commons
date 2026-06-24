# bics-commons

TypeScript 工具库 monorepo，基于 Lerna + NPM Workspaces 管理。提供日志、缓存、HTTP 客户端、分布式锁等通用基础设施装饰器。

## 包列表

| 包 | 版本 | 说明 |
| --- | --- | --- |
| [@jintianxiayu/logger](./packages/logger) | 0.1.3 | SLF4J 风格日志工厂，支持 YAML 配置、敏感信息脱敏、TraceContext |
| [@jintianxiayu/cache-decorator](./packages/cache-decorator) | 0.1.3 | 方法缓存装饰器，支持 TTL、请求合并、可插拔后端（Memory/Redis） |
| [@jintianxiayu/http-client-decorator](./packages/http-client-decorator) | 0.1.5 | 声明式 HTTP 客户端，洋葱模型中间件，RPC-like 调用体验 |
| [@jintianxiayu/lock-decorator](./packages/lock-decorator) | 0.1.3 | 分布式锁装饰器，支持 Redis 存储和看门狗自动续期 |

## 快速开始

### 安装依赖

```bash
npm install
```

### 构建所有包

```bash
npm run build
```

### 运行测试

```bash
npm test
```

### 代码质量

```bash
npm run format:check   # Prettier 格式检查
npm run lint           # ESLint 检查
npm run format         # 自动格式化
```

## 项目结构

```
bics-commons/
├── packages/
│   ├── logger/                # @jintianxiayu/logger
│   ├── cache-decorator/       # @jintianxiayu/cache-decorator
│   ├── http-client-decorator/ # @jintianxiayu/http-client-decorator
│   └── lock-decorator/        # @jintianxiayu/lock-decorator
├── openspec/                  # OpenSpec 变更追踪文档
├── lerna.json                 # Lerna 配置（independent 版本模式）
├── package.json               # 根 workspace 配置
├── tsconfig.base.json         # 基础 TypeScript 配置
├── eslint.config.mjs          # ESLint 配置
└── .prettierrc                # Prettier 配置
```

## 技术栈

- **包管理**: Lerna 9 + NPM Workspaces（independent 版本模式）
- **语言**: TypeScript 6.0+（target ES2021）
- **代码质量**: ESLint 9 + Prettier 3
- **测试**: Jest 29 + ts-jest
- **装饰器**: experimentalDecorators + emitDecoratorMetadata
- **模块系统**: NodeNext（CJS 输出）

## 各包简介

### @jintianxiayu/logger

基于 Winston 的日志工厂，提供：

- 命名 Logger（`LoggerFactory.getLogger(name)`）
- YAML 配置文件 + 配置继承
- 敏感信息自动脱敏
- `%{log_position}` 调用位置捕获
- `%{traceId}` AsyncLocalStorage 异步上下文传递
- 优雅关闭（`shutdown()` / `setupShutdownHandlers()`）

### @jintianxiayu/cache-decorator

声明式方法缓存：

- `@Cache` 装饰器：方法级缓存，支持 TTL 过期
- `@CacheEvict` 装饰器：缓存清除
- 可插拔后端（Memory / Redis / 自定义）
- 请求合并：并发场景下返回同一个 Promise
- 错误结果缓存：防止缓存穿透

### @jintianxiayu/http-client-decorator

声明式 HTTP 客户端框架：

- 方法装饰器：`@Get`、`@Post`、`@Put`、`@Delete`、`@Patch`
- 参数装饰器：`@Path`、`@Query`、`@Body`、`@Header`
- Koa 风格洋葱模型中间件
- HTTP 4xx/5xx 自动抛出 `HttpError`
- 底层基于 axios

### @jintianxiayu/lock-decorator

分布式锁装饰器：

- `@DistributedLock` 装饰器：自动加锁/释放
- 可插拔锁后端（Redis / 自定义）
- 看门狗自动续期：防止长业务锁超时
- 多种 key 策略：方法级、字符串、函数动态计算
- 锁获取失败抛出 `LockAcquisitionError`

## 贡献

请参考各包的 README 文档了解详细用法和 API。

## License

MIT
