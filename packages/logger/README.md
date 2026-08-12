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

未设置 `LOGGER_CONFIG_PATH` 且当前目录不存在 `logger.yaml` 时，logger 会安静使用内置默认配置。显式设置的路径不存在或配置非法时：

- `LoggerFactory.init()` 会抛出 `ConfigError`，适合生产启动时快速失败。
- 首次 `getLogger()` 的懒加载模式会输出警告，并完整回退到内置默认配置。

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
    sensitiveMasking:
        enabled: true
        fields:
            - field: password
              mask: '******'
            - field: customSecret
              mask: '********'

loggers:
    database:
        level: debug
        sensitiveMasking:
            fields:
                - field: password
                  mask: 'DB-REDACTED'
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

优雅关闭。等待日志 transport 完成关闭，最长等待 `timeout` 毫秒（默认 5000ms）；到达 timeout 后关闭调用正常完成，不再无限等待底层 transport。

```typescript
await LoggerFactory.shutdown({ timeout: 3000 });
```

- 同一轮并发调用共享关闭过程：只关闭一次，所有调用方等待相同结果；首个调用的 `timeout` 和 `onShutdown` 生效。
- 关闭期间 `init()` 和 `getLogger()` 会抛出 `LoggerFactory is shutting down`，调用方应先停止业务入口再关闭 logger。
- 正常完成、超时或关闭失败后都会清理配置与 logger 缓存；恢复使用时应重新调用 `init()` 或 `getLogger()`，不要继续保存关闭前的 logger 引用。
- `onShutdown` 在内部状态清理后每轮最多执行一次；回调抛出的错误会由 `shutdown()` 返回。

### LoggerFactory.setupShutdownHandlers(options?)

注册进程信号处理。收到 SIGTERM/SIGINT 时自动调用 shutdown；相同信号重复注册是幂等的，部分重叠的信号列表只会补充尚未注册的 listener。任一已注册信号触发后，LoggerFactory 会移除自己注册的全部信号处理器，等待关闭完成并请求进程正常退出。

```typescript
LoggerFactory.setupShutdownHandlers({ timeout: 5000 });
```

推荐停机顺序：停止接收新请求，等待正在处理的业务任务，再调用 `shutdown()`；如果使用自动信号处理器，应在应用启动时只配置一次。LoggerFactory 只会清理自己注册的 listener，不影响应用的其他信号监听器。

### Prerelease 生命周期验证与回滚

发布正式版本前建议在容器环境验证一次 SIGTERM：持续写入带唯一标识的日志，发送 SIGTERM，确认最后一条日志已落盘、进程在 `timeout` 上限内退出，且没有重复退出或 listener/open-handle 告警。监控退出耗时、丢失日志数量、非零退出码和重启次数。

如果信号处理行为出现回归，可回滚 logger 包版本；过渡期间可不调用 `setupShutdownHandlers()`，改由应用自己的停机钩子在停止业务流量后单次 `await LoggerFactory.shutdown()`。无需配置或数据迁移。

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

推荐配置键为 `sensitiveMasking`。历史键 `sensitive-masking` 在当前兼容周期内仍可使用，但已经弃用；同一配置对象中不能同时配置两个键。

规则按以下顺序合并，并按 `field` 精确、大小写敏感地覆盖或追加：

```text
内置规则 → root 自定义规则 → 命名 logger 自定义规则
```

- 同名自定义规则覆盖上一层的 mask。
- 新字段追加到继承规则，未覆盖的默认规则继续生效。
- `fields: []` 保留继承规则，不会清空默认规则。
- `enabled: false` 仅关闭当前有效配置对应 logger 的脱敏，不影响其他 logger。

```yaml
root:
    sensitiveMasking:
        enabled: true
        fields:
            - field: password
              mask: '******'
            - field: customSecret
              mask: '********'

loggers:
    audit:
        sensitiveMasking:
            fields:
                - field: password
                  mask: 'AUDIT-REDACTED'
    local-debug:
        sensitiveMasking:
            enabled: false
```

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
        token: req.headers.authorization, // 默认 token 规则 → ********
    });
    next();
});
```

### 配置校验与静默 Logger

`level`、`console`、`file`、`pattern` 和 `sensitiveMasking` 都会经过严格结构校验，未知字段也会被拒绝。错误信息包含完整配置路径，例如 `loggers.database.level`。

当某个 logger 的 console 与 file 均为 `enabled: false` 时，返回的 Logger 仍实现全部日志方法，但会安全静默：不输出、不抛异常，也不会产生 Winston 的无 transport 警告。

### 灰度与回滚

建议先发布 prerelease，在真实服务中验证自定义字段、命名 logger 覆盖以及日志采集格式。若局部脱敏模板影响排查，可临时对指定命名 logger 设置 `sensitiveMasking.enabled: false`；若配置兼容出现整体问题，应回滚 logger 包版本，不建议在生产环境全局关闭默认脱敏。

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
