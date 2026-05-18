# 实现 @bics/logger 日志工厂包

## Why

bics-commons 需要一个统一的日志组件，封装 SLF4J 风格的 API，底层基于 Winston，支持 YAML 配置、命名 logger、配置继承等特性。当前 `packages/logger/src/index.ts` 仅为简单的 Console Logger 实现，需要升级为生产级日志库。

## What Changes

- **新增** Winston 日志库集成，支持 Console 和 File 两种 Transport
- **新增** YAML 配置文件加载，支持 `LOGGER_CONFIG_PATH` 环境变量
- **新增** 命名 Logger 机制，通过 `LoggerFactory.getLogger(name)` 获取
- **新增** 配置继承机制，命名 Logger 未配置的选项继承 root 配置
- **新增** `%{log_position}` 占位符，自动捕获调用位置（文件:行号:列号）
- **新增** `LoggerFactory.init()` 显式初始化，配置错误时抛出异常
- **新增** `LoggerFactory.getLogger()` 懒加载，配置错误时降级到默认配置
- **新增** `LoggerFactory.shutdown()` 优雅关闭，等待日志写入完成
- **新增** `LoggerFactory.setupShutdownHandlers()` 自动注册进程信号处理
- **优化** Pattern 格式化采用 Winston 内联 formatter
- **优化** 配置合并采用递归合并（JSON Merge Patch 风格）

## Capabilities

### New Capabilities

- `bics-logger`: SLF4J 风格的日志工厂包，支持命名 logger、YAML 配置、配置继承、优雅关闭

## Impact

- **代码变更**: `packages/logger/` 目录下的所有文件需要重构
- **新增依赖**: winston、winston-daily-rotate-file、yaml、stacktrace-parser
- **API 变更**: 当前 `createLogger()` API 变更为 `LoggerFactory.getLogger()`
- **兼容性**: 当前代码中的 `createLogger()` 需要迁移到新 API