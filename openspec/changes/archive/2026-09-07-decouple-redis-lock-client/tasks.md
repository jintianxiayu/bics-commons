## 1. 类型边界与测试依赖

- [x] 1.1 新增 `src/core/redis-lock-client.ts` 中的三个结构接口，按 design 的签名定义必填请求与只读数组；完成条件：本包 typecheck 通过，生成声明不引用第三方客户端类型。
- [x] 1.2 新增 `test/redis-lock-client-types.test.ts` 和类型夹具，验证 C02、C03 的真实实例对结构接口可赋值以及 C04 的必填字段约束；为本包增加 redis 5.x 开发依赖并记录锁定版本，完成条件：类型测试无 `any` 或规避断言通过。

## 2. Redis Provider 核心

- [x] 2.1 将 `RedisLockProvider` 构造和命令调用改为 `RedisLockClient`，保留 UUID、Lua、key 和 TTL 协议，并同步现有测试的 mock 边界；完成条件：既有 Provider 单元测试通过，源码中不再引用 ioredis 类型。
- [x] 2.2 补充 `test/redis-lock-provider.test.ts`，验证 C01、自定义客户端契约、L01–L09 的 Provider 可观察行为以及 E02、E03 的错误传播；完成条件：对应单元用例通过，返回数值 `1` 的成功判定和续期字符串参数有明确断言，真实 Redis 部分由第 4 组验收。

## 3. 内置适配工厂与流程回归

- [x] 3.1 实现 ioredis 工厂，保持绑定调用与只读请求，规范 SET 返回值并传播命令错误；完成条件：`test/ioredis-lock-client.test.ts` 中 A01、A02、A03、A07、A08 及 E02、E03 的 ioredis 参数化用例通过。
- [x] 3.2 实现 node-redis 工厂，转换命令选项和脚本键/参数数组；完成条件：`test/node-redis-lock-client.test.ts` 中 A04、A05、A06、A07、A08 及 E02、E03 的 node-redis 参数化用例通过。
- [x] 3.3 将 C02、C03 类型用例扩展到真实实例传入工厂并构造 Provider，补齐 C04 的旧构造和错误配对负向夹具；完成条件：每个正向夹具编译成功，每个负向夹具产生预期类型错误，未使用的错误预期会使测试失败。
- [x] 3.4 新增 `test/redis-lock-client-lifecycle.test.ts` 验证 O01、O02 的连接调用、配置、监听器与共享连接约束；完成条件：成功和拒绝路径均不触发连接创建、连接关闭或配置修改。
- [x] 3.5 为 `test/distributed-lock.test.ts` 补齐 E01 与 D01–D04，复用现有 registry/watchdog 测试；完成条件：缺省参数、显式竞争重试、业务返回/异常、正常续期与释放、自定义 Provider 用法全部通过，不修改范围外的看门狗异常语义。

## 4. 真实 Redis 协议验证

- [x] 4.1 在 `test/redis-lock-client.integration.test.ts` 建立双客户端夹具，使用 `LOCK_DECORATOR_TEST_REDIS_URL`、唯一测试 key、有限等待和测试侧连接清理；完成条件：两类客户端能连接专用 Redis，失败或未配置环境会明确呈现，测试不清理无关 key。
- [x] 4.2 为每种客户端逐项执行 L01–L08，覆盖竞争、不重入、TTL、重复释放、错误 token、缺失 key、过期重获；完成条件：全部真实 Redis 用例通过，时间相关断言允许合理调度误差但能检测意外续期。
- [x] 4.3 为每种客户端验证 E04 的非法加锁 TTL 和 E05 的不可用连接；完成条件：实际命令拒绝且不返回 token，错误传播和有限失败时间有证据，不引入自动降级。
- [x] 4.4 执行 I01 双客户端并发竞争、I02 与旧协议双向互操作、I03 有效 key 前缀互操作，并验证 O02 共享连接在操作后仍可由调用方使用；完成条件：每个场景分别通过，旧协议夹具明确来源于变更前 `0.1.3` 的 SET/Lua 协议，不以新实现自我对照。

## 5. 公共入口与消费项目隔离

