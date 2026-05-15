# @bics/logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现日志工厂，支持命名 logger、配置继承、YAML 文件加载

**Architecture:** 使用 Winston Container 管理多 logger，通过 YAML 配置文件定义 root 和命名 logger 配置。配置在首次调用 `getLogger()` 时延迟加载。

**Tech Stack:** winston, winston-daily-rotate-file, yaml, stacktrace-parser

---

## File Structure

```
packages/logger/src/
├── index.ts                    # 导出 LoggerFactory
├── core/
│   ├── LoggerFactory.ts        # getLogger 实现，配置加载
│   ├── LogPosition.ts          # 调用栈解析获取 log_position
│   └── ConfigLoader.ts         # YAML 配置解析
├── formatters/
│   └── PatternFormatter.ts     # pattern 格式化
├── config/
│   └── defaultConfig.ts        # 内置默认配置
└── types/
    └── index.ts                # 类型定义
```

---

## Task 1: 类型定义

**Files:**
- Create: `packages/logger/src/types/index.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export type LogFormat = 'plain' | 'json';

export interface ConsoleConfig {
  enabled: boolean;
}

export interface FileConfig {
  enabled: boolean;
  dirname?: string;
  filename?: string;
  datePattern?: string;
  maxSize?: string;
  maxFiles?: string | number;
}

export interface RootConfig {
  level: LogLevel;
  format: LogFormat;
  pattern: string;
  console: ConsoleConfig;
  file: FileConfig;
}

export interface LoggerConfig extends Partial<RootConfig> {
  name: string;
}

export interface Config {
  root: RootConfig;
  loggers: Record<string, LoggerConfig>;
}

export interface LogMessage {
  timestamp: string;
  level: string;
  name: string;
  message: string;
  meta?: unknown[];
  log_position?: string;
}
```

- [ ] **Step 2: 提交**

```bash
cd packages/logger
git add src/types/index.ts
git commit -m "feat(logger): add type definitions"
```

---

## Task 2: 内置默认配置

**Files:**
- Create: `packages/logger/src/config/defaultConfig.ts`

- [ ] **Step 1: 创建默认配置**

```typescript
import { Config } from '../types';

export const defaultConfig: Config = {
  root: {
    level: 'info',
    format: 'plain',
    pattern: '%{timestamp} %{level} %{name} %{log_position}: %{message}',
    console: {
      enabled: true,
    },
    file: {
      enabled: false,
    },
  },
  loggers: {},
};
```

- [ ] **Step 2: 提交**

```bash
cd packages/logger
git add src/config/defaultConfig.ts
git commit -m "feat(logger): add default config"
```

---

## Task 3: LogPosition 调用栈解析

**Files:**
- Create: `packages/logger/src/core/LogPosition.ts`
- Modify: `packages/logger/package.json` (添加依赖)

- [ ] **Step 1: 添加 stacktrace-parser 依赖**

```bash
cd packages/logger
npm install stacktrace-parser
npm install -D @types/stacktrace-parser
```

- [ ] **Step 2: 创建 LogPosition.ts**

```typescript
import stackTrace from 'stacktrace-parser';

export const getLogPosition = (): string => {
  const stack = stackTrace.parse(new Error().stack!);
  // stack[0] = Error
  // stack[1] = getLogPosition
  // stack[2] = log method caller (Logger.info/debug/info/error)
  // stack[3] = actual caller (user code)
  const caller = stack[3];
  if (!caller) {
    return 'unknown:0:0';
  }
  // 移除 Node.js 内部路径，只保留相对路径
  const fileName = caller.fileName.replace(/^.*packages[\\\/]logger[\\\/]src/, 'src');
  return `${fileName}:${caller.lineNumber}:${caller.columnNumber}`;
};
```

- [ ] **Step 3: 提交**

```bash
cd packages/logger
git add src/core/LogPosition.ts package.json package-lock.json
git commit -m "feat(logger): add LogPosition for call stack parsing"
```

---

## Task 4: Pattern 格式化器

**Files:**
- Create: `packages/logger/src/formatters/PatternFormatter.ts`

- [ ] **Step 1: 创建 PatternFormatter**

