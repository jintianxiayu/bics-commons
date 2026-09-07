## 1. 公共类型与选项接口

- [x] 1.1 新增 `src/core/redis-cache-client.ts`，定义并完整注释 `RedisCacheClient`、`IoredisCacheClientSource`、`NodeRedisCacheClientSource` 与 `NodeRedisCacheClientOptions`，保持请求字段只读、客户端响应为 `unknown`、可选前缀缺省为空；完成条件：`pnpm --filter @jintianxiayu/cache-decorator typecheck` 通过且生成声明不引用第三方客户端类型。
- [x] 1.2 新增严格类型夹具和 `test/redis-cache-client-types.test.ts`，覆盖 C01、C02、C03、C04 的自定义实现、两种真实客户端正例及旧裸客户端、无参、空值、缺字段、错误工厂配对负例；完成条件：测试通过且正例不使用 `any`、双重断言或 `skipLibCheck`。

## 2. RedisCacheProvider 核心语义

- [x] 2.1 将 `RedisCacheProvider` 构造改为必填 `RedisCacheClient`，实现客户端无关的 GET、字符串/JSON 序列化、cache miss、TTL `undefined/0` 缺省及正整数校验；完成条件：源码不再 import、构造或引用 ioredis，受支持数据的 key/value/TTL 协议保持不变。
- [x] 2.2 新增 `test/redis-cache-provider.test.ts` 的读写与错误用例，逐项覆盖 V01、V03、V04、V06、V07、V08、E01、E02、E04；完成条件：断言命令参数、无写入失败路径、原始错误对象及 `TypeError/RangeError`，且目标测试通过。
- [x] 2.3 在 Provider 中用 `deleteMany`、`scan` 与 `flushDatabase` 实现精确删除、`SCAN COUNT 100` 多页 pattern 删除和数据库级清理，空页继续、空 key 批次不发 DEL、失败停止并传播；完成条件：没有 KEYS、客户端分支或前缀逻辑进入 Provider。
- [x] 2.4 扩充 Provider 与现有 Memory Provider 测试，覆盖 R01、R02、现有三个 pattern 场景、F04、F09，并验证删除计数、游标顺序、重复 key、部分失败和非匹配 key；完成条件：相关测试名称可回指 capability/Scenario 且目标测试通过。

## 3. ioredis 与 node-redis 适配器

- [x] 3.1 新增内部 Redis glob 字面前缀转义/剥离辅助逻辑和 `src/adapters/ioredis-cache-client.ts`，映射 GET、SET/SETEX、DEL、tuple SCAN、FLUSHDB，读取连接 `keyPrefix` 并保留方法调用上下文；完成条件：适配器不连接、关闭、重配连接，也不修改请求。
- [x] 3.2 新增 `test/ioredis-cache-client.test.ts`，覆盖 A01、A02、A05、A06、A07、A08、F05、F06 的正常命令、空批次、非标准响应、普通/特殊前缀和冻结请求；完成条件：目标测试通过且每项断言实际 ioredis 参数形状。
- [x] 3.3 新增 `src/adapters/node-redis-cache-client.ts`，映射 GET、SET/SETEX、数组 DEL、对象 SCAN、FLUSHDB，并在 `NodeRedisCacheClientOptions.keyPrefix` 缺省和显式场景下统一物理 key；完成条件：返回 `RedisCacheClient`、不 import node-redis 且不改变调用方连接生命周期。
- [x] 3.4 新增 `test/node-redis-cache-client.test.ts`，覆盖 A03、A04、A05、A06、A07、A08、F07、F08 的正常命令、空批次、非标准响应、缺省/显式前缀和冻结请求；完成条件：目标测试通过且每项断言实际 node-redis 参数与对象响应形状。

## 4. 对外封装、生命周期与导出面