- [x] 5.1 同步 `src/index.ts` 的五项新增导出和 Provider 构造声明，移除 ioredis 运行时依赖并保留为开发依赖，更新本包相关锁文件条目；完成条件：P04 的入口/清单/声明检查通过，其余包依赖无意外变更。
- [x] 5.2 新增 `test/redis-lock-package.integration.test.ts`，构建打包本包并在 workspace 外建立三个临时消费项目，完成 P01、P02、P03、P04；完成条件：实际依赖树、运行时入口和 `skipLibCheck: false` 类型检查均通过，不借助 workspace node_modules 或 NODE_PATH。
- [x] 5.3 将包消费测试中的 ioredis 和 node-redis 运行用例接入专用测试 Redis，分别完成一次获取、续期和释放；完成条件：P02、P03 除构造和编译外还有实际运行证据，无 Redis 环境时不得勾选该项。

## 6. 使用文档与发布计划

- [x] 6.1 更新本包 README，给出两种客户端安装与注册、自定义 `RedisLockClient`、旧构造迁移、连接所有权、支持版本、有效 key 前缀和异常边界；完成条件：示例进入 C02/C03/P01–P03 的夹具校验，文档与新增导出一致。
- [x] 6.2 使用 pnpm 现有变更记录流程记录本包 minor，明确目标 `0.2.0`、构造签名和直接客户端依赖迁移，并记录下游盘点与通知时间点为发布准备事项；完成条件：`pnpm run release:status` 显示本包预期版本计划，未推进其他包版本，未执行 publish 或 tag。

## 7. 场景遗漏审计与最终验证

- [x] 7.1 按下表核对全部 39 个 Scenario 与实际测试用例，提取规格标识并与测试用例名称及执行结果比较；完成条件：没有缺失、重复冒充覆盖或只存在于注释中的标识，每个 WHEN/THEN/AND 均有对应准备、动作和断言，记录检查结果而非仅声称映射存在。
- [x] 7.2 运行受影响包测试及全仓库 `pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm test`；完成条件：所有命令通过，Redis 和消费项目验收没有未说明的跳过，报告实际版本与执行结果。
- [x] 7.3 运行本变更 OpenSpec strict 校验并检查最终 diff；完成条件：校验通过、公共入口及 README 已同步、改动仅包含本包所需实现/验证/发布记录和本 change，保留原有无关工作区修改。

## 8. Scenario 与测试用例映射

本节记录 2026-09-07 的场景映射与实际通过用例数。路径均相对于 `packages/lock-decorator/test/`。用例名称包含 `redis-lock-client/<Scenario ID>` 和场景中文标题；同一场景的双客户端或边界输入可以参数化展开，不得将不同 Scenario 合并成一个无法独立定位的用例。一个场景同时有单元与集成证据时列出两者，集成未执行不能由单元测试替代。

