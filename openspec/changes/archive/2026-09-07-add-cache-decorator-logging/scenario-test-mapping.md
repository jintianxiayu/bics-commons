# Scenario-to-test 清单

本清单把 `cache-operation-logging` delta spec 的每个 Scenario 映射到带同名 marker 的自动化测试。结构校验由
`openspec validate --strict` 独立完成，不作为测试覆盖的替代品。

| Scenario                                | 主要自动化测试                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| 正常缓存决策使用 debug                  | `test/cache-logger.test.ts`                                                             |
| 可恢复回退与淘汰跳过使用 warn           | `test/cache-logger.test.ts`                                                             |
| 缓存基础设施失败使用 error              | `test/cache-logger.test.ts`                                                             |
| Logger 配置筛选输出                     | `test/cache-logger.integration.test.ts`                                                 |
| C01 并发调用复用 pending 请求           | `test/cache-logging.test.ts`                                                            |
| C02 命中成功缓存条目                    | `test/cache-logging.test.ts`                                                            |
| C03 命中异常缓存条目                    | `test/cache-logging.test.ts`                                                            |
| C04 未命中后回填业务结果                | `test/cache-logging.test.ts`                                                            |
| C05 未命中后回填业务异常                | `test/cache-logging.test.ts`                                                            |
| C06 重复调用只记录实际决策              | `test/cache-logging.test.ts`                                                            |
| E01 单 key 淘汰已发起                   | `test/cache-evict-logging.test.ts`                                                      |
| E02 allEntries 淘汰完成                 | `test/cache-evict-logging.test.ts`                                                      |
| E03 业务方法失败时跳过淘汰              | `test/cache-evict-logging.test.ts`                                                      |
| E04 重复淘汰保持原幂等语义              | `test/cache-evict-logging.test.ts`                                                      |
| K01 @Cache key resolver 失败后回退      | `test/cache-logging.test.ts`                                                            |
| K02 单 key 淘汰 resolver 失败后回退     | `test/cache-evict-logging.test.ts`                                                      |
| K03 allEntries 不求值 key resolver      | `test/cache-evict-logging.test.ts`                                                      |
| F01 默认或指定 Provider 不存在          | `test/cache-logging.test.ts`                                                            |
| F02 Redis 读取不可用或超时              | `test/cache-logging.test.ts`                                                            |
| F03 allEntries 扫描或删除失败           | `test/cache-evict-logging.test.ts`                                                      |
| F04 非等待写入只报告已发起              | `test/cache-logging.test.ts`                                                            |
| F05 非等待单 key 删除只报告已发起       | `test/cache-evict-logging.test.ts`                                                      |
| M01 显式与默认 Provider 元数据          | `test/cache-logging.test.ts`                                                            |
| M02 参数和值不进入日志                  | `test/cache-logging.test.ts`                                                            |
| M03 Provider 错误交给 Logger 安全处理   | `test/cache-logging.test.ts`、`test/cache-logger.integration.test.ts`                   |
| M04 traceId 自动关联                    | `test/cache-logger.integration.test.ts`                                                 |
| L01 导入缓存包不初始化 Logger           | `test/cache-logger.test.ts`                                                             |
| L02 首次缓存调用使用应用 Logger         | `test/cache-logger.test.ts`                                                             |
| L03 Logger 写入失败不影响 cache hit     | `test/cache-logging.test.ts`                                                            |
| L04 Logger 写入失败不遮蔽 Provider 错误 | `test/cache-logging.test.ts`                                                            |
| A01 既有装饰器调用无需日志选项          | `test/redis-cache-client-types.test.ts`、`test/type-contract/contract.ts`               |
| A02 并发请求继续返回同一 Promise        | `test/cache-logging.test.ts`                                                            |
| A03 Redis 数据协议保持不变              | `test/redis-cache-decorator.test.ts`、`test/redis-cache-client.integration.test.ts`     |
| P01 消费项目提供兼容 Logger             | `test/redis-cache-package.integration.test.ts`、`test/cache-logger.integration.test.ts` |
| P02 发布清单包含 Logger peer            | `test/redis-cache-package.integration.test.ts`                                          |

`test/openspec-scenario-coverage.test.ts` 会从 spec 自动提取 Scenario，并验证上述 marker 没有遗漏；重复映射必须显式列出，
避免同名字符串偶然通过审计。
