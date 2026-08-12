## Purpose

本能力用于为 LoggerFactory 建立可等待、可重复且无资源泄漏的生命周期契约，确保并发关闭、关闭超时、重新初始化和进程信号处理在服务停机及测试环境中均具有确定性行为。

## ADDED Requirements

### Requirement: 同一轮并发关闭必须共享关闭过程

当一次关闭仍在进行时，系统 SHALL 让后续 `shutdown()` 调用等待同一关闭过程。底层日志容器 MUST 每轮最多关闭一次，且首个调用提供的 timeout 和 `onShutdown` MUST 决定该轮关闭行为；后续加入者的选项不得改变进行中的关闭。

#### Scenario: 两个调用并发关闭活动 logger

- **GIVEN** logger 已初始化且底层关闭尚未完成
- **WHEN** 两个调用方先后调用 `shutdown()`
- **THEN** 两个调用方都保持等待，直到同一底层关闭过程完成或超时
- **AND** 底层日志容器仅被关闭一次

#### Scenario: 后续调用提供不同选项

- **GIVEN** 首个 `shutdown()` 已以 timeout A 和回调 A 启动关闭
- **WHEN** 关闭完成前另一个调用方以 timeout B 和回调 B 调用 `shutdown()`
- **THEN** 本轮关闭继续使用 timeout A
- **AND** 关闭完成时仅执行回调 A 一次
- **AND** 两个调用方观察到相同的成功或失败结果

#### Scenario: 关闭完成后再次调用

- **GIVEN** 上一轮关闭已经完成且当前没有活动 logger
- **WHEN** 应用再次调用 `shutdown()`
- **THEN** 调用安全完成且不抛出异常
- **AND** 不会重复关闭上一轮的日志容器

### Requirement: 关闭超时不得遗留活动定时器

系统 SHALL 在底层关闭与 timeout 之间只保留当前关闭轮次所需的定时器。底层关闭先完成、抛错或本轮关闭结束时，系统 MUST 清理该定时器；timeout 先到达时，`shutdown()` MUST 按既有兼容行为完成，而不得无限等待底层关闭。

#### Scenario: 底层关闭先于 timeout 完成

- **GIVEN** `shutdown({ timeout: 5000 })` 启动且底层容器立即完成关闭
- **WHEN** `shutdown()` Promise 完成
- **THEN** 对应 timeout 定时器已被取消
- **AND** 该定时器不会继续保持 Node.js event loop 活动

#### Scenario: 底层关闭超过 timeout

- **GIVEN** 底层容器未在配置的 timeout 内完成关闭
- **WHEN** timeout 到达
- **THEN** `shutdown()` 完成并进入已关闭状态
- **AND** 后续底层关闭结果不会产生未处理的 Promise rejection

#### Scenario: 底层关闭抛出错误

- **GIVEN** 底层日志容器关闭时抛出或拒绝 Promise
- **WHEN** 应用等待 `shutdown()`
- **THEN** `shutdown()` 以该关闭错误失败
- **AND** timeout 定时器和内部生命周期状态仍被清理

### Requirement: 关闭期间必须拒绝新的工厂访问

系统 SHALL 在关闭过程开始后、结束前拒绝 `init()` 与 `getLogger()`，并提供可诊断的生命周期错误。系统 MUST NOT 在该阶段加载新配置、创建新 transport 或返回正在关闭的缓存 wrapper。

#### Scenario: 关闭期间获取已有名称

- **GIVEN** 名为 `app` 的 logger 已缓存且关闭过程尚未完成
- **WHEN** 应用调用 `getLogger('app')`
- **THEN** 系统抛出说明 LoggerFactory 正在关闭的错误
- **AND** 不返回已缓存 wrapper

#### Scenario: 关闭期间获取新名称

- **GIVEN** 关闭过程尚未完成且名称 `audit` 尚未创建
- **WHEN** 应用调用 `getLogger('audit')`
- **THEN** 系统抛出说明 LoggerFactory 正在关闭的错误
- **AND** 不创建 logger、transport 或脱敏策略

#### Scenario: 关闭期间显式初始化