```typescript
import winston from 'winston';
import { LogMessage } from '../types';
import { getLogPosition } from '../core/LogPosition';

const PLACEHOLDERS = {
  timestamp: (info: winston.Logform.TransformableInfo) => info.timestamp as string,
  level: (info: winston.Logform.TransformableInfo) => info.level.toUpperCase(),
  name: (info: winston.Logform.TransformableInfo) => info.label || '',
  message: (info: winston.Logform.TransformableInfo) => info.message as string,
  meta: (info: winston.Logform.TransformableInfo) => {
    const meta = Object.keys(info)
      .filter(key => !['timestamp', 'level', 'message', 'label'].includes(key))
      .reduce((obj, key) => ({ ...obj, [key]: info[key] }), {});
    return Object.keys(meta).length ? JSON.stringify(meta) : '';
  },
  log_position: () => getLogPosition(),
};

export const createPatternFormatter = (pattern: string): winston.Logform.Format => {
  return winston.format.printf(info => {
    let result = pattern;
    for (const [key, resolver] of Object.entries(PLACEHOLDERS)) {
      const placeholder = `%{${key}}`;
      if (result.includes(placeholder)) {
        result = result.replace(placeholder, resolver(info) || '');
      }
    }
    return result;
  });
};
```

- [ ] **Step 2: 提交**

```bash
cd packages/logger
git add src/formatters/PatternFormatter.ts
git commit -m "feat(logger): add PatternFormatter for printf-style formatting"
```

---

## Task 5: YAML 配置加载器

**Files:**
- Create: `packages/logger/src/core/ConfigLoader.ts`

- [ ] **Step 1: 创建 ConfigLoader.ts**

```typescript
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { Config } from '../types';
import { defaultConfig } from '../config/defaultConfig';

let cachedConfig: Config | null = null;

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return false;
};

const parseConfig = (data: unknown): Config => {
  const config = data as Record<string, unknown>;

  const root = config.root as Record<string, unknown> || {};
  const loggers = (config.loggers as Record<string, Record<string, unknown>>) || {};

  const parseFileConfig = (file: unknown): typeof defaultConfig.root.file => {
    if (!file || typeof file !== 'object') return defaultConfig.root.file;
    const f = file as Record<string, unknown>;
    return {
      enabled: parseBoolean(f.enabled),
      dirname: (f.dirname as string) || './logs',
      filename: (f.filename as string) || 'app.log',
      datePattern: (f.datePattern as string) || 'YYYY-MM-DD',
      maxSize: (f.maxSize as string) || '10m',
      maxFiles: (f.maxFiles as string) || '7d',
    };
  };

  return {
    root: {
      level: (root.level as string) || defaultConfig.root.level,
      format: (root.format as 'plain' | 'json') || defaultConfig.root.format,
      pattern: (root.pattern as string) || defaultConfig.root.pattern,
      console: {
        enabled: parseBoolean(root.console && (root.console as Record<string, unknown>).enabled),
      },
      file: parseFileConfig(root.file),
    },
    loggers: Object.entries(loggers).reduce((acc, [name, loggerConfig]) => {
      acc[name] = { name, ...loggerConfig } as typeof defaultConfig.loggers[string];
      return acc;
    }, {} as Record<string, typeof defaultConfig.loggers[string]>),
  };
};

export const loadConfig = (configPath?: string): Config => {
  if (cachedConfig) return cachedConfig;

  if (!configPath) {
    cachedConfig = defaultConfig;
    return cachedConfig;
  }

  if (!fs.existsSync(configPath)) {
    cachedConfig = defaultConfig;
    return cachedConfig;
  }

  const fileContent = fs.readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(fileContent);
  cachedConfig = parseConfig(parsed);
  return cachedConfig;
};

export const resetConfig = (): void => {
  cachedConfig = null;
};
```

- [ ] **Step 2: 提交**

```bash
cd packages/logger
git add src/core/ConfigLoader.ts
git commit -m "feat(logger): add ConfigLoader for YAML config parsing"
```

---

## Task 6: LoggerFactory 实现

**Files:**
- Create: `packages/logger/src/core/LoggerFactory.ts`

- [ ] **Step 1: 创建 LoggerFactory.ts**

