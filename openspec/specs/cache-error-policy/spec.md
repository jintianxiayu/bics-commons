# cache-error-policy Specification

## Purpose

为 `@Cache` 提供显式、短时、可筛选且可跨 Memory、Redis 与自定义 Provider 复用的业务异常缓存契约，避免瞬时故障被默认持久化，同时保持并发请求合并和原始业务异常传播边界清晰。

## Requirements

### Requirement: 异常缓存使用显式公共策略

`@Cache` SHALL 通过可选的 `errorCache` 策略控制业务异常是否持久化。省略该策略 MUST 表示禁用异常持久化；提供该策略 MUST 要求正整数秒级 `ttl`，并可提供同步异常筛选器及包含成对 encode/decode 操作的错误 codec。相关公共类型 SHALL 从包根导出，并在严格 TypeScript 配置下保持准确推导。

#### Scenario: 省略策略默认不缓存异常

- **WHEN** 调用方使用 `@Cache('users')` 或仅配置正常结果的 `ttl`、`providerName`、`key`
- **THEN** 业务方法 throw 或 rejection 时不向 Provider 写入异常条目
- **AND** 调用仍以本次原始业务异常拒绝

#### Scenario: 提供策略显式启用异常缓存

- **WHEN** 调用方配置包含正整数 `ttl` 的 `errorCache`
- **THEN** 配置通过严格 TypeScript 检查，并在业务异常路径启用该策略
- **AND** 正常结果缓存行为不因该策略存在而改变

#### Scenario: 非法异常 TTL 在装饰器求值时失败

- **WHEN** JavaScript 调用方或绕过类型检查的 TypeScript 调用方将异常 TTL 配置为 `0`、负数、非整数或非有限值
- **THEN** 装饰器在 legacy decorator 求值阶段抛出 `RangeError`
- **AND** 不读取 Provider、不执行被装饰业务方法，也不产生缓存写入

#### Scenario: 不完整 codec 被类型系统拒绝

- **WHEN** 调用方提供仅有 encode 或仅有 decode 操作的错误 codec
- **THEN** 严格 TypeScript 编译拒绝该配置
- **AND** 调用方必须同时提供两个操作或省略整个 codec

### Requirement: 异常策略只作用于业务方法失败

异常缓存策略 SHALL 只评估被装饰业务方法实际抛出或拒绝的值。Provider 解析、Provider 读取、缓存 key 解析降级、错误策略求值、错误编解码及 Logger 故障 MUST NOT 被当作业务异常写入缓存。Provider 解析或读取失败时，`@Cache` MUST 旁路本次全部缓存操作并执行业务方法一次；业务结果或原始业务异常不得被缓存基础设施异常替换。

#### Scenario: Provider 解析或读取失败

- **WHEN** Provider 不存在，或 Provider 读取因 Redis 不可用、连接超时或其他基础设施原因同步抛出或异步拒绝
- **THEN** 装饰器不调用异常筛选器或错误 codec，不写入正常或异常条目，也不切换其他 Provider
- **AND** 装饰器执行业务方法一次，并向调用方返回其成功结果或传播其原始业务异常

#### Scenario: key resolver 失败后业务成功

- **WHEN** 自定义 key resolver 抛出异常但既有默认 key 回退随后成功执行业务方法
- **THEN** resolver 异常不进入异常缓存策略
- **AND** 系统只按既有正常结果规则回填默认 key

#### Scenario: Logger 失败不进入异常缓存

- **WHEN** 任一缓存决策日志的 Logger 获取或同步写入失败
- **THEN** Logger 异常不调用异常筛选器或错误 codec，也不生成异常条目
- **AND** 当前缓存结果、业务结果、Provider 故障旁路或原始业务异常保持不变

### Requirement: 异常筛选失败时保持原业务异常

显式启用异常缓存且省略筛选器时，系统 SHALL 将业务异常视为可缓存候选；提供筛选器时，系统 SHALL 对每次实际业务执行产生的异常调用筛选器一次。筛选器返回 `false` 或自身抛出异常时 MUST 跳过异常写入，且筛选器异常 MUST NOT 替换原业务异常。

#### Scenario: 筛选器接受业务异常

- **WHEN** 业务方法拒绝且异常筛选器返回 `true`
- **THEN** 系统继续编码并写入该异常候选
- **AND** 当前调用仍抛出业务方法产生的原始异常对象

#### Scenario: 筛选器拒绝瞬时故障

- **WHEN** 业务方法因超时或下游不可用而拒绝，且异常筛选器返回 `false`
- **THEN** 系统不调用错误 codec、不向 Provider 写入异常条目
- **AND** 后续非并发的相同 key 调用可以重新执行业务方法

#### Scenario: 筛选器自身抛出异常

- **WHEN** 业务方法先以原异常拒绝，异常筛选器随后抛出另一个异常
- **THEN** 系统跳过错误 codec 和 Provider 写入
- **AND** 调用方仍收到原业务异常而不是筛选器异常

### Requirement: 正常结果与异常使用独立 TTL

正常结果 SHALL 继续使用 `CacheOptions.ttl`；只有通过异常策略筛选并成功编码的异常条目 SHALL 使用 `errorCache.ttl`。异常 TTL MUST NOT 继承正常 TTL，也 MUST NOT 改写正常条目的 TTL。

