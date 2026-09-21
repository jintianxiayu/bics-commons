## Context

动机及影响范围见 [proposal.md](proposal.md)。本次需要新增外部依赖、调整实例生命周期、扩展可选 TypeScript 配置，并明确部分隔离边界和响应判定，因此包含技术设计。既有公开 API 契约保持兼容；宿主 defaults 与默认实例拦截器的隐式影响不作为既有公开配置契约。

已检查的现状：

- `src/decorators/http-methods.ts` 的五个方法装饰器只接受路径，使用 `Symbol.for('bics:http-client:method')` 保存 `{ method, path }`。
- `src/core/proxy-factory.ts` 在每次方法调用内执行 `createHttpRequest(config)`；当前它只创建请求闭包，底层仍调用导入的默认 `axios`。
- `src/core/http-client.ts` 使用 `validateStatus: () => true`，收到响应后才按 `status >= 400` 抛出 `HttpError`，不会进入插件处理 HTTP 失败的路径。
- `src/index.ts` 已公开方法装饰器、`MethodMetadata`、`getMethodMetadata` 和 `HttpError`。不能把元数据变更当作完全不可见的内部细节。
- 根配置使用 TypeScript legacy decorators，开启 `experimentalDecorators` 与 `emitDecoratorMetadata`；保持 NodeNext、现有构建和包入口。
- `integration.test.ts`、`proxy.test.ts`、`builtin-middlewares.test.ts` 直接 mock 默认 Axios callable。现行 `tracing-header` 和 `debug-logging` 规格应继续成立。

## Goals / Non-Goals

**Goals:**

- 以对象生命周期管理 Axios 实例，保留同一对象内方法共享传输实例的效率。
- 让公开重试类型和执行语义直接来自依赖，子包只处理启用入口、调用状态及兼容适配。
- 将 HTTP 成功/失败的最终判定集中到 Axios 与重试插件的响应链，避免二次否定用户回调。

**Non-Goals:**

- 不进行 Axios 私有打包，不恢复或手工维护其原厂 defaults，不承诺完全隔离宿主运行环境。
- 不增加类级重试默认值、额外 `@Retry` 装饰器、每次调用的重试参数或新的取消 API。
- 不自建重试循环、业务幂等机制、全链路 deadline、请求体流重建或自动 token 刷新。
- 不添加逐次重试日志，不改变现有 debug/tracing 字段和外层 middleware 协议。

## Decisions

### 1. 直接使用公开配置类型

新增 `src/core/http-method-options.ts` 并从包根导出 `HttpMethodOptions`；其公开形状如下：

```ts
import type { IAxiosRetryConfig } from 'axios-retry';

/** HTTP 方法使用原生重试配置，避免维护与底层插件重复的选项定义。 */
export interface HttpMethodOptions {
    retry?: IAxiosRetryConfig;
}
```

五个公开工厂的目标调用签名如下；使用 legacy `MethodDecorator`，不引入新的方法返回值泛型约束：

```ts
/** 声明 GET 请求，path 为路径，options 为可选方法配置，返回方法装饰器。 */
export declare const Get: (path: string, options?: HttpMethodOptions) => MethodDecorator;
/** 声明 POST 请求，path 为路径，options 为可选方法配置，返回方法装饰器。 */
export declare const Post: (path: string, options?: HttpMethodOptions) => MethodDecorator;
/** 声明 PUT 请求，path 为路径，options 为可选方法配置，返回方法装饰器。 */
export declare const Put: (path: string, options?: HttpMethodOptions) => MethodDecorator;
/** 声明 DELETE 请求，path 为路径，options 为可选方法配置，返回方法装饰器。 */
export declare const Delete: (path: string, options?: HttpMethodOptions) => MethodDecorator;
/** 声明 PATCH 请求，path 为路径，options 为可选方法配置，返回方法装饰器。 */
export declare const Patch: (path: string, options?: HttpMethodOptions) => MethodDecorator;
```

以上是目标声明形状，不要求把现有工厂改写为五套实现。`retry` 及其内部字段均按原生类型可选；不改为 `Pick`、不把 `retries` 改为必填，也不增加 `boolean | number` 简写或自定义参数校验规则。公开的是 `IAxiosRetryConfig`，不是含运行状态的 `IAxiosRetryConfigExtended`；调用方可使用 `NonNullable<HttpMethodOptions['retry']>` 引用该配置，无需本包另造一套重试类型。

备选的自定义四字段配置会额外承担字段同步与语义维护，已按本次确认方向放弃。采用原生配置也意味着 hook 异常、默认网络错误重试范围及延迟策略均使用插件行为，不在包装层悄悄改变。

### 2. 保留元数据键与装饰器求值边界

沿用 `Symbol.for('bics:http-client:method')`，在现有 `MethodMetadata` 中增加 `options?: HttpMethodOptions`。`method`、`path` 保持必需；旧单参数调用不额外写入空 `options`，使旧元数据形状仍为 `{ method, path }`。有第二参数时保存配置的浅副本，回调保留函数引用。

