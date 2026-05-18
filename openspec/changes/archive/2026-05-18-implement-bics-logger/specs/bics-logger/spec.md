# bics-logger

## ADDED Requirements

### Requirement: LoggerFactory.getLogger(name) 返回命名 Logger

LoggerFactory SHALL provide a `getLogger(name: string)` method that returns a Logger instance identified by the given name.

#### Scenario: 获取已配置的命名 Logger
- **WHEN** application calls `LoggerFactory.getLogger('database')` with a name defined in config
- **THEN** system returns a Logger instance with the configured level and format

#### Scenario: 获取未配置的命名 Logger
- **WHEN** application calls `LoggerFactory.getLogger('unknown')` with a name NOT defined in config
- **THEN** system returns a Logger instance inheriting from root configuration

### Requirement: Logger 支持 debug/info/warn/error 方法

Logger SHALL provide `debug`, `info`, `warn`, `error` methods that accept a message string and optional meta arguments.

#### Scenario: 记录 INFO 级别日志
- **WHEN** logger.info('User logged in', { userId: 123 }) is called
- **THEN** system outputs a log entry at INFO level with the message and meta data

#### Scenario: 记录 ERROR 级别日志与 Error 对象
- **WHEN** logger.error('Connection failed', err) is called with an Error object
- **THEN** system outputs a log entry at ERROR level with Error message and stack

### Requirement: LogPosition 自动捕获调用位置

Logger SHALL automatically capture the caller's source location (file:line:column) and include it in the log output when `%{log_position}` placeholder is used.

#### Scenario: LogPosition 正确捕获业务代码调用位置
- **WHEN** logger.info('message') is called from src/db.ts line 42
- **THEN** system parses the stack trace and identifies the caller's location as src/db.ts:42

#### Scenario: LogPosition 跳过内部调用帧
- **WHEN** logger.info('message') is called from business code
- **THEN** system skips Logger internal frames (Logger.info, Logger.log, Logger.write) and finds the actual business code frame

### Requirement: 配置继承采用递归合并

Named logger configuration SHALL be merged with root configuration using recursive merge (JSON Merge Patch semantics).

#### Scenario: 部分配置继承
- **WHEN** root has console.enabled=true, console.colors=true AND logger 'db' has console.enabled=false
- **THEN** merged config for 'db' has console.enabled=false, console.colors=true (inherits colors)

#### Scenario: 深层配置继承
- **WHEN** root has file.dirname='./logs' AND logger 'db' has file.enabled=false
- **THEN** merged config for 'db' has file.enabled=false, file.dirname='./logs' (inherits dirname)

### Requirement: LoggerFactory.init() 显式初始化

LoggerFactory SHALL provide an `init()` method that loads and validates configuration immediately. If configuration is invalid, it SHALL throw an error.

#### Scenario: init() 成功
- **WHEN** `LoggerFactory.init()` is called with valid configuration file
- **THEN** configuration is loaded and cached, subsequent getLogger() calls use cached config

#### Scenario: init() 配置错误抛出异常
- **WHEN** `LoggerFactory.init()` is called with invalid YAML configuration
- **THEN** system throws ConfigError and application fails to start

### Requirement: LoggerFactory.getLogger() 懒加载配置

LoggerFactory SHALL load configuration lazily on first `getLogger()` call if `init()` was not called. Configuration errors SHALL NOT throw but instead use default configuration with a warning.

#### Scenario: 懒加载成功
- **WHEN** getLogger() is called without prior init() and config is valid
- **THEN** config is loaded and cached for subsequent calls

#### Scenario: 懒加载失败降级
- **WHEN** getLogger() is called without prior init() and config has parse error
- **THEN** system uses default configuration, logs a warning, and returns a functional logger

### Requirement: LoggerFactory.shutdown() 优雅关闭

LoggerFactory SHALL provide a `shutdown(options?: ShutdownOptions)` method that waits for pending log writes to complete before resolving.

#### Scenario: 正常关闭
- **WHEN** `LoggerFactory.shutdown({ timeout: 3000 })` is called
- **THEN** system waits up to 3 seconds for buffered logs to be written, then resolves

#### Scenario: 超时关闭
- **WHEN** `LoggerFactory.shutdown({ timeout: 100 })` is called but writes take longer
- **THEN** system resolves after timeout, pending logs may be lost

### Requirement: LoggerFactory.setupShutdownHandlers() 自动注册

LoggerFactory SHALL provide a `setupShutdownHandlers()` method that registers handlers for process signals (SIGTERM, SIGINT) to call shutdown automatically.

#### Scenario: 自动处理 SIGTERM
- **WHEN** `LoggerFactory.setupShutdownHandlers()` has been called AND process receives SIGTERM
- **THEN** system calls shutdown() and exits cleanly

#### Scenario: 自动处理 SIGINT
- **WHEN** `LoggerFactory.setupShutdownHandlers()` has been called AND process receives SIGINT (Ctrl+C)
- **THEN** system calls shutdown() and exits cleanly

### Requirement: Meta 参数全部序列化为 JSON

When logger methods receive multiple meta arguments, they SHALL all be serialized and available via `%{meta}` placeholder.

#### Scenario: 单个 meta 参数
- **WHEN** logger.info('query', { duration: 42 }) is called
- **THEN** %{meta} outputs '{"duration":42}'

#### Scenario: 多个 meta 参数
- **WHEN** logger.info('user login', { userId: 123 }, { ip: '192.168.1.1' }) is called
- **THEN** %{meta} outputs '[{"userId":123},{"ip":"192.168.1.1"}]'

#### Scenario: Error 对象作为 meta
- **WHEN** logger.error('failed', new Error('oops')) is called
- **THEN** %{meta} outputs '[{"message":"oops","stack":"Error: oops\n at ..."}]'