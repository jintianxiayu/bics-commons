## Why

日志是安全审计和故障排查的重要数据源，但业务日志中可能包含敏感信息（密码、Token、手机号、银行卡号等）。一旦日志文件泄露或被未授权访问，将造成严重的数据安全风险。

当前 `@bics/logger` 包仅支持基础的日志输出和 traceId 追踪，缺少敏感信息脱敏能力。需要新增敏感字段脱敏功能，在日志写入前自动识别并脱敏敏感数据，降低数据泄露风险。

## What Changes

- **新增 SensitiveMasker 模块**：提供基于字段名的敏感信息脱敏能力
- **支持模板化脱敏规则**：不同类型敏感字段可配置不同脱敏格式（如密码全掩码、手机号保留后4位）
- **递归脱敏处理**：支持嵌套对象和数组中的敏感字段脱敏
- **开关控制**：通过配置项控制是否开启脱敏功能，默认开启
- **预定义默认规则**：内置常见敏感字段（password, token, phone, creditCard, idCard, email）的脱敏规则

## Capabilities

### New Capabilities

- `sensitive-masking`: 日志敏感信息脱敏能力，支持字段名匹配、模板化脱敏、递归处理、开关控制

## Impact

### 影响的模块和文件

| 模块/文件 | 影响 |
|-----------|------|
| `packages/logger/src/core/SensitiveMasker.ts` | 新增 - 脱敏核心模块 |
| `packages/logger/src/core/LoggerFactory.ts` | 修改 - 集成脱敏逻辑 |
| `packages/logger/src/config/defaultConfig.ts` | 修改 - 新增默认敏感字段配置 |
| `packages/logger/src/types/index.ts` | 修改 - 新增敏感字段配置类型 |
| `packages/logger/src/core/__tests__/SensitiveMasker.test.ts` | 新增 - 单元测试 |
| `packages/logger/README.md` | 修改 - 文档更新 |

### 性能影响

- 敏感字段查找：O(1) HashSet 实现
- 模板渲染：初始化时预编译，运行时不解析
- 整体预期开销：单次 `log.info()` 调用增加约 0.05ms（可忽略不计）

### 回滚方案

- 通过配置 `sensitive-masking.enabled: false` 可快速关闭脱敏功能
- 完全回滚：删除 `SensitiveMasker.ts`，恢复 `LoggerFactory.ts` 即可

### Breaking Change

无 Breaking Change。脱敏功能默认启用，不影响现有业务代码。