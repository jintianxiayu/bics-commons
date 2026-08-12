## Context

参见 [proposal.md](./proposal.md) 的问题背景和 [logger-lifecycle spec](./specs/logger-lifecycle/spec.md) 的行为契约。当前 `LoggerFactory` 使用 `isShuttingDown` boolean 阻止重复执行，但第二个 `shutdown()` 会立即完成，无法等待首个关闭；`Promise.race` 创建的 timeout 在容器先关闭时不会取消；完成路径也没有清理 `wrapperCache` 和 `ConfigLoader`。

信号处理器由每次 `setupShutdownHandlers()` 直接调用 `process.on()` 注册匿名函数，工厂无法判断重复注册或精确移除自己的 listener。实现需要保持现有公开方法签名、不引入依赖，并兼容 Winston container 的同步抛错或异步拒绝。

## Goals / Non-Goals

**Goals:**

- 用单一共享 Promise 表达一轮关闭，使所有并发调用方获得一致结果。
- 保证正常、timeout、底层错误及回调错误的所有终止分支都会恢复可重建状态。
- 精确管理关闭 timeout 和 LoggerFactory 自己注册的 process listener。
- 通过生命周期状态守卫阻止关闭期间创建或返回 logger。
- 使用 fake timer 与可控 close Promise 对每个异步分支进行确定性测试。

**Non-Goals:**

- 不保证调用方在关闭前保存的旧 wrapper 在关闭完成后继续可用；调用方必须重新调用 `getLogger()`。
- 不改变日志刷盘能力或 Winston transport 自身的 close 语义。
- 不增加动态配置重载、自动重试关闭或新的公开 handler disposal API。
- 不处理 meta 序列化、LogPosition、脱敏及日志格式问题。
- 不改变 timeout 先到达时 `shutdown()` 正常完成的兼容行为。

## Decisions

### Decision 1: 以共享 Promise 表示关闭轮次

使用 `shutdownPromise: Promise<void> | null` 取代仅能表达 boolean 的关闭控制。首个调用创建完整关闭 Promise 并保存；后续调用直接返回/采用该 Promise 的结果，不再启动关闭逻辑。

首个调用的 `timeout` 和 `onShutdown` 被快照到该关闭轮次。后续调用的 options 被忽略，避免一次关闭同时出现多个 deadline 或重复退出回调。关闭 Promise settle 后才将 `shutdownPromise` 清空，允许下一轮关闭。

替代方案：保留 boolean 并让后续调用轮询。轮询会引入额外 timer、错误传播不一致和竞态，因此不采用。

### Decision 2: 使用可清理 timeout 包装底层 close

关闭开始时快照当前 container，并将其 close 结果规范化为 Promise。race 使用唯一 timeout handle，所有路径在 `finally` 中 `clearTimeout`：

```text
close 先完成 ─┐
close 拒绝 ───┼─→ clear timeout → 清理工厂状态 → 执行一次回调 → settle
timeout 到达 ─┘
```

timeout 先完成时，底层 close Promise 仍附带 rejection observer，防止稍后拒绝成为 unhandled rejection；工厂不继续等待它。timeout 不调用 `unref()`，因为在确实依赖 deadline 完成关闭且 event loop 没有其他 handle 时，unref 会让进程在关闭契约完成前退出。

替代方案：仅对 timeout 调用 `unref()`。这可以掩盖 Jest open handle，但不能取消无效计时器，也会削弱等待 timeout 的语义，因此不采用。

### Decision 3: 将状态清理与用户回调分离

内部清理固定在用户回调之前执行，并覆盖 close 成功、timeout 和 close 错误：container 置空、initialized 复位、wrapper cache 清空、ConfigLoader reset、关闭状态恢复。之后最多执行一次首个调用的 `onShutdown`。

错误优先级如下：底层 close 错误是主错误；若 close 成功而回调抛错，则以回调错误 reject。即使回调抛错，内部状态也已经可重新初始化。若 close 和回调都抛错，保留 close 错误，并将回调错误作为诊断信息记录或关联，避免掩盖资源关闭失败。

替代方案：把回调放在清理前并依赖普通顺序执行。`process.exit()` 或抛错会跳过缓存和状态复位，不满足可重建要求，因此不采用。

### Decision 4: 关闭期间统一拒绝 init 与 getLogger

`init()` 和 `getLogger()` 在任何配置加载或 cache lookup 之前检查 `shutdownPromise`。处于关闭状态时抛出带稳定信息的普通 `Error`（例如 `LoggerFactory is shutting down`），不新增公共错误类型。

统一拒绝已有和新名称，避免调用方拿到绑定正在 close 的 transport 的 wrapper。关闭完成后 guard 自动解除，下一次调用走现有初始化路径。

替代方案：只允许返回缓存 wrapper。底层 transport 已进入关闭过程，继续写入是否成功依赖 Winston 时序，无法给出可靠契约，因此不采用。

### Decision 5: 关闭完成时使所有工厂缓存失效

状态清理必须同时处理 `container`、`wrapperCache`、`initialized` 和 `ConfigLoader`，包括 no-op wrapper。这样相同名称在重建后获得新 wrapper，并重新读取当前配置。

外部已经保存的旧 wrapper 无法被工厂回收，本次不为 wrapper 增加 generation guard；README 明确关闭后应重新获取 logger。

替代方案：只清理 container。wrapper 闭包仍引用旧 Winston logger，会让重新获取同名 logger 返回失效对象，因此不采用。

### Decision 6: 用信号到 handler 的 Map 管理所有权

维护 `Map<string, () => void>` 记录 LoggerFactory 实际注册的 listener。`setupShutdownHandlers()` 对 Map 中已有信号 no-op，只为新信号创建 handler，因此部分重叠集合也不会重复注册。

