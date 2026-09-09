## 1. 公共契约与配置边界

- [x] 1.1 在 cache 包公共契约中新增 `CacheErrorCodec`、`CacheErrorPolicy` 与 `CacheOptions.errorCache`，保持 `CacheEvictOptions`、`CacheProvider` 和其余包根导出不变；通过构建后的 `.d.ts` 审核验证字段、返回类型和中文 JSDoc 符合约定。
- [x] 1.2 扩展 type-contract fixture，覆盖省略策略、仅配置正整数 TTL、筛选器与完整 codec 的编译正例，以及缺少 TTL、不完整 codec、错误回调签名和 `CacheEvictOptions.errorCache` 的明确负例；先构建 cache 包，再执行 `pnpm exec tsc -p packages/cache-decorator/test/type-contract/tsconfig.json --noEmit` 验证。
- [x] 1.3 在 legacy decorator 求值边界归一化异常策略，验证 `0`、负数、非整数、NaN 与 Infinity 抛出 `RangeError`，运行期畸形筛选器/codec 抛出 `TypeError`，且测试断言 Provider 与业务方法均未被调用。

## 2. 异常策略编排与并发语义

- [x] 2.1 收窄业务执行的 `try/catch`，实现省略 `errorCache` 时不持久化业务异常，并确保 Provider 解析/读取、key resolver 回退和 Logger 失败不会进入异常策略；用 `cache.test.ts` 与 `cache-logging.test.ts` 覆盖“省略策略默认不缓存异常”“Provider 解析或读取失败”“key resolver 失败后业务成功”“Logger 失败不进入异常缓存”。
- [x] 2.2 实现 `shouldCache` 每次实际业务失败至多求值一次：未提供时接受、返回 true 时继续、返回 false 时跳过、抛出时 fail-closed 且保留原业务异常；用聚焦测试验证 codec/Provider 调用次数、后续顺序调用可重试及筛选器错误不遮蔽业务错误。
- [x] 2.3 将正常结果写入与异常候选写入分别传递 `CacheOptions.ttl` 和 `errorCache.ttl`，并确保异常写入的同步 Provider 失败不替换原业务异常；通过自定义 Provider 参数断言及 Memory fake-timer 测试覆盖 300/10 秒分离、正常 TTL 省略和异常过期后重新执行。
- [x] 2.4 保持 pending Promise 身份与 settled 清理不变，补充无策略、筛选拒绝和编码失败三类并发 rejection 测试；执行 `cache.test.ts` 与 `pending-cache.test.ts` 验证并发业务只执行一次、调用方收到同一 Promise，清理后相同 key 可重新读取和执行。

## 3. 异常编码、命中与 Redis 互操作

- [x] 3.1 实现集中定义的版本 1 error envelope 与默认 codec，验证标准 `Error` 只往返 name/message、不保存 stack 或自有属性，JSON 兼容的非 Error 值可往返，而 undefined、函数、symbol、循环引用和无效 JSON 表示会跳过写入并保留原业务异常。
- [x] 3.2 实现自定义 codec 的单次 encode/decode 及 JSON 往返规范化，验证 Memory 与自定义 Provider 得到一致 payload；补充 encode/decode 抛错、decode 非法结果及共享 key codec 不匹配时旁路为 miss 的测试。
- [x] 3.3 实现读取分类：正常 `{ value }` 命中不变、启用策略的当前版本异常可解码后命中、禁用策略的版本化异常和所有 legacy `{ error }` 条目旁路为 miss；用装饰器测试验证 hit/miss、业务调用次数、成功覆盖及启用后重新写入新 envelope。
- [x] 3.4 扩展 Redis 装饰器/互操作测试，覆盖 ioredis 写入 node-redis 读取及反向读取的标准 Error、兼容自定义 codec、旧异常条目旁路、禁用策略不消费异常、不可序列化 payload 不发送 SET，以及 Redis GET 失败仍传播原基础设施错误。
- [x] 3.5 使用既有 legacy Redis helper 验证旧读取方可把新 envelope 解析为普通 JSON 但会按旧逻辑抛出未解码对象，同时断言正常值、物理 key、秒级 TTL、淘汰 pattern 和两种客户端适配器请求完全不变。

## 4. 缓存决策日志

