# @bics/logger 设计文档

## 概述

提供日志功能，支持命名 logger、配置继承、YAML 配置文件加载。

## 核心依赖

- `winston` — 日志库
- `winston-daily-rotate-file` — 按天轮转文件 transport
- `yaml` — YAML 配置文件解析
- `stacktrace-parser` — 调用栈解析（获取 log_position）

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOGGER_CONFIG_PATH` | YAML 配置文件路径 | 使用内置默认配置 |

## 配置结构

```yaml
root:
  level: info           # debug | info | warn | error
  format: plain        # plain | json
  pattern: '%{timestamp} %{level} %{name} %{log_position}: %{message}'
  console:
    enabled: true
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

### 配置项说明

| 配置项 | 说明 |
|--------|------|
| `root` | 默认配置，所有 logger 继承 |
| `root.level` | 日志级别 |
| `root.format` | 输出格式：`plain`（格式化文本）或 `json` |
| `root.pattern` | plain 格式的模板，仅 format=plain 时生效 |
| `root.console.enabled` | 是否启用控制台输出 |
| `root.file.enabled` | 是否启用文件输出 |
| `root.file.dirname` | 日志文件目录 |
| `root.file.filename` | 日志文件名模板 |
| `root.file.datePattern` | 文件轮转日期格式 |
| `root.file.maxSize` | 单文件最大大小 |
| `root.file.maxFiles` | 保留的最大文件数 |
| `loggers` | 命名 logger 集合 |
| `loggers[name]` | 命名 logger 配置，未配置的项继承 root |

### Pattern 占位符

| 占位符 | 说明 |
|--------|------|
| `%{timestamp}` | ISO 8601 时间戳 |
| `%{level}` | 日志级别（大写） |
| `%{name}` | logger 名称 |
| `%{log_position}` | 调用位置（文件:行号） |
| `%{message}` | 日志消息 |
| `%{meta}` | 元数据（JSON 字符串） |

## 默认配置

环境变量未设置时使用：

```yaml
root:
  level: info
  format: plain
  pattern: '%{timestamp} %{level} %{name} %{log_position}: %{message}'
  console:
    enabled: true
  file:
    enabled: false
loggers: {}
```

## API

```typescript
import { LoggerFactory } from '@bics/logger';

// 获取 logger（首次调用时加载配置）
const logger = LoggerFactory.getLogger('database');
logger.info('connection opened');
logger.debug('query executed', { duration: 42 });
```

### Logger 方法

- `debug(message: string, ...meta: unknown[]): void`
- `info(message: string, ...meta: unknown[]): void`
- `warn(message: string, ...meta: unknown[]): void`
- `error(message: string, ...meta: unknown[]): void`

## 项目结构

```
packages/logger/
├── src/
│   ├── index.ts              # 导出 LoggerFactory
│   ├── core/
│   │   ├── LoggerFactory.ts  # getLogger 实现
│   │   ├── ConfigLoader.ts   # YAML 加载器
│   │   └── LogPosition.ts    # 调用栈解析
│   ├── formatters/
│   │   └── PatternFormatter.ts  # pattern 格式化
│   ├── config/
│   │   └── defaultConfig.ts  # 内置默认配置
│   └── types/
│       └── index.ts          # 类型定义
├── package.json
└── tsconfig.json
```

## 配置加载流程

1. 首次 `getLogger(name)` 调用时触发配置加载
2. 检查 `LOGGER_CONFIG_PATH` 环境变量
3. 存在则解析 YAML 文件；不存在则使用内置默认配置
4. 解析结果存储在内存中，后续调用直接使用缓存
5. root 配置作为所有命名 logger 的基础
6. 命名 logger 未配置的项从 root 继承

## 继承机制

命名 logger 的配置项覆盖规则：
- 配置了则完全覆盖，不做递归合并
- 未配置则继承 root 的值

示例：

```yaml
root:
  level: info
  format: json
  console:
    enabled: true

loggers:
  database:
    level: debug     # 覆盖
    # format 继承 root 的 json
    # console 继承 root 的 { enabled: true }
  audit:
    level: warn
    format: plain    # 覆盖
    pattern: '%{timestamp} AUDIT: %{message}'
```

## 输出示例

### plain format

```
2026-05-15T15:30:00.000Z INFO database src/services/db.ts:42: connection opened
```

### json format

```json
{"timestamp":"2026-05-15T15:30:00.000Z","level":"INFO","name":"database","message":"connection opened","meta":{"position":"src/services/db.ts:42"}}
```

## 实现要点

### log_position 获取

使用 `stacktrace-parser` 解析调用栈，获取调用位置信息：

```typescript
import stackTrace from 'stacktrace-parser';

const getLogPosition = (): string => {
  const stack = stackTrace.parse(new Error().stack!);
  // 找到 logger 调用位置（跳过 Logger 内部帧）
  const caller = stack[2]; // index 根据调用链调整
  return `${caller.fileName}:${caller.lineNumber}:${cader.columnNumber}`;
};
```

### Winston 集成

使用 Winston Container 管理多个 logger：

```typescript
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const container = new winston.Container();
container.add(name, config);
```

### 配置文件监控（可选）

生产环境建议监控配置文件变化并重新加载日志配置。