```typescript
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { loadConfig, resetConfig } from './ConfigLoader';
import { createPatternFormatter } from '../formatters/PatternFormatter';
import { LogFormat, Config, LogLevel } from '../types';

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const container = new winston.Container();

const createTransports = (config: Config['root'], name: string) => {
  const transports: winston.transport[] = [];

  if (config.console.enabled) {
    const consoleFormat = config.format === 'json'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          createPatternFormatter(config.pattern)
        );

    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          consoleFormat
        ),
      })
    );
  }

  if (config.file.enabled) {
    const fileFormat = config.format === 'json'
      ? winston.format.json()
      : createPatternFormatter(config.pattern);

    transports.push(
      new (DailyRotateFile)({
        dirname: config.file.dirname,
        filename: config.file.filename,
        datePattern: config.file.datePattern,
        maxSize: config.file.maxSize,
        maxFiles: config.file.maxFiles,
        format: winston.format.combine(
          winston.format.timestamp(),
          fileFormat
        ),
        level: config.level,
      })
    );
  }

  return transports;
};

const createLoggerConfig = (config: Config['root'], loggerConfig: Config['loggers'][string]) => {
  const level = loggerConfig.level || config.level;
  const format = loggerConfig.format || config.format;
  const pattern = loggerConfig.pattern || config.pattern;

  // 合并配置（root 的未覆盖项 + logger 的覆盖项）
  const mergedConfig = {
    level,
    format,
    pattern,
    console: config.console,
    file: config.file,
  };

  return {
    level,
    format: format as LogFormat,
    pattern,
    transports: createTransports(
      { ...mergedConfig, ...loggerConfig } as Config['root'],
      loggerConfig.name
    ),
  };
};

export const LoggerFactory = {
  getLogger(name: string): winston.Logger {
    const config = loadConfig(process.env.LOGGER_CONFIG_PATH);

    let loggerConfig = config.loggers[name];

    // 如果没有命名配置，创建一个继承 root 的
    if (!loggerConfig) {
      loggerConfig = { name };
    }

    const loggerOptions = createLoggerConfig(config.root, loggerConfig);

    // 使用 container 获取或创建 logger
    let logger = container.get(name);

    if (!logger) {
      logger = container.add(name, {
        level: loggerOptions.level,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.label({ label: name }),
          loggerOptions.format === 'json'
            ? winston.format.json()
            : createPatternFormatter(loggerOptions.pattern)
        ),
        transports: loggerOptions.transports,
      });
    }

    return logger;
  },

  reset(): void {
    resetConfig();
    // 清除所有 logger
    container.close();
  },
};
```

- [ ] **Step 2: 提交**

```bash
cd packages/logger
git add src/core/LoggerFactory.ts
git commit -m "feat(logger): implement LoggerFactory with winston container"
```

---

## Task 7: 导出 LoggerFactory

**Files:**
- Modify: `packages/logger/src/index.ts`

- [ ] **Step 1: 更新 index.ts 导出**

```typescript
export { LoggerFactory } from './core/LoggerFactory';
export { LogLevel, LogFormat } from './types';
export type { Config, LoggerConfig } from './types';
```

- [ ] **Step 2: 提交**

```bash
cd packages/logger
git add src/index.ts
git commit -m "feat(logger): export LoggerFactory"
```

---

## Task 8: 依赖安装和构建验证

**Files:**
- Modify: `packages/logger/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd packages/logger
npm install winston winston-daily-rotate-file yaml stacktrace-parser
npm install -D @types/node @types/yaml
```

- [ ] **Step 2: 验证构建**

```bash
cd packages/logger
npm run build
```

预期：`dist/` 目录生成，包含编译后的 JS 和类型声明文件。

- [ ] **Step 3: 提交**

```bash
cd packages/logger
git add package.json package-lock.json
git commit -m "feat(logger): add dependencies (winston, winston-daily-rotate-file, yaml, stacktrace-parser)"
```

---

## Task 9: 功能验证

**Files:**
- Create: `packages/logger/test/index.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { LoggerFactory } from '../src/index';

describe('LoggerFactory', () => {
  afterEach(() => {
    LoggerFactory.reset();
  });

  it('should get logger with default config', () => {
    const logger = LoggerFactory.getLogger('test');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should return same logger for same name', () => {
    const logger1 = LoggerFactory.getLogger('test');
    const logger2 = LoggerFactory.getLogger('test');
    expect(logger1).toBe(logger2);
  });
});
```

- [ ] **Step 2: 运行测试验证**

```bash
cd packages/logger
npm test
```

预期：测试通过（即使测试用例较少，至少验证 API 可用）

---

## 验收标准

1. `LoggerFactory.getLogger(name)` 返回 winston Logger 实例
2. 未设置 `LOGGER_CONFIG_PATH` 时使用内置默认配置（INFO 级别，plain 格式）
3. 支持配置继承：命名 logger 未配置项继承 root
4. 支持 JSON 和 plain 两种格式
5. `npm run build` 成功构建 dist 目录

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-15-logger-implementation.md`**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?