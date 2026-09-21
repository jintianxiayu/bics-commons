## Purpose

定义 HTTP 方法装饰器的可选重试配置及直接透传契约，使不同方法能选择各自的失败判断、等待与回调行为，同时约束默认关闭、并发状态独立、响应判定和现有错误及中间件行为的兼容性。

## ADDED Requirements

### Requirement: 方法级公开重试配置

`Get`、`Post`、`Put`、`Delete`、`Patch` SHALL 支持可选第二参数 `HttpMethodOptions`，其 `retry` 字段 SHALL 直接使用 `IAxiosRetryConfig`。旧单参数调用 SHALL 保持有效；全部公开重试字段 SHALL 可配置，不缩减为自定义子集。通过 `getMethodMetadata` 观察到的既有 `method`、`path` SHALL 保持，方法配置 SHALL 不混入请求运行状态。

#### Scenario: 新旧装饰器用法均通过类型检查

- **WHEN** 调用方使用单参数装饰器，或通过第二参数设置重试次数、条件、延迟、超时重置、生命周期回调和响应判定
- **THEN** 五种 HTTP 方法装饰器均可按对应公开类型通过编译
- **THEN** 方法返回类型继续由原方法声明决定，运行时仍返回响应数据

#### Scenario: 不合法公开配置被类型检查拒绝

- **WHEN** 调用方在直接书写的配置对象中使用字符串 `retries`、错误回调返回类型，或把 `retryCount`、`lastRequestTime` 当成公开配置字段
- **THEN** TypeScript 报告与 `IAxiosRetryConfig` 不相容的类型错误
- **THEN** 系统不为重试状态提供额外的公开配置入口

#### Scenario: 方法定义不会触发请求或执行重试回调

- **WHEN** 类及其方法装饰器完成求值，但尚未调用 HTTP 方法
- **THEN** 不发送 HTTP 请求，也不执行配置中的重试回调
- **THEN** 配置只在实际方法调用的请求过程中生效

### Requirement: 显式启用与插件默认配置

系统 SHALL 将未配置 `retry` 或其为 `undefined` 解释为不重试；存在 `retry` 对象时 SHALL 使用原生插件的配置合并及执行语义，空对象使用插件默认选项，显式 `retries: 0` 禁用重试。重试配置来源 SHALL 是方法选项及插件默认值，不从宿主默认配置的重试命名空间隐式启用策略。系统 SHALL 不额外改变调用方条件、延迟或 hook 的含义。

#### Scenario: 未配置重试时只发送一次

- **WHEN** 方法未设置 `retry`、仅设置空方法选项，或设置 `retry: undefined`，并收到 HTTP 503
- **THEN** 只发送一次请求并按既有错误契约失败
- **THEN** 不因宿主的默认重试配置而增加尝试

#### Scenario: 空重试对象使用默认三次额外尝试

- **WHEN** GET 方法配置 `retry: {}`，持续返回 503，且没有取消或超时预算阻止重试
- **THEN** 共发送四次请求，然后按最终失败返回错误
- **THEN** 缺省条件、延迟和超时重置均遵循依赖版本的插件默认值

#### Scenario: 宿主重试命名空间不改变方法策略

- **WHEN** 宿主在对象创建前设置默认重试命名空间，其中包含七次重试、始终拒绝重试的条件、接受所有响应的判定和自定义 hooks
- **THEN** 未配置重试的方法收到 503 时仍只发送一次并失败
- **THEN** 配置 `retry: {}` 的 GET 方法在持续 503 且预算允许时仍发送四次后失败
- **THEN** 这些子包调用不执行宿主命名空间中的 hooks，宿主原配置保持不变

#### Scenario: 显式零次和自定义次数

- **WHEN** 方法在相同可重试失败下分别配置 `retries: 0` 和 `retries: 2`
- **THEN** 前者最多发送一次，后者在条件持续满足且预算允许时最多发送三次
- **THEN** 首次成功或条件不满足会提前结束

### Requirement: 重试选项保持原生语义

系统 SHALL 透传 `retryCondition`、`retryDelay`、`shouldResetTimeout`、`onRetry`、`onMaxRetryTimesExceeded` 及 `validateResponse`，保留插件的回调参数、异步等待和异常处理语义。系统 SHALL 不额外添加 HTTP 方法白名单、自动幂等保障、固定退避策略或自定义延迟的 `Retry-After` 包装。

#### Scenario: 自定义条件和延迟生效

- **WHEN** 方法只允许 503 重试，并配置根据重试序号返回毫秒数的延迟函数
- **THEN** 503 按配置的次数和延迟重试，其他失败直接结束
- **THEN** 条件可返回 Promise，回调接收到插件提供的 Axios 错误对象

#### Scenario: 保留默认与自定义延迟的区别

- **WHEN** 可重试响应包含 `Retry-After`，方法分别使用插件内置延迟和自定义延迟函数
- **THEN** 内置延迟遵循插件原生的 `Retry-After` 处理
- **THEN** 自定义函数的返回值按插件原生语义使用，子包不擅自增加额外等待

#### Scenario: 超时重置由方法配置决定

