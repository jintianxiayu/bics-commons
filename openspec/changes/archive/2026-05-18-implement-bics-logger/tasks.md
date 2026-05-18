# 实现 @bics/logger 任务清单

## 1. 项目准备

- [x] 1.1 更新 package.json，添加依赖 winston、winston-daily-rotate-file、yaml、stacktrace-parser
- [x] 1.2 创建 src/types/index.ts，定义 LoggerOptions、LoggerConfig 等类型
- [x] 1.3 创建 src/config/defaultConfig.ts，定义默认配置

## 2. 核心模块实现

- [x] 2.1 实现 ConfigLoader.ts - YAML 加载、递归合并、配置校验
- [x] 2.2 实现 LogPosition.ts - 调用栈解析，多层过滤定位业务代码
- [x] 2.3 实现 LoggerFactory.ts - getLogger、init、懒加载、shutdown、setupShutdownHandlers
- [x] 2.4 重写 src/index.ts 导出

## 3. Transport 配置

- [x] 3.1 配置 Winston Container 管理多个 logger
- [x] 3.2 实现 Console Transport 配置
- [x] 3.3 实现 DailyRotateFile Transport 配置
- [x] 3.4 实现 Winston format.printf 内联格式化

## 4. API 实现

- [x] 4.1 Logger.debug/info/warn/error 方法实现
- [x] 4.2 LogPosition 捕获集成到日志输出
- [x] 4.3 Meta 参数序列化处理（支持 Error 对象）

## 5. 测试

- [x] 5.1 编写 LoggerFactory 单元测试
- [x] 5.2 编写 LogPosition 单元测试
- [x] 5.3 编写 ConfigLoader 单元测试（含错误处理测试）
- [x] 5.4 编写集成测试验证端到端流程

## 6. 文档与迁移

- [x] 6.1 更新 README.md 包含使用示例
- [x] 6.2 更新 2026-05-15-logger-design.md 同步设计决策
- [x] 6.3 添加 JSDoc 注释到所有公共 API