任一 handler 触发时先调用私有 `removeShutdownHandlers()`，通过 `process.off(signal, exactHandler)` 精确移除 Map 中全部工厂 listener，再启动一次 shutdown 并在完成后请求 `process.exit(0)`。`reset()` 也调用相同清理函数，绝不使用 `removeAllListeners`，避免影响应用 listener。

同一信号后续注册的新 options 不覆盖首次 handler 捕获的 options；这是 proposal 中“首次注册决定已注册信号行为”的确定性规则。

替代方案：改用 `process.once()`。它只能解决单个信号重复触发，无法防止多次 setup 注册多个 once listener，也不能清理另一个已注册信号，因此不单独采用。

### 模块、依赖与职责

| 模块 | 功能 | 依赖关系 |
| --- | --- | --- |
| `LoggerFactory` 生命周期状态 | 保存共享 shutdown Promise、守卫 init/getLogger、编排所有终止路径 | Winston container、ConfigLoader、wrapper cache |
| `LoggerFactory` timer helper | 规范化 close/timeout race 并始终释放 timeout handle | Node.js timer API |
| `LoggerFactory` signal registry | 去重 process listener、精确移除自有 listener、触发关闭与退出 | Node.js process API、shutdown 状态 |
| `ConfigLoader` | 在每轮关闭结束时清空配置，重建时重新加载 | 由 LoggerFactory 调用，模块本身无需改变 |
| `LoggerFactory` 测试 | 以 fake timer、deferred Promise 和 process spy 验证全部分支 | Jest、LoggerFactory |
| README/demo | 说明关闭期间拒绝访问、并发等待与关闭后重新获取 | 已实现的公开 API |

### API 与参数行为

| API/参数 | 类型 | 必填 | 默认值 | 生命周期语义 |
| --- | --- | ---: | --- | --- |
| `shutdown(options?)` | `(ShutdownOptions?) => Promise<void>` | 否 | 空选项 | 首个调用启动关闭；同轮后续调用等待相同结果 |
| `options.timeout` | `number` | 否 | `5000` ms | 仅首个调用生效；到期后关闭 Promise 正常完成 |
| `options.onShutdown` | `() => void` | 否 | 无 | 状态清理后每轮最多执行一次；抛错会 reject |
| `setupShutdownHandlers(options?)` | `(ShutdownOptions?) => void` | 否 | 空选项 | 只为尚未注册的信号添加 handler |
| `options.signals` | `string[]` | 否 | `SIGTERM`, `SIGINT` | 每个信号最多一个工厂 handler；已注册信号首组选项生效 |
| `init()` | `() => void` | 否 | 无 | 关闭期间抛出生命周期错误，关闭后可重新执行 |
| `getLogger(name)` | `(string) => LoggerInterface` | 是 | 无 | 关闭期间拒绝；关闭后相同名称返回全新 wrapper |

不涉及 HTTP/REST API、数据库模型、Entity 字段、索引或迁移。

### 测试矩阵

| 模块 | 成功分支 | 失败/边界分支 |
| --- | --- | --- |
| 共享关闭 | 单调用完成、两个并发调用共同完成、空闲重复关闭 | 后续调用不同 timeout/callback、close reject 的相同错误传播 |
| timer 管理 | close 先完成即 clearTimeout | timeout 先完成、close 同步抛错、close 延迟 reject 无 unhandled rejection |
| 状态守卫 | 关闭后 init/getLogger 成功重建 | 关闭期间已有名/新名称 getLogger、关闭期间 init 均拒绝且无副作用 |
| 缓存重建 | 同名 logger 返回新 wrapper、新配置生效、no-op wrapper 失效 | close reject 后仍能重建、旧 wrapper 不进入新 cache |
| 回调 | 每轮回调一次且在清理后可重建 | 并发后续回调不执行、回调抛错向所有等待者传播且状态已清理 |
| 信号处理 | 默认信号、自定义信号、部分重叠集合只注册新增项 | 重复 setup 不增加 listener、任一信号触发清理全部自有 handler、reset 保留外部 listener |

## Risks / Trade-offs

- [关闭期间原本可能偶然取得缓存 logger，现在会同步抛错] → README 明确先停止业务入口、再调用 shutdown 的顺序，并提供稳定错误信息便于诊断。
- [timeout 后底层 transport 可能仍在后台结束 close] → 工厂不再引用旧 container，并观察迟到的拒绝；调用方按 timeout 契约继续停机。
- [首个并发调用决定 options，后续回调不会执行] → 在文档中明确“每轮一次”语义，避免把 `onShutdown` 当作每调用订阅器。
- [测试修改全局 timer 和 process listener 容易污染其他套件] → 每个测试恢复 real timer、process spy 和工厂 handler，并由 afterEach 调用 reset。
- [回调可能调用 process.exit，导致后续语句不执行] → 所有内部状态和 listener 清理必须在回调前完成。

## Migration Plan

1. 先引入共享 shutdown Promise、状态守卫和统一状态清理，并用受控 container close 测试并发与错误分支。
2. 接入可清理 timeout，使用 Jest fake timer 验证早完成、超时和迟到拒绝。
3. 增加 wrapper/配置 cache 清理和关闭后重建测试。
4. 引入 signal registry 与精确移除 helper，覆盖重复、重叠和外部 listener 保留。
5. 更新 README/demo，发布 prerelease，在至少一个容器服务中验证 SIGTERM 日志刷盘与退出时长。
6. 若发生不可接受回归，回滚 logger 包版本；应用可临时停止使用自动 signal handler，改为在自身停机钩子中单次调用 `shutdown()`。
