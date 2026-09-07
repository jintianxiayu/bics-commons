## 盘点结论

- 盘点日期：2026-09-07。
- 仓库内范围：根 workspace、`packages/*/package.json` 及仓库内 TypeScript/JavaScript 入口。
- 仓库内结果：除 `packages/cache-decorator` 自身及本变更测试外，没有 package manifest 或运行时代码依赖 `@jintianxiayu/cache-decorator`，因此无需联动修改或发版其他 workspace 包。
- 外部范围：仓库无法证明 npm 包的外部消费者名单；服务名、仓库、维护者和升级窗口仍待维护者补充并确认。

## 外部消费者登记表

维护者应为每个已知下游补充一行；如果确认没有外部消费者，也应明确记录“无”。

| 服务或仓库 | 维护者 | 当前 cache-decorator 版本 | Redis 客户端及版本 | database / keyPrefix | 连接关闭位置 | 通知与升级窗口 |
| ---------- | ------ | ------------------------- | -------------------- | -------------------- | ------------ | -------------- |
| 待确认     | 待确认 | 待确认                    | 待确认               | 待确认               | 待确认       | 待确认         |

## 迁移通知内容

每个下游的通知至少包含以下内容：

1. `RedisCacheProvider` 的构造参数已改为必填 `RedisCacheClient`。ioredis 调用方应改为
   `new RedisCacheProvider(createIoredisCacheClient(redis))`；node-redis 调用方应使用
   `new RedisCacheProvider(createNodeRedisCacheClient(redis, { keyPrefix }))`。
2. 下游必须直接声明实际使用的 `ioredis` 或 `redis` 依赖；`cache-decorator` 不再提供 Redis SDK 运行时依赖或 peer dependency。
3. ioredis 继续从连接读取 `keyPrefix`；node-redis 必须显式传入等价字面前缀。升级时保持相同 database 和最终物理 key，既有缓存无需迁移。
4. Redis 连接的创建、连接、错误监听、重连与关闭均归下游所有；应用应在启动时先连接，在自身关闭阶段调用对应客户端的 `quit`、`disconnect` 或既有关闭流程。
5. `RedisCacheProvider.clear()` 仍执行当前 database 的 `FLUSHDB`，`keyPrefix` 不会限制清理范围。
6. 回退时锁定 `@jintianxiayu/cache-decorator@0.1.3`，恢复旧裸 ioredis 构造方式。缓存 key、值和 TTL 格式未改变，无需清理或回滚 Redis 数据；已发布 npm 版本不作为可撤回资产处理。

## 发布检查点

- [ ] 维护者已补全或明确确认已知外部消费者名单。
- [ ] 每个下游的客户端依赖、database、`keyPrefix`、连接关闭位置和升级负责人已经核对。
- [ ] 通知时点确认为：`0.2.0` API 与迁移文档冻结后、任何下游升级部署前，并早于本地正式发布确认。
- [ ] 下游已知晓回退到 `0.1.3` 的代码与版本锁定步骤。

上述检查点未由维护者确认前，不执行 `pnpm run release:version`、`pnpm run release:publish` 或其他本地正式发布操作。