- [x] 4.1 增加 `cache.error_cache_skipped` 与 `cache.error_cache_failed` 的固定级别、reason/phase 白名单，并调整异常 hit/write 日志分支；通过 `cache-logger.test.ts` 验证 skipped 使用 debug、failed 使用 warn、实际 Provider 写入才产生 `cache.write_dispatched`，且不误用 `cache.operation_failed`。
- [x] 4.2 扩展 `cache-logging.test.ts`，逐项覆盖 disabled、predicate_rejected、legacy_entry、disabled_entry 以及 predicate/encode/decode failure 的事件顺序，断言旁路不记录 hit、有效异常命中不执行业务、策略失败不记录 write-dispatched。
- [x] 4.3 增加包含手机号、凭据、循环 payload、业务错误和 codec 错误的敏感信息用例，并注入 Logger 获取/写入失败；验证日志仅包含稳定 event/cacheName/methodName/providerName/reason/phase，且 Logger 故障不改变旁路、命中或原错误传播。

## 5. 文档、迁移与发布计划

- [x] 5.1 更新 cache 包 README 和根 README，说明异常缓存默认关闭、`errorCache`/TTL/筛选器/codec 示例、不得缓存瞬时故障、默认 codec 的保真与敏感数据边界、legacy 旁路，以及“先升级全部读取方、后启用策略”的两阶段迁移；人工核对文档示例与公共 `.d.ts` 一致。
- [x] 5.2 为 `@jintianxiayu/cache-decorator` 创建 major changeset，明确默认错误语义、Redis envelope 和迁移要求；运行 `pnpm run release:status` 验证版本计划只包含预期包及级别，且未新增 dependency、peerDependency 或 Redis 客户端安装责任。
- [x] 5.3 由维护者确认并记录依赖旧异常负缓存、共享相同 Redis cache key 或需要自定义 codec 的下游清单及通知结果；清单未确认前保留发布门禁，不执行真实 version、publish 或 tag。

## 6. 综合验证

- [x] 6.1 运行 `pnpm --filter @jintianxiayu/cache-decorator test -- --runInBand --no-cache`，确认异常策略、日志、pending、Memory、Redis adapter/provider 和互操作测试全部通过且没有 unhandled rejection。
- [x] 6.2 依次运行 cache 包 build、`pnpm exec tsc -p packages/cache-decorator/test/type-contract/tsconfig.json --noEmit`、`pnpm run lint` 与 `pnpm run format:check`，验证 TypeScript 6/NodeNext、legacy decorators、公共声明和仓库代码风格。
- [x] 6.3 运行 `pnpm run build` 与 `pnpm test` 做 workspace 回归，确认 logger、http-client-decorator、lock-decorator 及正常 cache 行为未受影响；若存在无关基线失败，记录精确命令与证据而不扩张修改范围。
- [x] 6.4 运行 `pnpm run release:version:dry-run` 和 `pnpm run release:publish:dry-run`，检查生成 manifest、major 版本计划、workspace peer 转换及独立消费入口；dry-run 不视为真实发布，也不得执行 `pnpm run release:publish`。
- [x] 6.5 运行 `openspec validate configure-cache-error-caching --strict`，逐项核对三个 delta spec 的每个 Scenario 均有对应自动化测试或明确人工门禁，并确认 proposal、design、specs、tasks 与最终实现一致。

### 验证记录

- cache 包测试通过 18 个 suite、163 个启用用例；真实 Redis suite 的 17 个用例因未配置 `CACHE_DECORATOR_TEST_REDIS_URL` 按既有条件跳过，双客户端协议另有不依赖外部 Redis 的自动化覆盖。
- `pnpm exec tsc ...` 在当前 shell 未解析到根目录本地 `tsc`；改用同一 `node_modules/.bin/tsc.CMD` 和同一 tsconfig/`--noEmit` 参数后通过。
- `pnpm run format:check` 已执行，但被 103 个本次未修改的基线文件阻塞；本次全部目标文件的独立 Prettier check 通过，未批量改写无关文件。
- `pnpm run release:publish:dry-run` 的构建与测试通过，随后因工作树未提交被 `ERR_PNPM_GIT_UNCLEAN` 拦截；仅对 dry-run 使用 `--force --no-git-checks` 后确认包内容包含新源码、声明、README 与测试，既有打包消费测试同时验证 Logger workspace peer 转换和独立入口。
- `pnpm run release:version:dry-run` 只规划 `@jintianxiayu/cache-decorator` 从 1.0.0 升到 2.0.0；未执行真实 version、publish 或 tag。
