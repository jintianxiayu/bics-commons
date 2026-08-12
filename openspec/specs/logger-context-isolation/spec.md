# logger-context-isolation Specification

## Purpose

本能力用于保证日志上下文只在显式声明的同步或异步作用域内传播，使 traceId 等关联字段在嵌套、并发、异常和日志格式化场景中保持准确且互不污染。

## Requirements

### Requirement: 显式作用域必须传播并恢复上下文

系统 SHALL 通过作用域 API 创建日志上下文，将其传播到该作用域内创建的 Promise、timer 和其他异步任务，并在作用域正常返回、同步抛错或 Promise rejection 后恢复调用方原有上下文。

#### Scenario: 异步调用链继承上下文

- **GIVEN** 调用方以 `traceId=req-a` 创建一个日志上下文作用域
- **WHEN** 作用域内依次经过 Promise 和 timer 执行异步代码
- **THEN** 每一层代码读取到的 `traceId` SHALL 为 `req-a`

#### Scenario: 同步返回后恢复外层上下文

- **GIVEN** 外层上下文包含 `traceId=outer`
- **WHEN** 内层作用域以 `traceId=inner` 同步执行并返回
- **THEN** 内层 SHALL 读取到 `inner`
- **AND** 返回外层后 SHALL 再次读取到 `outer`

#### Scenario: 异步拒绝后恢复外层上下文

- **GIVEN** 外层上下文包含 `traceId=outer`
- **WHEN** 内层作用域返回的 Promise 被拒绝且调用方处理该 rejection
- **THEN** 调用方后续读取到的 `traceId` SHALL 为 `outer`

### Requirement: 嵌套作用域必须继承并允许局部覆盖

系统 SHALL 以进入作用域时的当前上下文为基线合并新值；内层同名值 SHALL 覆盖外层值，未覆盖值 SHALL 被继承，且内层结束后不得改变外层上下文。

#### Scenario: 内层合并并覆盖字段

- **GIVEN** 外层上下文包含 `traceId=outer` 和 `tenantId=t-1`
- **WHEN** 内层作用域设置 `traceId=inner` 和 `userId=u-1`
- **THEN** 内层 SHALL 读取到 `traceId=inner`、`tenantId=t-1` 和 `userId=u-1`
- **AND** 内层结束后外层 SHALL 保持 `traceId=outer` 和 `tenantId=t-1`，且不存在 `userId`

### Requirement: 上下文写操作必须采用分支隔离

活动作用域内的设置和清空操作 MUST 只影响当前执行分支及其随后创建的子任务，不得原地修改祖先作用域或已经存在的兄弟异步分支所观察的上下文。

#### Scenario: 并发分支设置同名字段互不污染

- **GIVEN** 一个父作用域包含 `traceId=parent`，且已从中创建两个并发异步分支
- **WHEN** 两个分支分别将 `traceId` 设置为 `branch-a` 和 `branch-b`
- **THEN** 每个分支及其后代 SHALL 只读取到本分支的值
- **AND** 父作用域 SHALL 继续读取到 `parent`

#### Scenario: 清空当前分支不影响父级和兄弟分支

- **GIVEN** 父作用域和两个并发分支最初继承相同上下文
- **WHEN** 其中一个分支清空上下文
- **THEN** 该分支后续读取 SHALL 得不到原有字段
- **AND** 父作用域及另一个分支 SHALL 保留原有字段

### Requirement: 无作用域写入必须被拒绝

系统 MUST 拒绝在没有活动上下文作用域时设置字段，并抛出明确指向作用域 API 的错误；无活动作用域时读取 SHALL 返回 `undefined`，清空 SHALL 安全完成且不创建上下文。

#### Scenario: 无作用域设置字段

- **GIVEN** 当前执行链没有活动日志上下文
- **WHEN** 调用方尝试设置 `traceId`
- **THEN** 系统 MUST 抛出错误
- **AND** 错误信息 SHALL 指示调用方先使用 `withContext`
- **AND** 系统 MUST NOT 为后续异步任务创建 ambient context

#### Scenario: 无作用域读取和清空

- **GIVEN** 当前执行链没有活动日志上下文
- **WHEN** 调用方读取任意字段并执行清空
- **THEN** 读取结果 SHALL 为 `undefined`
- **AND** 清空 SHALL 不抛错且不创建活动上下文