| Scenario | 对应测试文件 | 验证重点 | 通过用例数 |
| --- | --- | --- | --- |
| C01 | `redis-lock-provider.test.ts` | 自定义 Redis 操作对象完成三种锁操作 | 1 |
| C02 | `redis-lock-client-types.test.ts` | 真实 ioredis 类型传入工厂并构造 | 2 |
| C03 | `redis-lock-client-types.test.ts` | 真实 node-redis 类型传入工厂并构造 | 2 |
| C04 | `redis-lock-client-types.test.ts` | 旧签名、空值、缺失字段、错误配对逐项拒绝 | 1 |
| A01 | `ioredis-lock-client.test.ts` | NX/PX 参数与成功结果 | 1 |
| A02 | `ioredis-lock-client.test.ts` | null 竞争响应不重试 | 1 |
| A03 | `ioredis-lock-client.test.ts` | 脚本键数、顺序、空数组与原始响应 | 2 |
| A04 | `node-redis-lock-client.test.ts` | NX/PX 选项与成功结果 | 1 |
| A05 | `node-redis-lock-client.test.ts` | null 竞争响应不重试 | 1 |
| A06 | `node-redis-lock-client.test.ts` | 脚本选项、顺序、空数组与原始响应 | 2 |
| A07 | 两个 `*-lock-client.test.ts` | this 绑定与冻结请求不变性 | 2 |
| A08 | 两个 `*-lock-client.test.ts` | 异常 SET 响应拒绝为 TypeError | 10 |
| L01 | `redis-lock-provider.test.ts`、`redis-lock-client.integration.test.ts` | UUID、Redis 值和毫秒 TTL | 3 |
| L02 | `redis-lock-provider.test.ts`、`redis-lock-client.integration.test.ts` | 重复获取不更改值或延长 TTL | 3 |
| L03 | `redis-lock-provider.test.ts`、`redis-lock-client.integration.test.ts` | 释放与重复释放 | 3 |
| L04 | `redis-lock-provider.test.ts`、`redis-lock-client.integration.test.ts` | 错误 token 无法删除 | 3 |
| L05 | `redis-lock-provider.test.ts`、`redis-lock-client.integration.test.ts` | 正确续期、值不变 | 3 |
| L06 | `redis-lock-provider.test.ts`、`redis-lock-client.integration.test.ts` | 错误 token 无法延期 | 3 |
| L07 | `redis-lock-provider.test.ts`、`redis-lock-client.integration.test.ts` | 缺失 key 不会被释放或创建 | 3 |
| L08 | `redis-lock-provider.test.ts`、`redis-lock-client.integration.test.ts` | 旧 token 不影响过期后的新锁 | 3 |
| L09 | `redis-lock-provider.test.ts`、两个 `*-lock-client.test.ts` | 空 key、Unicode、1 毫秒与大整数透传 | 6 |
| E01 | `distributed-lock.test.ts` | 适配器命令拒绝贯穿 Provider 和装饰器 | 2 |
| E02 | 两个 `*-lock-client.test.ts`、`redis-lock-provider.test.ts` | 释放错误对象原样传播 | 3 |
| E03 | 两个 `*-lock-client.test.ts`、`redis-lock-provider.test.ts` | 直接续期错误对象原样传播 | 3 |
| E04 | `redis-lock-client.integration.test.ts` | 非法 TTL 由实际命令拒绝 | 8 |
| E05 | `redis-lock-client.integration.test.ts` | 不可用连接有界失败、没有新连接 | 2 |
| I01 | `redis-lock-client.integration.test.ts` | 两客户端同时竞争恰有一个成功 | 1 |
| I02 | `redis-lock-client.integration.test.ts` | 变更前协议与新协议双向兼容 | 2 |
| I03 | `redis-lock-client.integration.test.ts` | ioredis keyPrefix 与显式前缀对应 | 1 |
| O01 | `redis-lock-client-lifecycle.test.ts` | 构造注册无连接操作或监听器修改 | 2 |
| O02 | `redis-lock-client-lifecycle.test.ts`、`redis-lock-client.integration.test.ts` | 多 Provider 共用连接且调用方可继续使用 | 4 |
| P01 | `redis-lock-package.integration.test.ts` | 无客户端依赖的消费项目 | 1 |
| P02 | `redis-lock-package.integration.test.ts` | 仅 node-redis 的消费项目 | 2 |
| P03 | `redis-lock-package.integration.test.ts` | 仅 ioredis 的消费项目 | 2 |
| P04 | `redis-lock-package.integration.test.ts` | 清单、入口、声明与严格消费编译 | 1 |
| D01 | `distributed-lock.test.ts` | 缺省 key/TTL/续期/重试与正常完成 | 2 |
| D02 | `distributed-lock.test.ts` | 显式参数下竞争重试成功与耗尽 | 4 |
| D03 | `distributed-lock.test.ts` | 业务异常后正常释放并停止续期 | 2 |
| D04 | `distributed-lock.test.ts` | 既有自定义 LockProvider 回归 | 1 |

实际执行的 121 个用例全部通过、0 失败、0 跳过。审计从规格标题提取 39 个唯一 Scenario 标识，与 Jest JSON 中状态为 passed 的实际用例名称比较；缺失标识 0、未知标识 0、同文件同完整名称的重复用例 0。表中的数量包含双客户端、边界输入和单元/集成的分别执行，不将同一场景的展开次数视为不同 Scenario。

## 9. 验证记录（2026-09-07）

### 场景语义复核

