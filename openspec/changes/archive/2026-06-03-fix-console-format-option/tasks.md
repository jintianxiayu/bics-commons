## 1. 默认配置更新

- [x] 1.1 在 `packages/logger/src/config/defaultConfig.ts` 的 `defaultConfig.console` 块中新增 `format: 'plain'` 字段
- [x] 1.2 验证 `getDefaultConfig().console.format === 'plain'` 断言

## 2. LoggerFactory 实现

- [x] 2.1 在 `packages/logger/src/core/LoggerFactory.ts` 中新增私有 `createJsonFormat()` 函数：从 `AsyncLocalStorage` 读取 `traceId` 注入到 `info.traceId` 后调用 `winston.format.json()`
- [x] 2.2 修改 `createTransports` 方法：当 `config.console?.format === 'json'` 时切换到 `createJsonFormat()`，同时跳过 `colorize` formatter
- [x] 2.3 确认 `format: 'plain'`（含未配置）路径与变更前完全一致

## 3. 单元测试

- [x] 3.1 在 `packages/logger/test/LoggerFactory.test.ts` 中扩展：覆盖 `format: 'plain'`、`format: 'json'`、未配置三种场景的输出
- [x] 3.2 覆盖 JSON 模式下 `traceId` 注入与不注入两种分支
- [x] 3.3 覆盖 plain 模式下 `colors` 字段与 `pattern` 占位符替换
- [x] 3.4 覆盖默认配置 `defaultConfig.console.format === 'plain'` 断言
- [x] 3.5 运行 `npx lerna run test --scope=@jintianxiayu/logger` 确认全部用例通过（64/64）

## 4. 文档与发布

- [x] 4.1 更新 `packages/logger/README.md`：在 console 配置示例中补充 `format: 'plain' | 'json'` 说明，列出 JSON 模式的输出字段
- [x] 4.2 运行 `npm run format` 确认无格式问题（已自动格式化所有 logger 文件）
- [x] 4.3 运行 `npm run build` 确认 logger 包构建通过
