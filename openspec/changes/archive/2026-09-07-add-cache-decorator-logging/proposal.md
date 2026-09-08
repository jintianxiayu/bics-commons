## Why

`@jintianxiayu/cache-decorator` 当前没有缓存决策日志，依赖方无法从一次业务调用中判断是否命中缓存、是否发生请求合并、回填或淘汰，也难以区分正常 miss 与缓存基础设施故障。需要通过统一的结构化日志建立可关联、可检索的缓存决策证据链，同时保持现有缓存语义不变。

## What Changes

- `@Cache` 在 key 解析回退、pending 请求复用、缓存命中、缓存未命中、结果或异常回填已发起，以及 Provider 选择或读取失败等关键节点，通过固定命名 Logger 输出结构化日志。
- `@CacheEvict` 在 key 解析回退、业务方法失败导致淘汰跳过、单 key 淘汰已发起、`allEntries` 淘汰完成，以及 Provider 或淘汰失败等关键节点输出结构化日志。
- 使用 `@jintianxiayu/logger` 的命名 Logger `@jintianxiayu/cache-decorator`，正常缓存决策使用 `debug`，可恢复的回退或跳过使用 `warn`，缓存基础设施失败使用 `error`；不使用 `info` 输出高频缓存事件。
- 日志只包含稳定的业务节点标识和必要上下文，不输出方法参数、缓存值、业务返回值或完整 cache key；现有 Logger 上下文中的 `traceId` 继续由 Logger 自动关联。
- 保持 `CacheOptions`、`CacheEvictOptions`、装饰器签名和 `src/index.ts` 导出面不变；日志是否落盘、输出到控制台以及 level 筛选继续由应用的 Logger 配置统一控制。
- 保持现有 key、TTL、请求合并、异常缓存、Provider 选择、调用顺序及异步等待边界；当前未等待的 `set` 和单 key `delete` 只记录“已发起”，不得误报“已成功”。
- 缓存包仅获取命名 Logger，不主动初始化或关闭 Logger、不安装进程信号处理器，也不创建独立 Winston 实例；包文档明确应用应在首次缓存调用前初始化 Logger。
- 为关键日志节点、level 映射、敏感信息边界、Logger 异常隔离和缓存行为保持补充单元及集成测试，并更新包 README。
- **BREAKING**：`@jintianxiayu/cache-decorator` 新增对 `@jintianxiayu/logger` 的必需运行时 peer 依赖；既有消费者升级后必须提供兼容 Logger 版本，而且默认 Logger 配置可能开始输出新的 `warn`/`error` 记录。

## Capabilities

### New Capabilities

- `cache-operation-logging`: 定义缓存装饰器关键业务节点的结构化日志、固定 level、敏感信息边界、Logger 生命周期以及不得改变缓存行为的兼容约束。

### Modified Capabilities

（无）

## Impact

- **代码范围**：预计新增 `packages/cache-decorator/src/core/cache-logger.ts`，修改 `src/decorators/cache.ts`、`src/decorators/cache-evict.ts`、相关测试、`packages/cache-decorator/package.json`、`pnpm-lock.yaml` 和包 README；`@jintianxiayu/logger` 源码不变。
- **公共 API**：不修改任何包的 `src/index.ts` 导出面，也不修改 `CacheOptions`、`CacheEvictOptions`、`CacheProvider` 或装饰器公共类型签名。新增的是运行期日志副作用和依赖契约，不新增公共 TypeScript 导出。
- **版本级别**：缓存包仍处于 0.x；新增必需 peer 依赖和默认可见的异常日志属于需要下游关注的兼容变化，按 minor 发布。Logger 包没有代码或公共契约变化，不需要随本变更同步发版；发布时应使用其当前兼容版本生成实际 peer semver 范围。
- **依赖选择**：`@jintianxiayu/logger` 是仓库内既有包，不是新的第三方依赖。发布契约使用 `peerDependencies` 以确保宿主应用和缓存包复用同一 Logger 实例及 `LoggerContext`；本地构建和测试同时使用 `devDependencies: workspace:^`。未选择普通 `dependencies`，因为重复安装可能隔离 Logger 配置和 trace 上下文；未选择自定义 logger 回调或 `console`，因为已确认统一使用 `@jintianxiayu/logger` 且不扩展缓存选项。
- **安装负担与迁移**：既有消费者需要安装满足 peer 范围的 `@jintianxiayu/logger`，在应用启动阶段先调用 `LoggerFactory.init()`，并按需为 `@jintianxiayu/cache-decorator` 配置 level 和 transport。仓库内未维护已知下游服务清单；发布前必须盘点并通知所有缓存包消费者，在升级说明中明确 peer 依赖及新增日志。
- **跨进程兼容**：Redis 逻辑 key、物理 key、值序列化和 TTL 均不变化，存量缓存无需迁移或清理。Logger 的 plain/json 格式和字段处理不变化，只新增由缓存包产生的日志记录；新旧缓存包版本共存时，旧版本不产生日志，新版本产生日志，日志采集端可按 Logger 名称和事件字段区分。
- **性能与安全**：每次缓存调用会增加 Logger 调用和少量元数据构造；高频正常事件使用 `debug` 以便生产环境筛选。日志禁止携带参数、值和完整 cache key，避免将个人信息或凭证写入不可控的日志存储。
- **回滚**：已发布 npm 版本不能撤回；如需回滚，应发布关闭或修正日志的后续版本，或由下游锁定升级前的缓存包版本。已经写入的日志按现有日志保留策略处理；Redis 数据无需回滚。
