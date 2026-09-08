## 1. 依赖与公共契约基线

- [x] 1.1 在 `packages/cache-decorator/package.json` 的 `peerDependencies` 和 `devDependencies` 增加 `@jintianxiayu/logger: "workspace:^"`，保持其不进入普通 `dependencies`，并更新 `pnpm-lock.yaml`；验证执行 `pnpm install --lockfile-only` 成功且 manifest/lockfile 只出现预期依赖变化。
- [x] 1.2 增加带独立 `tsconfig` 的 strict TypeScript 公共契约 fixture，固定 `CacheOptions`、`CacheEvictOptions`、`Cache`、`CacheEvict` 与 `CacheProvider` 的既有签名，并明确 `logging`、`debug`、Logger 参数不是合法选项；先 build，再用 `pnpm exec tsc -p packages/cache-decorator/test/type-contract/tsconfig.json --noEmit` 验证 Scenario A01，避免误以为仅包含 `src/**/*` 的包级 typecheck 会检查 test fixture。

## 2. 内部日志核心

- [x] 2.1 新增未从包根导出的内部 cache Logger 模块，定义固定名称 `@jintianxiayu/cache-decorator`、事件/level 与 metadata 白名单，并实现运行期惰性 `LoggerFactory.getLogger()` 和吞掉 Logger 获取/写入异常的安全调用；验证 cache 包可单独 build，且源码中没有 `console`、`LoggerFactory.init()`、`shutdown()` 或独立 Logger runtime。
- [x] 2.2 为内部日志模块增加聚焦单元测试，验证 import 与 decorator 求值不获取 Logger、首次运行期事件获取并复用同一命名 Logger、正常/回退/失败分别调用 `debug`/`warn`/`error` 且从不调用 `info`，Logger 同步异常被隔离；运行对应 Jest 用例并覆盖“固定命名 Logger 与日志级别”、Scenario L01、L02。

## 3. Decorator 日志编排

- [x] 3.1 在 `@Cache` 现有控制流中接入 key fallback、pending hit、value/error hit 与 miss 日志，使用被装饰的 method name 和配置的 Provider 标签且不记录 key/参数/值；验证 TypeScript 编译通过且 key 解析、Provider 读取、业务方法的先后顺序不变。
- [x] 3.2 增加 `@Cache` 读取决策测试，逐项覆盖 Scenario C01、C02、C03、K01、A02 以及“正常缓存决策使用 debug”“可恢复回退使用 warn”，断言并发调用保持同一 Promise identity、resolver/Provider/业务调用次数和原异常 identity；运行对应 Jest 用例。
- [x] 3.3 在 `@Cache` miss 后的 value/error 回填路径记录 `cache.write_dispatched`，保持 `provider.set()` 不被 await、不附加 rejection handler且只在同步返回控制权后记录，并保留同步 `set()` 抛错进入既有控制流的行为；验证装饰方法仍按原结果或原业务异常完成。
- [x] 3.4 增加 `@Cache` 回填与重复调用测试，逐项覆盖 Scenario C04、C05、C06、F04，断言 value/error `entryType`、事件顺序、无 success/completed 事件、无额外读写/业务调用，并用受控 Promise 验证 decorator 不等待或消费异步写入拒绝；运行对应 Jest 用例。
- [x] 3.5 为 `@Cache` 的 Provider 解析、读取及同步可观察写入失败接入 `cache.operation_failed`，分别使用 `provider_resolution`、`read`、`write` operation，并保证日志失败不遮蔽原 Provider 错误；验证失败路径不产生 miss、不执行业务方法、不切换 Provider。
- [x] 3.6 增加 `@Cache` 失败、metadata 与故障隔离测试，逐项覆盖 Scenario F01、F02、M01、M02、M03、L03、L04 以及“缓存基础设施失败使用 error”，断言默认/显式 Provider 标签、字段白名单、Logger 接收原 Provider error、敏感/Unicode/空值/循环引用参数和值不被读取或序列化进日志；运行对应 Jest 用例。
- [x] 3.7 在 `@CacheEvict` 中接入业务失败 `cache.evict_skipped` 与单 key resolver 的 `cache.key_fallback`，保持业务方法先执行、失败时不获取 Provider/不求值 resolver/不删除，且 `allEntries` 始终忽略 resolver；验证返回值和原业务异常 identity 不变。
- [x] 3.8 增加淘汰跳过与 key 回退测试，逐项覆盖 Scenario E03、K02、K03 以及“淘汰跳过与 key 回退使用 warn”，断言失败/全量分支没有额外 resolver、Provider 或删除调用；运行对应 Jest 用例。
- [x] 3.9 在 `@CacheEvict` 成功路径区分单 key `cache.evict_dispatched` 与已等待的全量 `cache.evict_completed`，并为 Provider 解析、同步单 key 删除、等待中的扫描/批量删除失败记录 `cache.operation_failed`（`provider_resolution` 或 `evict`），保持既有 await 边界与异常传播。
- [x] 3.10 增加淘汰成功、重复与失败测试，逐项覆盖 Scenario E01、E02、E04、F03、F05 以及正常 `debug`/基础设施 `error` 级别要求，断言单 key Promise 不被等待或消费、全量失败不记录 completed、每次调用只执行一次实际删除；运行对应 Jest 用例。

