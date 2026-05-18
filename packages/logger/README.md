# @bics/logger

SLF4J 风格的日志工厂，基于 Winston 实现。

## 特性

- **命名 Logger**: 通过 `LoggerFactory.getLogger(name)` 获取
- **YAML 配置**: 支持通过 `LOGGER_CONFIG_PATH` 环境变量指定配置文件
- **配置继承**: 命名 Logger 未配置的选项继承 root 配置
- **LogPosition**: `%{log_position}` 占位符自动捕获调用位置
- **TraceContext**: `%{traceId}` 占位符支持异步上下文传递
- **优雅关闭**: 支持 `shutdown()` 和 `setupShutdownHandlers()`

## 安装

```bash
npm install @bics/logger
```

## 快速开始

```typescript
import { LoggerFactory } from '@bics/logger';

// 获取 logger（首次调用时懒加载配置）
const logger = LoggerFactory.getLogger('database');

// 记录日志
logger.info('connection opened');
logger.debug('query executed', { duration: 42 });
logger.error('connection failed', new Error('timeout'));
```

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOGGER_CONFIG_PATH` | YAML 配置文件路径 | 使用内置默认配置 |

### 配置文件格式

```yaml
root:
  level: info
  pattern: '%{timestamp} %{level} [%{name}] %{log_position}: %{message} %{meta}'
  console:
    enabled: true
    colors: true
  file:
    enabled: false
    dirname: ./logs
    filename: app.log
    datePattern: 'YYYY-MM-DD'
    maxSize: 10m
    maxFiles: 7d

loggers:
  database:
    level: debug
  http:
    level: warn
```

### Pattern 占位符

| 占位符 | 说明 |
|--------|------|
| `%{timestamp}` | ISO 8601 时间戳 |
| `%{level}` | 日志级别 |
| `%{name}` | logger 名称 |
| `%{traceId}` | traceId 上下文（无值时显示 `-`） |
| `%{log_position}` | 调用位置（文件:行号:列号） |
| `%{message}` | 日志消息 |
| `%{meta}` | 元数据（JSON 字符串） |

## API

### LoggerFactory.getLogger(name: string)

获取命名 Logger 实例。首次调用时懒加载配置。

```typescript
const logger = LoggerFactory.getLogger('database');
logger.info('message');
```

### LoggerFactory.init()

显式初始化。配置错误时抛出异常。

```typescript
LoggerFactory.init(); // 配置错误时抛异常
```

### LoggerFactory.shutdown(options?)

优雅关闭。等待日志写入完成。

```typescript
await LoggerFactory.shutdown({ timeout: 3000 });
```

### LoggerFactory.setupShutdownHandlers(options?)

注册进程信号处理。收到 SIGTERM/SIGINT 时自动调用 shutdown。

```typescript
LoggerFactory.setupShutdownHandlers({ timeout: 5000 });
```

### Logger 接口

```typescript
interface LoggerInterface {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}
```

## 类型导出

```typescript
import { LoggerFactory, ConfigLoader, LogPosition, LoggerContext } from '@bics/logger';
import type {
  LoggerConfig,
  LoggerOptions,
  LogLevelName,
  ConsoleConfig,
  FileConfig,
  ShutdownOptions,
  LoggerInterface,
} from '@bics/logger';
```

## 默认配置

```yaml
root:
  level: info
  pattern: '%{timestamp} %{level} [%{name}] [%{traceId}] %{log_position}: %{message} %{meta}'
  console:
    enabled: true
    colors: true
  file:
    enabled: false
    dirname: ./logs
    filename: app.log
    datePattern: 'YYYY-MM-DD'
    maxSize: 10m
    maxFiles: 7d
```

## TraceContext - traceId 追踪

LoggerContext 提供基于 AsyncLocalStorage 的上下文传递，支持 traceId 在异步调用链中自动传递。

```typescript
import { LoggerFactory, LoggerContext } from '@bics/logger';

const logger = LoggerFactory.getLogger('http');

// 方式1: withContext 自动清理
LoggerContext.withContext({ traceId: 'req-123' }, () => {
  logger.info('request received');
  // 调用其他异步函数时 traceId 自动传递
  await processRequest();
});

// 方式2: set/get 手动管理
LoggerContext.set('traceId', 'req-456');
logger.info('request started');
LoggerContext.clear();
```

### LoggerContext API

| 方法 | 说明 |
|------|------|
| `LoggerContext.set(key, value)` | 设置上下文值 |
| `LoggerContext.get(key)` | 获取上下文值 |
| `LoggerContext.clear()` | 清空当前上下文 |
| `LoggerContext.withContext(values, fn)` | 在给定上下文中执行函数，执行后自动清理 |
| `LoggerContext.getStore()` | 获取当前存储（高级用法） |

### 配合 Express/Koa 中间件使用

```typescript
import express from 'express';

const app = express();

app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || generateTraceId();
  LoggerContext.withContext({ traceId }, () => {
    logger.info('request incoming');
    next();
  });
});
```

## 项目结构

```
packages/logger/
├── src/
│   ├── index.ts              # 导出
│   ├── core/
│   │   ├── LoggerFactory.ts  # 工厂主体
│   │   ├── LoggerContext.ts  # 异步上下文存储
│   │   ├── ConfigLoader.ts   # YAML 加载器
│   │   └── LogPosition.ts    # 调用栈解析
│   ├── config/
│   │   └── defaultConfig.ts  # 默认配置
│   └── types/
│       └── index.ts          # 类型定义
├── test/
│   ├── LoggerFactory.test.ts
│   ├── LoggerContext.test.ts
│   ├── ConfigLoader.test.ts
│   └── LogPosition.test.ts
├── package.json
├── tsconfig.json
└── jest.config.js
```

## License

MIT