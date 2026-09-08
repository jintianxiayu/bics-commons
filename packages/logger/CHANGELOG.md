# @jintianxiayu/logger

## 1.0.0

### Major Changes

- 本次发布包含以下变更：

  - `@jintianxiayu/logger`：重构日志配置、命名 Logger、Plain/JSON 输出、轮转文件、元数据规范化与脱敏、异步 `traceId` 上下文、进程错误处理及可等待的关闭流程。BREAKING：包根不再导出 `createLogger`、`ConfigLoader` 和 `LogPosition`；`LoggerContext.set/clear/getStore` 改为通过 `withContext/get` 使用，配置结构及脱敏字段格式同步调整，运行时要求 Node.js 20.19+/22.13+/24+。
  - `@jintianxiayu/cache-decorator`：修复并发缓存 Promise 复用及拒绝后的清理；解耦 `RedisCacheProvider` 与具体 Redis SDK，新增 `RedisCacheClient`、ioredis 和 node-redis 适配工厂，并保持 Redis key、值格式及秒级 TTL 兼容；新增缓存命中、回填、淘汰和基础设施失败的结构化日志。BREAKING：调用方必须显式包装并管理 Redis 连接、直接声明所用 Redis 客户端依赖，同时提供兼容的 `@jintianxiayu/logger` peer 并在首次缓存调用前初始化 Logger。
  - `@jintianxiayu/lock-decorator`：解耦 `RedisLockProvider` 与 ioredis，新增 `RedisLockClient`、ioredis 和 node-redis 适配工厂，锁协议及连接所有权语义保持不变；新增锁获取、重试、续期、业务执行和释放的结构化日志。Watchdog 续期 Promise 拒绝会被记录并停止后续续期，不再形成未处理拒绝，已开始的业务仍继续执行并在结束时尝试释放锁。BREAKING：调用方必须显式包装现有 Redis 连接、直接声明客户端依赖，同时提供兼容的 `@jintianxiayu/logger` peer 并在首次锁调用前初始化 Logger。
  - `@jintianxiayu/http-client-decorator`：同步适配 logger 0.2 的 peer 依赖与异步上下文用法；调用方应通过 `LoggerContext.withContext` 建立请求上下文，tracing 中间件继续从中读取并注入 `traceId`。
  - 仓库开发与发布流程迁移到 pnpm 11 原生 workspace，并统一 TypeScript NodeNext、Jest、清理、构建和本地发布配置。
