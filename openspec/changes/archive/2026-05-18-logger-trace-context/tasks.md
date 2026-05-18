# Logger Trace Context 实现任务清单

## 1. LoggerContext 模块实现

- [x] 1.1 创建 `src/core/LoggerContext.ts` 文件
- [x] 1.2 实现 `AsyncLocalStorage<Map<string, string>>` 存储结构
- [x] 1.3 实现 `set(key: string, value: string): void` 方法
- [x] 1.4 实现 `get(key: string): string | undefined` 方法
- [x] 1.5 实现 `clear(): void` 方法
- [x] 1.6 实现 `withContext<T>(values, fn): T` 方法（合并上下文 + 自动清理）
- [x] 1.7 编写 LoggerContext 单元测试（覆盖 set/get/clear/withContext 各种场景）

## 2. 类型定义更新

- [ ] 2.1 在 `src/types/index.ts` 中添加 `ContextOptions` 类型（可选）
- [ ] 2.2 更新 `LoggerOptions` 接口添加 traceId 相关配置选项（可选）

## 3. LoggerFactory 集成

- [x] 3.1 在 `src/core/LoggerFactory.ts` 中导入 LoggerContext
- [x] 3.2 修改 `createFormat` 函数，读取 `contextStore.getStore()` 获取 traceId
- [x] 3.3 实现 `%{traceId}` 占位符替换逻辑，不存在时显示 `-`
- [x] 3.4 扩展 LoggerFactory 单元测试，覆盖 traceId 相关的日志输出场景

## 4. 入口文件更新

- [x] 4.1 在 `src/index.ts` 中导出 LoggerContext
- [x] 4.2 更新 JSDoc 注释

## 5. 配置默认更新

- [x] 5.1 在 `src/config/defaultConfig.ts` 的 DEFAULT_PATTERN 中添加 `%{traceId}` 占位符

## 6. 测试验证

- [x] 6.1 运行所有单元测试，确保 22+ 测试全部通过
- [x] 6.2 手动验证 traceId 在异步调用链中的传递

## 7. 文档更新

- [x] 7.1 更新 README.md，添加 LoggerContext 使用说明
- [x] 7.2 添加 traceId 相关使用示例