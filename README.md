# bics-commons

TypeScript 工具库 monorepo，基于 pnpm workspace 管理。提供日志、缓存、HTTP 客户端、分布式锁等通用基础设施装饰器。

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
pnpm install
```

### 构建所有包

```bash
pnpm run build
```

### 运行测试

```bash
pnpm test
```

### 代码质量

```bash
pnpm run format:check   # Prettier 格式检查
pnpm run lint           # ESLint 检查
pnpm run format         # 自动格式化
```

## 本地手工发布

每次需要发布的变更先记录 change intent，并将生成的 `.changeset` 文件随代码提交：

```bash
pnpm change
pnpm run release:status
```

在 `master` 分支且工作区干净、已同步远端时执行发布：

```bash
# 1. 预览并应用各子包的独立版本升级
pnpm run release:version:dry-run
pnpm run release:version

# 2. 检查版本、changelog 和锁文件，然后提交并推送
git add -A
git commit -m "chore(release): publish packages"
git push

# 3. 预演并正式发布 Registry 中尚不存在的包版本
pnpm run release:publish:dry-run
pnpm run release:publish

# 4. 发布成功后为本次升级的包创建并推送 Git 标签
pnpm run release:tag
git push origin --tags
```

标签格式为 `@scope/package@version`。`pnpm version -r` 会根据 change intent 独立升级各包，并同步 workspace 内部依赖版本。

## 项目结构

```
bics-commons/
├── packages/
│   ├── logger/                # @jintianxiayu/logger
│   ├── cache-decorator/       # @jintianxiayu/cache-decorator
│   ├── http-client-decorator/ # @jintianxiayu/http-client-decorator
│   └── lock-decorator/        # @jintianxiayu/lock-decorator
├── openspec/                  # OpenSpec 变更追踪文档
├── package.json               # 根包配置
├── pnpm-workspace.yaml        # pnpm workspace 配置
├── scripts/                   # 本地发布辅助脚本
├── tsconfig.base.json         # 基础 TypeScript 配置
├── eslint.config.mjs          # ESLint 配置
└── .prettierrc                # Prettier 配置
```

## 技术栈

- **包管理与发布**: pnpm 11 workspace（change intent + independent versioning）
- **语言**: TypeScript 6.0+（target ES2021）
- **代码质量**: ESLint 10 + Prettier 3
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