- C01–C04：自定义命令对象实际完成三项锁操作；真实客户端实例及 README 原文通过严格编译。C04 独立列出 18 个无效调用，每项使用会检测未发生错误的 `@ts-expect-error`，覆盖缺字段、空客户端、旧构造与错误工厂配对。
- A01–A08：断言 NX/PX 参数、一次调用、键和参数顺序（含空数组）、原始脚本响应、this 绑定、冻结请求不变性和五类非标准 SET 响应的 TypeError。竞争后的实际值和 TTL 同时由 L02 集成验证。
- L01–L09：两种客户端分别在真实 Redis 上核对 UUID v4、值、PTTL、竞争不覆盖/延期、重复释放、错误 token、缺失 key 以及过期后新锁不受旧 token 影响；TTL 断言允许调度误差但禁止意外延期。边界 key 和 1/2147483648 毫秒由 Provider 与两个适配器逐层断言原样传递，脚本成功仅接受数值 1。
- E01–E05：设锁错误贯穿适配器、Provider 和装饰器，保持同一错误对象、只调用一次且不执行业务；释放及直接续期拒绝同样保留错误对象。两种客户端各自执行四个非法 TTL 与关闭连接的真实失败，断言无 key、无 token、失败时间有界且不新建连接。
- I01–I03：10 轮双客户端同时竞争均恰有一个持有者；使用变更前 0.1.3 / 399935812f4aeefaaf38671467459786737ffa67 的独立协议夹具执行新旧双向互斥和正确 token 操作；真实 keyPrefix/显式前缀用例核对最终同键的互斥、释放和续期。
- O01–O02：构造注册检查配置对象、监听器与连接调用；共享连接的成功及错误路径不关闭连接，真实 Redis 操作后应用仍可 PING。夹具还验证只删除自身分配的 key。
- P01–P04：从当前源码构建并实际打包，在 workspace 外创建三个临时项目并独立安装，清除 NODE_PATH 等 workspace 环境；检查生产依赖树、干净 Node 子进程解析、运行入口以及 skipLibCheck=false 编译。三个 README 示例原文随项目编译；仅安装一种客户端的项目另行运行真实获取、续期、释放与 PING。检查 tarball 的清单、全部 dist JavaScript 和声明，保留既有导出且无第三方客户端加载或类型泄漏。
- D01–D04：通过两个适配器分别执行缺省 key/TTL/续期间隔/零重试，验证相同 token 的续期、业务返回及最终清理；显式重试验证次数与间隔、成功只执行业务一次和耗尽不执行业务；业务拒绝保留原异常并正常释放；既有自定义 LockProvider 无新增适配要求。

### 执行环境与命令

- Windows；Node.js 24.12.0、pnpm 11.22.0、TypeScript 6.0.3、Jest 29.7.0、OpenSpec 1.12.0。
- 真实客户端：ioredis 5.11.0、redis 5.12.1；专用临时 Redis 7.4.2 单实例。使用 LOCK_DECORATOR_TEST_REDIS_URL 显式传入本机连接，本次 Redis 用例没有跳过。
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`：退出码 0。
- `pnpm --filter @jintianxiayu/lock-decorator test -- --runInBand --json --outputFile <临时结果路径>`：10 套件、121 用例全部通过。随后读取实际 assertionResults 的 fullName/status 做上述 39 个标识的差集与重复审计，没有以源文件注释或规格格式校验替代执行证据。
- `pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm test`：最终均退出码 0。全仓共 33 套件、247 用例通过（cache 39、lock 121、logger 49、http-client 38）。使用当前 pnpm 的 pnpm_config_workspace_concurrency=1 按包运行。
- 前期并行全测曾遇到既有 logger 文件轮转测试的时序波动；该用例单独运行及最终按包运行均通过，未改动 logger 实现或测试。
- 新增/涉及的 17 个 TypeScript 文件进行 AST 检查，未发现超过 200 行或超过 4 个形参的函数；公共类型与生产入口由严格编译及消费测试共同验证。

### 发布准备

`pnpm change` 生成 `.changeset/stale-tires-pull.md`；`pnpm run release:status` 仅计划本包从 0.1.3 升至 0.2.0（minor）。当前包版本未推进，未执行 publish 或 tag。维护者需在实际发布前补充外部消费者名单，并通知客户端直接依赖与构造签名迁移；此事项不等于已经通知下游。

`openspec validate --strict` 仅验证规格结构，场景覆盖依据以上独立执行和语义复核。

### 最终范围检查

本 change 的 `openspec validate decouple-redis-lock-client --type change --strict --json` 通过，issues 为空；目标文件的 `git diff --check` 通过。生产改动限于 lock-decorator 的新接口、两个适配工厂、RedisLockProvider、入口及依赖；其余变更为相应测试、README、本 change 和本包 minor 发布记录。原有 `openspec/config.yaml`、`.agents/`、`AGENTS.md` 和 `openspec/config.template.yaml` 工作区内容保持原样，未暂存或提交。