方法装饰器仅登记声明，不执行回调或发送请求；类装饰器继续在 `new Target(...)` 之后创建代理。原方法体不执行、非装饰方法本地执行、参数装饰器顺序与方法的 TypeScript 返回声明均保持。不要在装饰器元数据中存储插件计数、开始时间、Axios 实例或已处理请求体。

### 3. 一次构造一个私有实例

将请求工厂的创建位置从 `createHttpMethod` 返回函数内部移至 `createProxyInstance`，在对象代理建立时创建一次发送函数。发送函数内部调用 `axios.create()`，创建的实例不从公共 API 暴露；在该实例安装一次 `axios-retry`。

代理 getter 仍可生成方法闭包，但传入同一个发送函数。调整内部参数组织时使用一个包含方法配置与发送函数的上下文对象，避免把已有四参数函数扩为五参数；不顺带改变方法缓存或代理行为。

Axios 按原生规则继承创建前 defaults。现有 class/request 的 URL、headers、body、timeout 映射继续在请求构建时应用，`baseURL` 仍由现有 URL 构建逻辑处理。普通对象复制、函数和 Agent 引用等边界按 Axios 的实际行为说明，不尝试全量清洗。

唯一需要排除的继承项是子包现在管理的 `defaults['axios-retry']`：在私有实例创建后删除其自身的该命名空间，不修改宿主 defaults。否则宿主提前写入的插件配置会经 Axios 合并混入方法请求，破坏“空对象使用插件默认配置”和“未配置关闭”的约定。这是方法重试配置来源的限定，不扩展为全配置隔离。

每次请求新建自己的 Axios 配置，当前方法的重试配置仅进入该请求。选用实例级复用而非每方法/每请求建实例，因为策略由请求配置携带，独立实例并不是策略差异的前提。

### 4. 区分关闭和空对象，保持其余字段原样

用插件原生默认选项注册实例，不传入实例级 `retries: 0`，否则 `retry: {}` 会错误地继承关闭状态。每次发送显式设置请求级 `'axios-retry'`：

| 方法声明                      | 请求级配置              | 结果                               |
| ----------------------------- | ----------------------- | ---------------------------------- |
| 没有 `retry` 或为 `undefined` | 新对象 `{ retries: 0 }` | 当前调用不重试                     |
| `retry: {}`                   | 新空对象                | 使用插件默认选项                   |
| 指定配置对象                  | 该对象的浅副本          | 保留字段值、显式 `null` 和回调引用 |

不要使用 `retry ?? {}` 统一这两种含义，不把方法配置写入实例 defaults。计数、时间以及 hook 改写过的请求配置由插件保存于当前调用；不同调用不复用上一次已处理配置。调用者自己在回调闭包中共享的可变状态不属于本包保证的隔离范围。

依赖本身处理次数、条件、等待和回调，无第二重重试循环，也不自动添加 HTTP 方法白名单、指数退避或自定义 `retryDelay` 的 `Retry-After` 兜底。超时仍从现有 `HttpClientConfig.timeout` 传入，`shouldResetTimeout` 原样透传。

### 5. 将失败判定前移，保持最终错误契约

将请求的默认 `validateStatus` 改为 `status => status < 400`，删除成功返回之后无条件的 `response.status >= 400` 抛错。默认/`null` 的 `validateResponse` 不覆盖该基线；提供函数时，插件将响应交给回调决定接受或进入重试评估。

```text
method call
  --> parameter mapping
  --> tracing --> debug --> user middleware
  --> private Axios request
        --> response validation --> retry policy --> next attempt
        --> accepted response OR final rejection
  --> response mapping OR HttpError conversion
  --> middleware returns
```

响应成功时仍收集原有字符串响应头并返回 `data`；例如显式接受的 503 必须正常返回。若拒绝 200，仍需 `retryCondition` 允许且预算足够才会重试，不能把判定拒绝解释为自动重试。

错误转换规则：

- 已有 `HttpError` 原样传播。
- 最终带 HTTP 响应的 `AxiosError` 使用最终 `response.status` 和 `response.data`，消息维持 `HTTP ${status}: ${request.url}`，避免退化为 Axios 默认消息；同一规则适用于用户主动拒绝的 2xx 响应。
- 没有响应的 `AxiosError` 保留既有 `status: 0`、错误消息与数据兜底。
- 普通非 Axios 异常原样抛出，包括 plugin hook 产生的此类异常；不捕获后继续重试，不把它们改成成功。

HTTP 状态检查的唯一职责位于响应链。保留外层固定错误状态检查会否定用户的 `validateResponse`，直接恢复 Axios 的默认仅 2xx 成功则会改变原有 3xx 行为，均不采用。

### 6. 保留中间件与请求体边界