- [x] 4.1 更新 `src/index.ts` 导出六项新增公共 API 和修改后的 Provider 构造声明，保留全部既有导出；完成条件：构建后的入口可导入新旧导出，生成 `.d.ts` 与 design 公共签名一致。
- [x] 4.2 更新 cache-decorator 包清单：ioredis 移入 `devDependencies`，新增 node-redis 5.x 开发依赖并同步 `pnpm-lock.yaml`，不声明二者为 dependency 或 peerDependency；完成条件：`pnpm install --lockfile-only` 无非目标 importer 变化，包构建与类型检查通过。
- [x] 4.3 新增 `test/redis-cache-decorator.test.ts`，使用适配后的 fake 客户端验证注册表及 legacy 装饰器兼容性 D01、D02，包括默认 Provider、显式 `providerName`、key、业务返回值和既有调用顺序；完成条件：不为通过测试而修改装饰器元数据、请求合并或异步写删时序。
- [x] 4.4 新增 `test/redis-cache-client-lifecycle.test.ts`，覆盖 O01、O02 的构造/注册零副作用、多个 Provider 共享连接及命令失败后连接仍可由调用方使用；完成条件：connect、quit、disconnect、close、destroy、options 和监听器断言全部通过。

## 5. 真实 Redis 与包消费验证

- [x] 5.1 新增只接受 `CACHE_DECORATOR_TEST_REDIS_URL` 的专用 Redis 测试夹具和 `0.1.3` 数据写入 helper，由测试建立并关闭 ioredis/node-redis 连接、生成唯一 key，并在数据库级 clear 场景使用明确隔离的测试数据库；完成条件：无环境变量时套件明确跳过，绝不回退到默认或生产连接。
- [x] 5.2 新增 `test/redis-cache-client.integration.test.ts`，在真实 Redis 上覆盖 V02、V05、V06、R03、R04、E05、I01、I02、I03、现有 Redis SCAN 场景以及 F05、F07、F08 的双向读写、TTL、并发覆盖、全库清理、断连、旧数据和等价前缀；完成条件：两个客户端均实际执行命令，未提供 Redis 环境时不得把相应验收任务标为完成。
- [x] 5.3 新增 workspace 外 tarball 消费测试工具，创建无客户端、仅 ioredis、仅 node-redis 三个隔离项目，禁用 `NODE_PATH` 和 workspace node_modules 继承，并从 README 提取快速开始示例参与严格编译；完成条件：每个项目的安装树、入口、声明和运行结果可独立检查。
- [x] 5.4 新增 `test/redis-cache-package.integration.test.ts`，逐项覆盖 P01、P02、P03、P04 的客户端缺失、单客户端安装、真实运行、清单/JavaScript/`.d.ts` 泄漏检查；完成条件：`skipLibCheck: false` 下通过，发布包不因适配工厂导出而加载未安装客户端。

## 6. 文档、变更记录与发布准备

- [x] 6.1 更新 `packages/cache-decorator/README.md`，分别给出 ioredis/node-redis 安装、连接、适配、注册和关闭示例，说明自定义 `RedisCacheClient`、前缀、数据兼容、异常、首版支持范围与 `clear()` 全库风险，并把现有 TTL 示例从 `60000` 秒修正为与文案一致的 `60` 秒；完成条件：示例由包消费测试提取编译且 README 格式检查通过。
- [x] 6.2 新增只包含 `@jintianxiayu/cache-decorator` 的 minor changeset，记录破坏性构造迁移和运行时依赖隔离，不直接修改其他包版本或执行发布；完成条件：`pnpm run release:status` 只计划本包从 `0.1.3` 升至 `0.2.0`。
- [ ] 6.3 记录外部消费者盘点结果和发布前通知检查点，至少覆盖构造包装、直接客户端依赖、keyPrefix、连接关闭和回退到 `0.1.3`；完成条件：维护者确认已知下游名单与通知时点，未确认前不执行本地正式发布。

## 7. Scenario 映射与最终验证

