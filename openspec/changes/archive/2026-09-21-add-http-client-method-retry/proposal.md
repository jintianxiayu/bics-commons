## Why

`http-client-decorator` 当前直接使用 Axios 默认实例，既没有内建重试能力，也可能与宿主共享拦截器和默认配置。需要让各 HTTP 方法独立声明重试策略，并通过子包管理的 Axios 实例减少相互影响，同时保持实现为对成熟重试库的配置透传。

## What Changes

- 每个 `@HttpClient` 对象持有一个通过 `axios.create()` 创建的实例，同一对象的方法复用该实例；宿主默认 Axios 实例的拦截器不再作用于这些请求。
- 明确部分隔离边界：创建时仍继承已有 Axios 默认配置，部分非普通对象和函数引用仍可能共享；创建后的普通配置修改及拦截器注册相互独立。
- 为 `Get`、`Post`、`Put`、`Delete`、`Patch` 增加可选的第二个参数 `HttpMethodOptions`，其中 `retry?: IAxiosRetryConfig` 直接使用 `axios-retry` 的公开类型，完整透传公开配置项。
- 未配置 `retry` 时不重试；`retry: {}` 使用插件默认配置；`retry: { retries: 0 }` 不重试。每次调用独立保存重试运行状态。
- 适配响应判定，使 HTTP 失败可以进入重试插件，并尊重调用者的 `validateResponse`；默认成功范围、返回数据及最终 HTTP 错误的 `HttpError` 契约保持兼容。
- 重试发生在单次方法调用的传输层，中间件顺序、traceId 注入及 debug 对整次调用的观测边界保持不变。
- 新增运行时依赖 `axios-retry`，补充类型、隔离、重试和错误兼容测试，以及使用和隔离边界文档。

## Capabilities

### New Capabilities

- `http-client-instance-isolation`：定义客户端对象与 Axios 实例的对应关系、拦截器隔离及默认配置继承边界。
- `http-method-retry`：定义方法级重试配置透传、启用语义、调用状态隔离、响应判定与错误兼容。

### Modified Capabilities

无。现有 `tracing-header`、`debug-logging` 的要求保持不变，以回归测试验证重试接入后的兼容性。

## Impact

- **公共契约变更：是，属于向后兼容的可选能力扩展，无既有契约破坏。** 新增公开类型 `HttpMethodOptions` 和方法装饰器可选第二参数；已公开的 `MethodMetadata` 增加可选方法配置。重试回调及配置类型与 `axios-retry` 的公开 API 绑定。
- **兼容性结论：向后兼容。** 原单参数装饰器、默认不重试、默认 `< 400` 成功范围、普通 HTTP 错误的状态/数据/消息格式保持。宿主 defaults 和默认实例拦截器原本不是子包声明的配置来源或扩展契约；历史实现可能受到这些共享状态的隐式影响，但收敛这种影响不构成对既有公开契约的破坏。
- 当前仅涉及 `@jintianxiayu/http-client-decorator`，版本为 `1.0.0`。本次新增兼容的重试能力，实施阶段应记录 **minor** 变更，预计版本为 `1.1.0`；本次规划不修改版本、不发布。
- 受影响代码集中在方法装饰器/元数据、代理与请求执行、公共入口和对应测试；更新子包 README、包清单和 workspace 锁文件。其余子包无实现改动。
- `axios-retry` 作为 `dependencies` 由子包安装和运行时使用，不要求宿主手工安装或初始化。既有 Axios 依赖和 logger peerDependency 保留；不引入新的运行平台或私有打包流程。
- 使用既有公开 API 的下游无需迁移。文档说明宿主默认实例的隐式影响及本次部分隔离边界；客户端配置、参数装饰器和 middleware 继续作为调用方配置请求行为的公开入口，不将下游迁移确认作为本次发布前置条件。
- HTTP 方法、URL、参数映射和默认序列化保持原有契约；启用重试后同一逻辑调用可能发送多次请求，副作用可重放性与业务幂等由调用方负责。新旧版本可并存，无数据迁移或服务端协议升级要求。
- Redis 协议、日志字段格式和 YAML 配置均无变更；不增加默认逐次重试日志。