- **GIVEN** 关闭过程尚未完成
- **WHEN** 应用调用 `LoggerFactory.init()`
- **THEN** 系统抛出说明 LoggerFactory 正在关闭的错误
- **AND** 不加载或替换配置缓存

### Requirement: 关闭完成后必须允许干净重建

无论底层关闭正常完成、超时还是失败，系统 MUST 在本轮结束时清理 container、wrapper 缓存和配置缓存，并恢复可初始化状态。后续 `init()` 或 `getLogger()` SHALL 使用当时的配置创建全新 logger，不得复用关闭前的 wrapper 或 transport。

#### Scenario: 关闭后重新获取同名 logger

- **GIVEN** 名为 `app` 的 logger 已创建并完成关闭
- **WHEN** 应用再次调用 `getLogger('app')`
- **THEN** 系统重新加载当前配置并返回新的 wrapper
- **AND** 新 wrapper 不复用已关闭的底层 logger 或 transport

#### Scenario: 关闭后配置发生变化

- **GIVEN** LoggerFactory 关闭完成后外部配置已被修改
- **WHEN** 应用重新初始化并获取 logger
- **THEN** 新 logger 使用修改后的配置
- **AND** 关闭前的配置缓存不会影响新实例

#### Scenario: 关闭失败后重新初始化

- **GIVEN** 前一轮底层关闭以错误结束
- **WHEN** 调用方处理错误后再次调用 `init()` 或 `getLogger()`
- **THEN** LoggerFactory 可以重新初始化并创建可用 logger

### Requirement: 关闭回调不得破坏状态清理

每轮实际关闭的 `onShutdown` SHALL 在内部状态清理后最多执行一次。回调抛错时 `shutdown()` MUST 将该错误返回给首个调用方及所有并发加入者，但 LoggerFactory 仍 MUST 保持可重新初始化状态。

#### Scenario: 回调正常完成

- **GIVEN** 首个关闭调用提供 `onShutdown`
- **WHEN** 本轮底层关闭完成或 timeout 到达
- **THEN** 系统在清理内部状态后调用 `onShutdown` 一次

#### Scenario: 回调抛出错误

- **GIVEN** `onShutdown` 执行时抛出错误
- **WHEN** 应用等待本轮 `shutdown()`
- **THEN** 首个调用方和所有并发加入者都收到该错误
- **AND** LoggerFactory 仍可在之后重新初始化

### Requirement: 信号处理器注册必须幂等且可清理

系统 SHALL 对每个信号最多注册一个由 LoggerFactory 管理的处理器。重复或重叠调用 `setupShutdownHandlers()` MUST 只补充尚未注册的信号，不得修改已注册信号的首组选项；任一已注册信号触发时，系统 MUST 只启动一轮关闭并移除本工厂注册的全部信号处理器。测试重置 MUST 同样移除这些处理器，且不得移除应用注册的其他 listener。

#### Scenario: 重复注册相同信号

- **GIVEN** LoggerFactory 已为 `SIGTERM` 注册处理器
- **WHEN** 应用再次为 `SIGTERM` 调用 `setupShutdownHandlers()`
- **THEN** LoggerFactory 管理的 `SIGTERM` listener 数量保持为一个
- **AND** 首次注册的 timeout 与回调语义保持不变

#### Scenario: 注册部分重叠的信号集合

- **GIVEN** LoggerFactory 已注册 `SIGTERM`
- **WHEN** 应用为 `SIGTERM` 和 `SIGINT` 调用 `setupShutdownHandlers()`
- **THEN** 系统只新增一个 `SIGINT` 处理器
- **AND** 不重复注册 `SIGTERM`

#### Scenario: 信号触发自动关闭

- **GIVEN** LoggerFactory 已注册多个关闭信号
- **WHEN** 其中任一信号被触发
- **THEN** 系统移除本工厂注册的全部信号处理器并启动一轮关闭
- **AND** 关闭完成后按既有契约请求进程正常退出一次

#### Scenario: 测试重置清理处理器

- **GIVEN** LoggerFactory 和应用都在同一信号上注册了 listener
- **WHEN** 调用 `LoggerFactory.reset()`
- **THEN** 系统移除 LoggerFactory 自己注册的处理器
- **AND** 应用注册的 listener 保持不变
