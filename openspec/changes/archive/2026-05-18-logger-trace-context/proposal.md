# Logger Trace Context 支持

## Why

当前 `@bics/logger` 包不支持 traceId（请求追踪 ID）功能。在微服务架构中，问题排查需要将同一个请求的所有日志关联起来。没有 traceId 支持，开发者只能手动在每条日志中传递 traceId，繁琐且容易遗漏。

现在引入 LoggerContext 模块，通过 AsyncLocalStorage 实现跨异步调用链的上下文传递，让 traceId 自动附加到所有日志输出中，同时保持 logger 包的通用性（不绑定任何特定协议）。

## What Changes

- **新增 LoggerContext 模块**：提供 `set`、`get`、`clear`、`withContext` 四个 API
- **新增 %{traceId} 占位符**：在 pattern 中使用，输出时自动替换为当前上下文的 traceId
- **AsyncLocalStorage 集成**：确保 traceId 在异步调用链中正确传递
- **向后兼容**：现有功能不受影响，不存在 Breaking Change

## Capabilities

### New Capabilities

- `trace-context`：日志追踪上下文功能
  - LoggerContext API（set/get/clear/withContext）
  - %{traceId} 占位符支持
  - AsyncLocalStorage 异步传递

### Modified Capabilities

- 无

## Impact

### 受影响模块

- `packages/logger/src/core/LoggerContext.ts`（新增）
- `packages/logger/src/index.ts`（导出更新）
- `packages/logger/src/types/index.ts`（类型更新）
- `packages/logger/src/core/LoggerFactory.ts`（printf 读取 traceId）
- `packages/logger/src/config/defaultConfig.ts`（pattern 默认值）

### 测试影响

- `packages/logger/test/LoggerContext.test.ts`（新增）
- `packages/logger/test/LoggerFactory.test.ts`（扩展现有测试）

### 依赖影响

- 无新增外部依赖
- 仅使用 Node.js 内置 `async_hooks`（AsyncLocalStorage）

### 性能影响

- AsyncLocalStorage 操作开销极低，可忽略不计
- 每次日志输出时额外读取一次 Map，无显著性能损失

## Rollback Plan

如需回滚，撤销以下变更：

1. 删除 `src/core/LoggerContext.ts`
2. 恢复 `src/index.ts` 导出
3. 恢复 `src/types/index.ts` 类型定义
4. 修改 `src/core/LoggerFactory.ts` 中的 printf 逻辑，移除 traceId 相关代码
5. 恢复 `src/config/defaultConfig.ts` 的 pattern

已发布的 npm 包可通过 `npm publish --force` 重新发布历史版本。