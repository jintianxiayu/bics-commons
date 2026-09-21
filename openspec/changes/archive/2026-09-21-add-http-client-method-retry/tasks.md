## 1. 依赖和公开配置契约

- [x] 1.1 在 HTTP 子包添加 `axios-retry: ^4.5.0` 运行时依赖并更新 pnpm 锁文件；通过依赖安装及 `pnpm --filter @jintianxiayu/http-client-decorator exec node -e "console.log(require('axios-retry/package.json').version)"` 确认实际解析版本和 Axios peer 兼容，不改其他包依赖。
- [x] 1.2 新增并从包根导出 `HttpMethodOptions`，其 `retry` 直接使用 `IAxiosRetryConfig`；五个方法装饰器增加可选第二参数，保持 legacy decorators 和旧单参数用法，通过装饰器用例验证声明阶段不执行请求或重试回调。
- [x] 1.3 扩展 `MethodMetadata` 的可选 `options`，保持既有 Symbol 键与旧 `{ method, path }` 形状；在 `decorators.test.ts` 验证新配置可读取、旧元数据不多出空字段、配置中没有请求运行状态。
- [x] 1.4 增加通过公共入口使用五种装饰器及全部重试字段的类型正例，以及错误 `retries` 类型、错误条件返回类型、运行状态字段的 `@ts-expect-error` 负例；通过显式 `tsc --noEmit` 测试类型检查验证，不能只依赖 isolatedModules 下的 Jest 结果。

## 2. 客户端实例与调用状态

- [x] 2.1 将发送函数创建移动到对象代理创建阶段，在工厂内通过 `axios.create()` 创建私有实例并仅注册一次插件；验证同一对象跨方法及重复属性读取复用一个实例，同一类的两个对象各自独立，原装饰方法体仍不执行。
- [x] 2.2 仅移除私有实例继承的 `defaults['axios-retry']`，保持其他 defaults 的原生继承规则且不修改宿主；验证宿主预设次数、条件、响应判定及 hooks 无法改变子包未配置/空对象的策略，宿主配置保持原值。
- [x] 2.3 添加创建前/后宿主 request/response 拦截器、普通 timeout/headers 及可变引用的边界测试；验证拦截器不继承、创建前普通值可继承、后续普通修改双向独立，记录 Agent/闭包等共享引用和空 headers 不清空的限制。
- [x] 2.4 每次调用独立构建请求及重试配置；验证同一方法并发、不同方法并发、不同对象和失败后再次调用的次数与时间状态独立，原 options、metadata 不出现运行计数或 hook 修改过的请求字段。

## 3. 重试接入与响应兼容

- [x] 3.1 按设计映射请求级 `'axios-retry'`：未配置为新 `{ retries: 0 }`，空对象保持空对象，显式字段浅复制透传；用真实插件验证未配置/空方法选项/undefined/零次各一次，GET 空 retry 持续 503 共四次，`retries: 2` 最多三次及提前成功/条件拒绝。
- [x] 3.2 将默认响应成功范围前移为 `< 400`，去掉成功分支中的固定错误状态拒绝；验证默认 2xx/3xx、`validateResponse: null` 的 304、自定义接受 503、自定义拒绝 200 后允许或禁止重试的各条路径。
- [x] 3.3 保持最终错误转换：HTTP 响应错误保留 status/data 和 `HTTP ${status}: ${url}`，无响应 Axios 错误保持 status 0，已有 HttpError 与普通异常原样传播；保留现有 404 消息断言，并覆盖重试耗尽后的最终响应和 hook 普通异常身份。
- [x] 3.4 透传同步/异步条件、延迟、超时重置及两个生命周期回调，不额外包裹业务策略；用受控 adapter/时钟验证实际等待、有效 timeout 扣减与重置、预算不足停止、hook 被等待与原生触发时机，并比较内置/自定义延迟对 Retry-After 的处理。

## 4. 实际传输与现有行为回归

- [x] 4.1 调整 `integration.test.ts`、`proxy.test.ts`、`builtin-middlewares.test.ts` 的默认 Axios mock 以匹配实例创建；运行这些测试确认 Path/Query/Header/Body、返回数据、非装饰方法及 middleware 原有断言继续成立。
- [x] 4.2 新增本地 HTTP 集成用例，实际发送并验证 503 后成功、持续失败次数、404 错误、显式接受 503，以及可重放 JSON 内容不被重复序列化；不使用公网，确保服务和连接在结束时关闭，不增加流缓存实现。
- [x] 4.3 覆盖 tracing → debug → 用户 middleware 顺序及重试期间只执行一轮外层 middleware、provider 只调用一次、debug 仅输出初始请求与最终结果且 duration 包含等待；覆盖 middleware 短路时没有任何 HTTP 尝试。
- [x] 4.4 先运行 `pnpm --filter @jintianxiayu/http-client-decorator test`，再运行 `pnpm test`、`pnpm run build`、`pnpm run lint`、`pnpm run format:check`；记录真实结果和既有失败基线，不为本变更修复无关历史问题。
- [x] 4.5 检查构建后的公共声明及安装消费行为：调用方只依赖本子包即可使用 `HttpMethodOptions` 和装饰器类型；在隔离消费目录执行类型检查，确认插件属于正常传递安装依赖，无需额外配置 peer 或使用内部路径。

## 5. 文档和发布记录

- [x] 5.1 更新子包 README 的方法签名、完整透传用法、默认关闭/空对象/零次规则及响应判定；核对示例与类型测试一致，并明确原生 POST 网络错误策略、超时预算、hook 异常、Retry-After 自定义延迟及不可重放请求体边界。
- [x] 5.2 添加部分隔离的边界说明，描述宿主拦截器与创建后 defaults 变化不再自动作用于子包、创建前默认值及共享引用仍可能保留，以及重试命名空间的来源限定；与两个 delta spec 逐项核对，明确既有公开 API 无需迁移，避免“完全隔离”或“关闭 retry 恢复旧共享行为”的误导。
- [x] 5.3 按 `1.0.0` 到 `1.1.0` 的计划，通过仓库发布工作流记录 HTTP 子包 minor 变更，说明兼容的重试能力扩展、新增依赖、公共类型和部分隔离边界；用 `pnpm run release:status` 核对计划，不在实施任务中直接发布，不增加下游迁移确认前置条件。
- [x] 5.4 完成代码后按两个 delta spec 逐项核对验收覆盖并复查变更范围；运行 `openspec validate add-http-client-method-retry --strict`，确认只涉及本包相关代码、测试、文档、依赖和发布记录。