重试只重放已经进入传输层的当前 Axios 请求，不重新进入参数装饰器、tracing provider 或外层 middleware。debug 继续记录一次逻辑请求及最终结果，其 duration 自然包含重试等待。短路 middleware 不调用 sender，因此不会触发任何尝试。

插件可能在重试时复用已经序列化的请求数据；不在重试外再执行一次本包参数映射或重复包装 JSON。普通 JSON 内容应通过实际发送验证。对一次性 Readable、表单流等不增加缓存或重建功能，文档明确业务幂等和 body 可重放性由调用者确认。

### 7. 依赖与构建

在 `packages/http-client-decorator/package.json` 的 `dependencies` 新增 `axios-retry: ^4.5.0`，更新 pnpm 锁文件；不提升既有 `axios: ^1.7.9` 约束。本次设计核对的是 Axios 本地安装版 `1.16.0` 及 axios-retry 的 `v4.5.0` 源码，实施时以实际解析版本运行验收。

上游 4.5.0 的 Axios peer 范围为 `0.x || 1.x`，由本子包现有 Axios dependency 满足；该插件另带 `is-retry-allowed` 传递依赖。无需把插件提升为宿主必须提供的 peerDependency，也不改变 logger peerDependency。保持 `tsc`、CJS 当前产物与 NodeNext 类型解析方式，公开声明对插件类型的引用由正常 dependency 安装满足。

上游资料：[公开类型及执行实现](https://github.com/softonic/axios-retry/blob/v4.5.0/src/index.ts)、[包元数据](https://github.com/softonic/axios-retry/blob/v4.5.0/package.json)。npm registry 查询在当前环境未成功，尚未执行安装；实施阶段先验证目标仓库能够解析该依赖，失败时报告环境问题，不擅自更换主版本。

### 8. 验证安排

- 修改已有默认 Axios mock，使参数映射、代理和内置 middleware 的原测试继续检查原业务契约。
- 新建聚焦的真实 Axios/plugin 测试：可控 adapter 测试必须正确尊重 `validateStatus` 并产生 Axios 错误；至少以本地 HTTP 服务实际验证 503 后成功、最终 HTTP 错误和 JSON 重放，避免 mock 掩盖响应链问题。
- 隔离用例覆盖默认实例创建前/后的拦截器与普通 defaults、同一类的多个对象、宿主默认重试命名空间。使用独立进程或可靠恢复方式，避免测试修改的默认配置污染其他测试。
- 使用受控延迟/假时钟验证 retryDelay、超时预算与 hook 顺序，不依赖公网或长时间 sleep。覆盖同一方法并发、不同方法并发、失败后的新调用以及输入元数据未变。
- 增加基于包公共入口的类型正例和 `@ts-expect-error` 负例；当前 ts-jest 开启 isolatedModules，不能仅以 Jest 通过证明声明可用，应运行显式 `tsc` 检查。验证构建声明不会要求宿主显式安装插件才能引用本包类型。
- 对 `tracing-header`、`debug-logging` 做回归而不改其规格；测试 retry 期间只进入一次 middleware 及短路无请求。

## Risks / Trade-offs

- [宿主默认实例的隐式影响发生变化] → 说明它不属于既有公开契约，记录部分隔离边界；继续通过现有客户端配置、参数装饰器或 middleware 配置所需请求行为，本次按兼容能力扩展发布。
- [创建前 defaults 和可变引用仍会影响客户端] → 文档按部分隔离说明并提供回归测试，不把 `axios.create()` 表述为完整沙箱。
- [默认插件条件可能重试 POST 网络错误，或 body 无法重放] → 文档给出显式条件和业务幂等边界，不在完整透传之外偷偷增加保护策略。
- [自定义延迟、异步 hook 和每次重置超时会延长调用] → 保留原生语义并测试，说明超时预算不是整条调用链的严格 deadline。
- [公开类型与依赖版本耦合] → 约束在兼容主版本，锁定构建解析结果，升级时执行类型及行为回归。
- [旧测试只 mock callable，无法证明插件路径有效] → 引入真实实例与本地 HTTP 验证，特别覆盖默认失败路径及自定义接受 503 的路径。

## Migration Plan

1. 实施阶段完成本变更任务和验收；增加 minor 变更记录，按当前 `1.0.0` 升级为 `1.1.0` 规划，不在本次提案阶段改版本或发布。
2. README 说明默认关闭重试、四种启用形式、全部透传字段、默认策略和 hook 异常行为，并补充实例部分隔离边界。旧 `@Get(path)` 等写法无需改动。
3. 既有公开 API 使用者无需迁移；发布说明区分新增可选能力和历史共享状态的隐式影响，不要求统一迁移或下游确认后才能升级。
4. 请求及数据格式无需服务端升级或存量迁移，新旧包可并存。调用方仅对已确认可重复执行的业务方法开启重试。
5. 若新版有问题，下游可锁回已知可用的旧版本，或发布修订版本修复；不依赖撤回已发布 npm 版本。仅关闭 `retry` 不会恢复旧的宿主拦截器共享行为。