#### Scenario: 正常与异常 TTL 不同

- **WHEN** 同一装饰器配置正常 TTL 为 300 秒、异常 TTL 为 10 秒，并分别产生正常结果和可缓存异常
- **THEN** 正常条目写入 Provider 时使用 300 秒，异常条目写入时使用 10 秒
- **AND** 两类 TTL 均保持秒级语义

#### Scenario: 异常条目过期后重新执行

- **WHEN** 可缓存异常写入后达到异常 TTL，Provider 对相同 key 返回 miss
- **THEN** 系统重新执行被装饰业务方法
- **AND** 不因先前异常继续拒绝本次调用

#### Scenario: 正常 TTL 省略不使异常永久存在

- **WHEN** 正常结果 TTL 省略且异常策略配置有限正整数 TTL
- **THEN** 正常条目可沿用 Provider 的无过期语义，异常条目仍必须使用配置的有限 TTL

### Requirement: 异常条目使用版本化可移植表示

持久化异常 SHALL 先转换为带版本标识且可 JSON 往返的异常条目。默认 codec SHALL 支持标准 `Error` 的 `name` 与 `message`，不得持久化原始 `stack`；JSON 兼容的非 `Error` 抛出值 SHALL 按 JSON 表示往返。调用方 MAY 通过成对 codec 保存并恢复领域错误语义，但 codec 输出 MUST 可 JSON 往返。

#### Scenario: 默认 codec 往返标准 Error

- **WHEN** 业务方法抛出标准 `Error` 且异常策略使用默认 codec
- **THEN** 首次调用抛出原始 `Error`，后续缓存命中抛出新的 `Error` 实例并保留原 `name` 与 `message`
- **AND** 缓存条目不包含原始 `stack`，也不承诺对象身份或自定义原型相同

#### Scenario: 自定义 codec 恢复领域异常

- **WHEN** 调用方提供成对 codec，将领域异常编码为 JSON 兼容数据并从该数据恢复异常
- **THEN** Memory、Redis 或符合 `CacheProvider` 契约的自定义 Provider 命中时均使用同一 decode 结果拒绝
- **AND** codec 每次实际写入至多 encode 一次、每次实际命中至多 decode 一次

#### Scenario: 异常无法安全编码

- **WHEN** 默认或自定义 encode 抛出异常，或输出包含循环引用、函数、symbol 等无法 JSON 往返的内容
- **THEN** 系统不调用 Provider 写入，并以原始业务异常拒绝
- **AND** 编码失败不会变成持久化异常或替换原业务异常

#### Scenario: 缓存异常无法解码

- **WHEN** 命中的版本化异常条目无法由当前 codec 解码
- **THEN** 系统不抛出不完整缓存数据，而是将该条目旁路为 miss 并执行业务方法
- **AND** 解码失败不被重新写成业务异常

### Requirement: 异常命中与存量条目遵循当前策略

只有当前装饰器显式启用异常缓存且版本化条目可以成功解码时，系统 SHALL 将异常条目视为有效命中。策略禁用时的版本化异常条目，以及不带当前版本标识的存量异常条目，MUST 被安全旁路为 miss；正常值条目不受该判断影响。

#### Scenario: 启用策略后命中版本化异常

- **WHEN** Provider 返回当前版本、可成功解码的异常条目，且当前装饰器启用了异常缓存
- **THEN** 系统抛出 decode 得到的异常，不执行被装饰业务方法
- **AND** 不重复写入异常条目

#### Scenario: 禁用策略时旁路异常条目

- **WHEN** Provider 返回异常条目但当前装饰器省略 `errorCache`
- **THEN** 系统把该条目视为 miss 并执行被装饰业务方法
- **AND** 不向调用方传播缓存中的异常

#### Scenario: 存量未版本化异常条目安全旁路

- **WHEN** 新版本读取到旧版本写入的未版本化 `{ error }` 条目
- **THEN** 无论当前策略是否启用，系统都把该条目视为 miss，不尝试用当前 codec 解码
- **AND** 业务成功时按正常结果规则覆盖该 key，业务失败时再按当前异常策略决定是否写入新条目

### Requirement: 请求合并独立于异常持久化

Pending 请求合并 SHALL 继续以逻辑 cache key 复用同一个执行中 Promise。异常策略禁用、筛选拒绝或编码失败均 MUST NOT 使并发调用重复执行业务；Promise fulfilled 或 rejected 后 SHALL 从 pending 集合移除。

#### Scenario: 禁用异常缓存时并发失败仍合并

- **WHEN** 两个相同 key 的调用在首个业务 Promise 拒绝前并发进入，且未配置异常缓存策略
- **THEN** 两个调用取得同一个 Promise 并收到同一业务异常，业务方法只执行一次
- **AND** Promise 拒绝后 pending 条目被移除

#### Scenario: 并发失败结束后允许重试

- **WHEN** 已合并的失败 Promise 完成清理，随后再次调用相同 key
- **THEN** 系统重新读取 Provider，并在 miss 时重新执行业务方法
- **AND** 先前 pending rejection 不被当作持久化异常命中