## 4. Logger 与发布包集成

- [x] 4.1 增加隔离进程的真实 Logger 集成 fixture：应用先初始化命名 profile 和 `LoggerContext`，再调用 cache decorator，并采集结构化输出；验证 fixture 不创建第二个 LoggerFactory/Winston 实例且可由父测试稳定启动和关闭。
- [x] 4.2 增加真实 Logger 集成断言，覆盖“Logger 配置筛选输出”、Scenario M03、M04、P01：验证同名 profile 的 level/transport 生效、Provider error 经统一规范化/脱敏、`traceId` 自动关联，且 cache 包不读写 LoggerContext；运行对应集成测试。
- [x] 4.3 增加 workspace 外严格 TypeScript 消费 fixture，覆盖包根导入以及 Memory、Redis adapter 和自定义 Provider 的既有用法；在 build 后编译并运行 fixture，验证兼容 Logger peer 由消费方提供且覆盖 Scenario A01、P01。
- [x] 4.4 对 cache 包执行 `pnpm --filter @jintianxiayu/cache-decorator publish --dry-run` 并检查生成的发布 manifest，验证 `workspace:^` 转换为实际 `^0.2.0` peer range、Logger 不在普通 dependencies、包内不携带第二份 Logger，覆盖 Scenario P02。

## 5. 包根导出与缓存兼容性

- [x] 5.1 核对 `packages/cache-decorator/src/index.ts`：保持所有既有导出，不导出内部 Logger、事件或 metadata 类型；build 后检查 `dist/index.d.ts` 与公共 API 基线，验证没有新增日志配置项或 Logger 私有类型。
- [x] 5.2 运行并按需补强 Memory/Redis/custom Provider 现有回归测试，验证日志改造未改变 key、缓存 entry JSON、TTL、淘汰 pattern、Provider 选择及新旧版本共享 Redis 数据的能力，覆盖 Scenario A03。

## 6. 文档与发版记录

- [x] 6.1 更新 `packages/cache-decorator/README.md`，说明 Logger required peer、首次 cache 调用前的初始化顺序、命名 profile 配置、固定 level/event 表、`dispatched` 与 `completed` 的区别、metadata/敏感信息边界及无需 `CacheOptions.logging`；验证 README 示例使用当前 `@jintianxiayu/logger` 公共 API 且通过 Prettier 检查。
- [x] 6.2 新增独立的 cache-decorator minor 变更记录，明确 required peer 与新增日志副作用属于 breaking 升级信息，并注明与现有待发布 minor 合并后目标仍为 `0.2.0`；运行 `pnpm run release:status` 和 `pnpm run release:version:dry-run` 验证只提升预期包且 logger 无同步发版。

## 7. 完整验证

- [x] 7.1 对照 spec 建立 Scenario-to-test 清单，逐项核验 C01-C06、E01-E04、K01-K03、F01-F05、M01-M04、L01-L04、A01-A03、P01-P02 及四个日志级别/配置 Scenario 均有明确断言，不把 `openspec validate` 等同于测试覆盖；运行 `openspec validate add-cache-decorator-logging --strict` 验证变更结构。
- [x] 7.2 运行 `pnpm --filter @jintianxiayu/cache-decorator typecheck` 与 `pnpm --filter @jintianxiayu/cache-decorator test`，验证受影响包全部测试通过且无未处理的异步写入/删除测试污染。
- [x] 7.3 依次运行 `pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm test`，全部通过后检查完整 diff，确认 logger 包源码、无关 package 及用户既有工作区改动未被修改。