### Requirement: 上下文输入必须经过运行时校验

系统 MUST 接受非空字符串 key 和字符串 value，并 MUST 拒绝空白 key、非字符串 key/value、非普通键值对象及非函数回调，且校验失败不得创建或修改上下文。

#### Scenario: 接受空字符串 value

- **GIVEN** 当前存在活动作用域
- **WHEN** 调用方以非空 key 设置空字符串 value
- **THEN** 系统 SHALL 保存该空字符串

#### Scenario: 拒绝无效 set 参数

- **GIVEN** 当前存在活动作用域
- **WHEN** 调用方传入空白 key 或非字符串 value
- **THEN** 系统 MUST 抛出 `TypeError`
- **AND** 当前上下文 MUST 保持不变

#### Scenario: 拒绝无效作用域参数

- **GIVEN** 调用方准备创建上下文作用域
- **WHEN** values 不是普通键值对象、包含无效 key/value，或回调不是函数
- **THEN** 系统 MUST 抛出 `TypeError`
- **AND** 回调 MUST NOT 被执行
- **AND** 调用方上下文 MUST 保持不变

### Requirement: 存储观察不得暴露可变内部状态

系统 SHALL 允许调用方获取当前上下文的只读快照；快照必须与内部状态断开，对快照的运行时强制修改不得改变当前、父级或其他分支的上下文。无活动上下文时 SHALL 返回 `undefined`。

#### Scenario: 快照反映获取时状态

- **GIVEN** 当前作用域包含 `traceId=req-a`
- **WHEN** 调用方获取上下文快照
- **THEN** 快照 SHALL 包含 `traceId=req-a`

#### Scenario: 修改快照不影响活动上下文

- **GIVEN** 调用方已获取包含 `traceId=req-a` 的快照
- **WHEN** JavaScript 调用方绕过静态只读类型并修改该快照
- **THEN** 当前活动上下文读取到的 `traceId` SHALL 仍为 `req-a`

### Requirement: 日志必须使用调用时的上下文快照

logger SHALL 在每次日志 API 调用时读取该执行分支的活动 traceId，并让该条日志的所有 transport 复用该值；后续上下文变更、作用域结束或异步 transport 格式化不得改变已提交日志的 traceId。

#### Scenario: 异步格式化保留调用时 traceId

- **GIVEN** logger transport 在日志 API 返回后才格式化事件
- **WHEN** 调用方在 `traceId=req-a` 作用域内记录日志并随后离开该作用域
- **THEN** 最终日志 SHALL 使用 `req-a`

#### Scenario: 同一事件的多个 transport 使用相同 traceId

- **GIVEN** logger 同时启用 plain 和 JSON transport
- **WHEN** 在活动上下文中记录一条日志
- **THEN** 两个 transport SHALL 输出相同的调用时 traceId
- **AND** 内部上下文元数据 MUST NOT 出现在 JSON 输出中

### Requirement: traceId 缺省输出必须跨格式保持确定性

plain pattern 中 `%{traceId}` SHALL 输出调用时 traceId，并在不存在时输出 `-`；JSON 输出 SHALL 在存在 traceId 时提供顶层字符串字段，在不存在时省略该字段。logger 实例 MUST NOT 缓存某次调用的上下文。

#### Scenario: plain 输出存在和缺失 traceId

- **GIVEN** plain pattern 包含 `%{traceId}`
- **WHEN** 分别在有 traceId 和无上下文作用域下记录日志
- **THEN** 两条日志对应位置 SHALL 分别输出该 traceId 和 `-`

#### Scenario: JSON 输出存在和缺失 traceId

- **GIVEN** console 使用 JSON 格式
- **WHEN** 分别在有 traceId 和无上下文作用域下记录日志
- **THEN** 第一条 JSON SHALL 包含顶层字符串 `traceId`
- **AND** 第二条 JSON MUST NOT 包含 `traceId` 字段

#### Scenario: 复用 logger 不复用上下文

- **GIVEN** 同一 logger 实例被两个隔离作用域复用
- **WHEN** 两个作用域分别以不同 traceId 记录日志
- **THEN** 每条日志 SHALL 只包含其调用作用域的 traceId
