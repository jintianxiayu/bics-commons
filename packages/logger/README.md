# @jintianxiayu/logger

SLF4J 风格的日志工厂，基于 Winston 实现。

## 特性

- **命名 Logger**: 通过 `LoggerFactory.getLogger(name)` 获取
- **YAML 配置**: 支持通过 `LOGGER_CONFIG_PATH` 环境变量指定配置文件
- **配置继承**: 命名 Logger 未配置的选项继承 root 配置
- **敏感信息脱敏**: 自动对日志中的敏感字段进行脱敏处理
- **LogPosition**: `%{log_position}` 占位符自动捕获调用位置
- **TraceContext**: `%{traceId}` 占位符支持异步上下文传递
- **优雅关闭**: 支持 `shutdown()` 和 `setupShutdownHandlers()`

## 安装

```bash
npm install @jintianxiayu/logger
```

## 快速开始

```typescript
import { LoggerFactory } from '@jintianxiayu/logger';

const logger = LoggerFactory.getLogger('app');

// 记录日志
logger.info('app started', { version: '1.0.0' });

// 敏感字段自动脱敏
logger.info('user logged in', {
    userId: 'u123',
    email: 'user@example.com',
    password: 'secret123', // 自动脱敏为 ********
});
```

## 示例代码

完整示例见 `examples/demo.ts`，包含：

- 基本日志记录
- traceId 追踪功能
- 敏感信息脱敏
- 多 Logger 命名空间
- 优雅关闭

运行示例：

```bash
npx ts-node examples/demo.ts
```

## 配置

### 环境变量

| 变量                 | 说明              | 默认值           |
| -------------------- | ----------------- | ---------------- |
| `LOGGER_CONFIG_PATH` | YAML 配置文件路径 | 使用内置默认配置 |

### 配置文件格式

```yaml
root:
    level: info
    pattern: '%{timestamp} %{level} [%{name}] %{log_position}: %{message} %{meta}'
    console:
        enabled: true
        colors: true
        format: plain
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

### 控制台 format 选项

`console.format` 控制控制台输出的格式，可选值：

| 取值    | 说明                                  | 输出字段                                                                |
| ------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `plain` | 按 `pattern` 模板渲染的纯文本（默认） | 由 `pattern` 决定                                                       |
| `json`  | 单行 JSON，便于日志采集器解析         | `level` / `message` / `timestamp` / `name` / `meta` / `traceId`（可选） |

JSON 模式下的行为：

- 自动关闭 `colorize`（避免 ANSI 转义序列污染 JSON）
- 当 `AsyncLocalStorage` 中存在 `traceId` 时，作为顶层字段输出
- 不再使用 `pattern` 模板，配置中 `colors` 字段在 JSON 模式下不生效

```yaml
# 生产环境推荐：输出 JSON 供 Filebeat / Vector 等采集
root:
    console:
        format: json
```

### Pattern 占位符

| 占位符            | 说明                             |
| ----------------- | -------------------------------- |
| `%{timestamp}`    | ISO 8601 时间戳                  |
| `%{level}`        | 日志级别                         |
| `%{name}`         | logger 名称                      |
| `%{traceId}`      | traceId 上下文（无值时显示 `-`） |
| `%{log_position}` | 调用位置（文件:行号:列号）       |
| `%{message}`      | 日志消息                         |
| `%{meta}`         | 元数据（JSON 字符串）            |

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
import { LoggerFactory, ConfigLoader, LogPosition, LoggerContext, SensitiveMasker } from '@jintianxiayu/logger';
import type {
    LoggerConfig,
    LoggerOptions,
    LogLevelName,
    ConsoleConfig,
    FileConfig,
    ShutdownOptions,
    LoggerInterface,
    SensitiveFieldConfig,
    SensitiveMaskingConfig,
} from '@jintianxiayu/logger';
```

## 默认配置

```yaml
root:
    level: info
    pattern: '%{timestamp} %{level} [%{name}] [%{traceId}] %{log_position}: %{message} %{meta}'
    console:
        enabled: true
        colors: true
        format: plain
    file:
        enabled: false
        dirname: ./logs
        filename: app.log
        datePattern: 'YYYY-MM-DD'
        maxSize: 10m
        maxFiles: 7d
```

## 敏感信息脱敏

自动识别并脱敏日志中的敏感字段，防止密码、信用卡、手机号等信息泄露。

### 默认脱敏字段

| 字段                                      | 脱敏模板                 | 示例                                        |
| ----------------------------------------- | ------------------------ | ------------------------------------------- |
| `password`, `passwd`, `pwd`               | `********`               | `secret123` → `********`                    |
| `token`, `apiKey`, `api_key`, `secretKey` | `********`               | `tk_abc` → `********`                       |
| `accessToken`, `refreshToken`             | `********`               | `eyJhbGci` → `********`                     |
| `phone`, `mobile`, `mobileNo`             | `*** *** {last4}`        | `13812345678` → `*** *** 5678`              |
| `creditCard`, `cardNo`, `bankAccount`     | `**** **** **** {last4}` | `4111111111111111` → `**** **** **** 1111`  |
| `idCard`, `idNumber`                      | `**************{last4}`  | `110101199001011234` → `**************1234` |
| `email`                                   | `{first2}***@{domain}`   | `user@example.com` → `us***@example.com`    |

### 脱敏模板语法

| 模板       | 说明             | 示例                           |
| ---------- | ---------------- | ------------------------------ |
| `{firstN}` | 保留前 N 个字符  | `{first2}`: `abc` → `ab*`      |
| `{lastN}`  | 保留后 N 个字符  | `{last4}`: `123456` → `**3456` |
| `{domain}` | 邮箱域名部分     | `@example.com`                 |
| `*`        | 单个星号保持不变 | `********`                     |

### 使用示例

```typescript
const logger = LoggerFactory.getLogger('security');

// 敏感字段自动脱敏
logger.info('用户登录', {
    userId: 'u12345',
    email: 'user@example.com',
    password: 'secret123', // → ********
    creditCard: '4111111111111111', // → **** **** **** 1111
});
```

### 配合 HTTP 中间件使用

```typescript
app.use((req, res, next) => {
    // 请求日志自动脱敏
    logger.info('received request', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        auth: req.headers.authorization, // → ********
    });
    next();
});
```

## TraceContext - traceId 追踪

LoggerContext 提供基于 AsyncLocalStorage 的上下文传递，支持 traceId 在异步调用链中自动传递。

```typescript
import { LoggerFactory, LoggerContext } from '@jintianxiayu/logger';

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

| 方法                                    | 说明                                   |
| --------------------------------------- | -------------------------------------- |
| `LoggerContext.set(key, value)`         | 设置上下文值                           |
| `LoggerContext.get(key)`                | 获取上下文值                           |
| `LoggerContext.clear()`                 | 清空当前上下文                         |
| `LoggerContext.withContext(values, fn)` | 在给定上下文中执行函数，执行后自动清理 |
| `LoggerContext.getStore()`              | 获取当前存储（高级用法）               |

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