- [x] 7.1 按下表核对每个 delta spec Scenario 均至少对应一个同 ID 或逐字标题的自动化测试，使用脚本或可复现命令提取 `#### Scenario:` 与测试名并报告缺失/重复映射；完成条件：49 个 Scenario 无遗漏，非自动化项必须另获用户明确确认，不能以 `openspec validate --strict` 代替覆盖检查。
- [x] 7.2 运行 cache-decorator 聚焦验证：`pnpm --filter @jintianxiayu/cache-decorator test -- --runInBand --no-cache`、`pnpm --filter @jintianxiayu/cache-decorator typecheck` 及真实 Redis/包消费测试；完成条件：全部通过且 Redis 场景没有跳过。
- [x] 7.3 运行全仓库 `pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm test`；完成条件：全部通过，不修改测试或配置来掩盖实现失败。
- [x] 7.4 运行 `openspec validate decouple-redis-cache-client --strict`、`git diff --check` 并审查完整 diff/状态；完成条件：OpenSpec 严格校验通过，`src/index.ts`、README、changeset 和锁文件均已同步，且未暂存或改动范围外文件。

### Scenario-to-test mapping

| Capability                    | Scenario                              | 主要测试文件                                                                | 验证重点                           |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| redis-cache-client            | C01                                   | `redis-cache-client-types.test.ts`                                          | 自定义最小客户端正例               |
| redis-cache-client            | C02                                   | `redis-cache-client-types.test.ts`                                          | 真实 ioredis 类型正例              |
| redis-cache-client            | C03                                   | `redis-cache-client-types.test.ts`                                          | 真实 node-redis 类型正例           |
| redis-cache-client            | C04                                   | `redis-cache-client-types.test.ts`                                          | 旧构造、空值、缺字段和错误配对负例 |
| redis-cache-client            | V01                                   | `redis-cache-provider.test.ts`                                              | null 映射为 undefined              |
| redis-cache-client            | V02                                   | `redis-cache-client.integration.test.ts`                                    | JSON 类型跨客户端读取              |
| redis-cache-client            | V03                                   | `redis-cache-provider.test.ts`                                              | 非 JSON 与空字符串                 |
| redis-cache-client            | V04                                   | `redis-cache-provider.test.ts`                                              | JSON 文本字符串的兼容解析          |
| redis-cache-client            | V05                                   | `redis-cache-client.integration.test.ts`                                    | 正整数秒级 TTL                     |
| redis-cache-client            | V06                                   | `redis-cache-provider.test.ts`、`redis-cache-client.integration.test.ts`    | 缺省与零 TTL                       |
| redis-cache-client            | V07                                   | `redis-cache-provider.test.ts`                                              | 循环引用和无字符串序列化结果       |
| redis-cache-client            | V08                                   | `redis-cache-provider.test.ts`                                              | 特殊逻辑 key 原样下传              |
| redis-cache-client            | A01                                   | `ioredis-cache-client.test.ts`                                              | ioredis SET                        |
| redis-cache-client            | A02                                   | `ioredis-cache-client.test.ts`                                              | ioredis SETEX                      |
| redis-cache-client            | A03                                   | `node-redis-cache-client.test.ts`                                           | node-redis SET                     |
| redis-cache-client            | A04                                   | `node-redis-cache-client.test.ts`                                           | node-redis SETEX                   |
| redis-cache-client            | A05                                   | `ioredis-cache-client.test.ts`、`node-redis-cache-client.test.ts`           | GET string/null 响应               |
| redis-cache-client            | A06                                   | `ioredis-cache-client.test.ts`、`node-redis-cache-client.test.ts`           | DEL/FLUSHDB 与空批次               |
| redis-cache-client            | A07                                   | `ioredis-cache-client.test.ts`、`node-redis-cache-client.test.ts`           | this 与冻结请求                    |
| redis-cache-client            | A08                                   | `ioredis-cache-client.test.ts`、`node-redis-cache-client.test.ts`           | 非标准响应 TypeError               |
| redis-cache-client            | R01                                   | `redis-cache-provider.test.ts`                                              | 重复删除                           |
| redis-cache-client            | R02                                   | `redis-cache-provider.test.ts`                                              | 顺序覆盖值和 TTL                   |
| redis-cache-client            | R03                                   | `redis-cache-client.integration.test.ts`                                    | 并发写入无额外锁或重试             |
| redis-cache-client            | R04                                   | `redis-cache-client.integration.test.ts`                                    | 重复 FLUSHDB 与非缓存 key          |
| redis-cache-client            | E01                                   | `redis-cache-provider.test.ts`                                              | GET 原始错误不是 miss              |
| redis-cache-client            | E02                                   | `redis-cache-provider.test.ts`                                              | SET 原始错误传播                   |
| redis-cache-client            | E03                                   | `redis-cache-provider.test.ts`                                              | 删除与清库原始错误传播             |
| redis-cache-client            | E04                                   | `redis-cache-provider.test.ts`                                              | 非法 TTL RangeError 且零命令       |
| redis-cache-client            | E05                                   | `redis-cache-client.integration.test.ts`                                    | 断连无替代连接或降级               |
| redis-cache-client            | I01                                   | `redis-cache-client.integration.test.ts`                                    | ioredis 写、node-redis 读          |
| redis-cache-client            | I02                                   | `redis-cache-client.integration.test.ts`                                    | node-redis 写、ioredis 读          |
| redis-cache-client            | I03                                   | `redis-cache-client.integration.test.ts`                                    | 0.1.3 数据读取                     |
| redis-cache-client            | O01                                   | `redis-cache-client-lifecycle.test.ts`                                      | 构造注册零生命周期副作用           |
| redis-cache-client            | O02                                   | `redis-cache-client-lifecycle.test.ts`                                      | 多 Provider 共享连接               |
| redis-cache-client            | P01                                   | `redis-cache-package.integration.test.ts`                                   | 无客户端消费项目                   |
| redis-cache-client            | P02                                   | `redis-cache-package.integration.test.ts`                                   | 仅 node-redis 消费项目             |
| redis-cache-client            | P03                                   | `redis-cache-package.integration.test.ts`                                   | 仅 ioredis 消费项目                |
| redis-cache-client            | P04                                   | `redis-cache-package.integration.test.ts`                                   | 清单、入口和声明隔离               |
| redis-cache-client            | D01                                   | `redis-cache-decorator.test.ts`                                             | 默认 Provider 装饰器兼容           |
| redis-cache-client            | D02                                   | `redis-cache-decorator.test.ts`                                             | 显式 providerName 兼容             |
| cache-evict-allentries-prefix | pattern 末尾 * 作为前缀匹配           | `redis-cache-provider.test.ts`                                              | 逻辑前缀 pattern                   |
| cache-evict-allentries-prefix | MemoryCacheProvider 实现前缀匹配      | `native-cache.test.ts`                                                      | Memory 前缀删除                    |
| cache-evict-allentries-prefix | RedisCacheProvider 使用 SCAN 迭代删除 | `redis-cache-provider.test.ts`、`redis-cache-client.integration.test.ts`    | SCAN COUNT 100 至游标归零          |
| cache-evict-allentries-prefix | F04                                   | `redis-cache-provider.test.ts`                                              | 多页、空页和重复 key               |
| cache-evict-allentries-prefix | F05                                   | `ioredis-cache-client.test.ts`、`redis-cache-client.integration.test.ts`    | ioredis 普通 keyPrefix             |
| cache-evict-allentries-prefix | F06                                   | `ioredis-cache-client.test.ts`                                              | 特殊 glob 字符前缀转义             |
| cache-evict-allentries-prefix | F07                                   | `node-redis-cache-client.test.ts`、`redis-cache-client.integration.test.ts` | node-redis 缺省前缀                |
| cache-evict-allentries-prefix | F08                                   | `node-redis-cache-client.test.ts`、`redis-cache-client.integration.test.ts` | node-redis 显式前缀                |
| cache-evict-allentries-prefix | F09                                   | `redis-cache-provider.test.ts`                                              | SCAN/DEL 失败停止并传播            |
