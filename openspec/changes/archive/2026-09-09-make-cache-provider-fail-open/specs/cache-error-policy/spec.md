## MODIFIED Requirements

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