- **WHEN** 请求有正数 `timeout`，并分别配置 `shouldResetTimeout: false` 和 `true`
- **THEN** 前者按插件规则扣减已用请求时间与等待时间，预算不足时不继续尝试
- **THEN** 后者为每次尝试重新使用配置的超时，是否重试超时错误仍由条件决定
- **THEN** 未设置有效超时不被描述为具有总耗时上限，插件预算也不被描述为全部中间件和回调的严格截止时间

#### Scenario: 生命周期回调与异常保持原生传播

- **WHEN** 方法配置异步 `onRetry` 或 `onMaxRetryTimesExceeded`
- **THEN** 在插件原生触发时机调用并等待它们，不额外触发或吞掉异常
- **THEN** 普通非 Axios hook 异常可以成为最终调用异常，并保留其身份

### Requirement: 单次调用的重试状态独立

同一方法的不同调用、同一对象的不同方法和不同客户端对象 SHALL 使用独立的请求与重试运行状态。系统 SHALL 不将重试计数、时间戳、已变换请求数据或 hook 对请求配置的修改回写到共享的方法配置或元数据。

#### Scenario: 并发与后续调用不共享次数

- **WHEN** 同一方法并发执行两次并分别经历不同数量的失败，随后再次调用该方法
- **THEN** 三次调用都从首次请求开始计算自身预算和次数
- **THEN** 不因其他调用耗尽次数而提前失败，原始方法配置及元数据不出现运行状态

#### Scenario: 不同方法采用不同策略

- **WHEN** 同一对象上一个方法不配置重试，另一个方法配置两次重试并同时调用
- **THEN** 两者分别按各自策略执行，互不改变对方默认值或回调

### Requirement: 响应判定与错误兼容

未提供 `validateResponse` 或其为 `null` 时，系统 SHALL 维持收到的响应状态小于 400 即成功的现有基线，使其他响应参与重试判断。提供判定函数时 SHALL 尊重其结果；判定失败仅进入重试评估，不保证一定重试。最终 Axios 失败 SHALL 转换为 `HttpError`，既有 `HttpError` 和普通非 Axios 异常 SHALL 保持原有传播行为。

#### Scenario: 默认成功范围和返回值保持

- **WHEN** 最终收到 2xx 或未被传输层继续重定向的 3xx 响应，且未自定义响应判定
- **THEN** 调用返回该响应的 `data`，不会仅因状态不是 2xx 而失败

#### Scenario: 自定义判定接受错误状态

- **WHEN** `validateResponse` 接受某个 503 响应
- **THEN** 调用成功返回其数据，不再被子包的固定状态码判断否定

#### Scenario: 自定义判定拒绝成功状态

- **WHEN** `validateResponse` 拒绝某个 200 响应
- **THEN** 是否再次尝试由 `retryCondition`、次数及超时等插件条件决定
- **THEN** 条件不允许或最终耗尽时以包含该状态和响应数据的 `HttpError` 失败

#### Scenario: 显式 null 恢复子包默认判定

- **WHEN** 方法设置 `validateResponse: null` 并最终收到 304
- **THEN** 使用子包既有成功范围返回响应数据，不强制恢复为仅 2xx 成功

#### Scenario: HTTP 错误保留状态数据和消息

- **WHEN** 未配置重试或重试结束后，最终 HTTP 响应状态为 404，URL 为 `https://api.example.com/users/missing`，且未自定义响应判定或自定义判定拒绝该响应
- **THEN** 抛出 `HttpError`，`status` 为 404，`data` 为最终响应数据
- **THEN** `message` 保持为 `HTTP 404: https://api.example.com/users/missing`

#### Scenario: 无响应的 Axios 错误保持兼容

- **WHEN** 网络或超时最终失败且没有 HTTP 响应
- **THEN** 抛出 `HttpError`，`status` 为 0，数据与消息按既有 Axios 错误转换规则保留

### Requirement: 保持逻辑调用和中间件边界

系统 SHALL 在一次装饰方法调用内完成其内部尝试，维持参数映射、`tracing → debug → 用户 middleware` 的执行顺序及洋葱模型。内部重试 SHALL 不重新调用原方法体或重新执行整条外层中间件链；默认不增加逐次重试日志。

#### Scenario: 重试期间只执行一次外层中间件

- **WHEN** 一次方法调用经历失败、等待、再次尝试并最终成功
- **THEN** tracing provider 和每个外层 middleware 的对应阶段按一次逻辑调用执行
- **THEN** debug 记录一次请求和最终结果，耗时包含内部尝试与等待
- **THEN** 原装饰方法体不被执行，成功值仍为最终响应数据

#### Scenario: 中间件短路时不发送请求

- **WHEN** middleware 返回预设结果且不调用后续处理
- **THEN** 不发送初始 HTTP 请求，也不触发重试

#### Scenario: 可重放的 JSON 请求保持内容

- **WHEN** 调用方允许某 JSON 请求重试，首次失败、后续成功
- **THEN** 各次实际发送的 URL、映射参数和 JSON 内容保持一致，除非调用方通过回调显式修改请求
- **THEN** 子包不自动缓存或重建一次性流，也不承诺此类请求体可因启用重试而安全重放
