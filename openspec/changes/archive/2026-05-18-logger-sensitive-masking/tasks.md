## 1. 类型定义

- [x] 1.1 在 `packages/logger/src/types/index.ts` 新增 `SensitiveFieldConfig` 和 `SensitiveMaskingConfig` 接口
- [x] 1.2 在 `LoggerConfig` 接口中添加 `sensitiveMasking?: SensitiveMaskingConfig` 字段

## 2. 预定义默认敏感字段配置

- [x] 2.1 在 `packages/logger/src/config/defaultConfig.ts` 新增 `DEFAULT_SENSITIVE_FIELDS` 常量
- [x] 2.2 导出 `SensitiveFieldConfig` 类型

## 3. SensitiveMasker 核心模块

- [x] 3.1 创建 `packages/logger/src/core/SensitiveMasker.ts`
- [x] 3.2 实现 `compileTemplate(template)` - 模板预编译函数
- [x] 3.3 实现 `applyPlaceholder(value, placeholder)` - 占位符处理（{lastN}, {firstN}, {domain}）
- [x] 3.4 实现 `renderMask(value, template)` - 模板渲染函数
- [x] 3.5 实现 `maskValue(value, config)` - 单值脱敏函数
- [x] 3.6 实现 `maskObject(obj, depth)` - 递归对象脱敏（支持嵌套和数组）
- [x] 3.7 实现 `init(config)` - 初始化函数（构建 Map/Set，注册渲染器缓存）
- [x] 3.8 实现 `isInitialized()` 和 `reset()` - 状态管理

## 4. LoggerFactory 集成

- [x] 4.1 在 `packages/logger/src/core/LoggerFactory.ts` 中导入 SensitiveMasker
- [x] 4.2 实现 `getSensitiveMaskingConfig()` - 获取脱敏配置（合并默认配置和用户配置）
- [x] 4.3 在 `ensureMaskingInitialized()` 中实现延迟初始化逻辑
- [x] 4.4 在 `serializeMeta()` 中集成脱敏调用（开关控制）
- [x] 4.5 在 `reset()` 中添加 SensitiveMasker.reset() 调用

## 5. 单元测试

- [x] 5.1 创建 `packages/logger/src/core/__tests__/SensitiveMasker.test.ts`
- [x] 5.2 测试 compileTemplate 模板预编译
- [x] 5.3 测试 applyPlaceholder 各占位符（{lastN}, {firstN}, {domain}）
- [x] 5.4 测试 renderMask 模板渲染
- [x] 5.5 测试 maskValue 单值脱敏
- [x] 5.6 测试 maskObject 递归对象脱敏（顶层、嵌套、数组）
- [x] 5.7 测试开关控制（enabled: true/false）
- [x] 5.8 测试边界情况（null, undefined, 空字符串, 长度不足, 邮箱格式异常, 嵌套超限）
- [x] 5.9 测试配置覆盖默认规则

## 6. 文档更新

- [x] 6.1 在 `packages/logger/README.md` 新增「敏感信息脱敏」章节
- [x] 6.2 文档内容包括：功能说明、配置示例、预定义敏感字段列表、模板语法说明