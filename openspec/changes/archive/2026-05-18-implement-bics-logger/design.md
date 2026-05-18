# @bics/logger 技术设计

## Context

@bics/logger 是 bics-commons monorepo 中的日志工厂包，提供 SLF4J 风格的日志 API。当前实现仅为简单的 Console Logger，需升级为基于 Winston 的生产级日志库。

### 现有实现

```
packages/logger/src/
└── index.ts  # 简单的 Console Logger，52 行代码
```

### 目标实现

- 基于 Winston 3.x
- 支持 YAML 配置文件
- 支持命名 logger
- 支持配置继承
- 支持优雅关闭

## Goals / Non-Goals

**Goals:**
- 提供 SLF4J 风格的 `LoggerFactory.getLogger(name)` API
- 支持 YAML 配置文件，通过 `LOGGER_CONFIG_PATH` 环境变量指定
- 支持配置继承，命名 logger 未配置的选项从 root 继承
- 支持 `%{log_position}` 占位符，自动捕获调用位置
- 支持 Console 和 File (按天轮转) 两种 Transport
- 提供显式初始化 `LoggerFactory.init()`，配置错误时抛异常
- 提供懒加载初始化 `LoggerFactory.getLogger()`，配置错误时降级 + warn
- 提供优雅关闭 `LoggerFactory.shutdown()` 和 `setupShutdownHandlers()`

**Non-Goals:**
- 不支持远程 Transport（如 HTTP、TCP）
- 不支持动态配置更新（运行时修改配置）
- 不支持 MDC/ThreadLocal 上下文

## Decisions

### Decision 1: LogPosition 调用栈解析

**选择**: stacktrace-parser + 多层过滤

**原因**:
- 不修改全局状态（vs `Error.prepareStackTrace` 会修改全局）
- 不依赖 V8 特定 API（vs `Error.prepareStackTrace` 仅 V8 支持）

**实现**:
```typescript
private static readonly EXCLUDE_PATTERNS = [
  /node_modules\/@bics\/logger/,
  /node_modules\/winston/,
  /node_modules\/stacktrace-parser/,
  /node_modules\/winston-daily-rotate-file/,
  /node:internal/,
];

private static readonly EXCLUDE_METHOD_PREFIXES = [
  'Logger.',
  'LoggerFactory.',
  'Formatter.',
  'PatternFormatter.',
  'Transport.',
];

static capture(): string {
  const stack = stackTrace.parse(new Error().stack!);
  for (let i = 2; i < stack.length; i++) {
    if (!this.isInternalFrame(stack[i])) {
      return `${frame.fileName}:${frame.lineNumber}:${frame.columnNumber}`;
    }
  }
}
```

**替代方案考虑**:
- `Error.prepareStackTrace`: 性能更好但有全局副作用
- 固定偏移 `stack[2]`: 简单但调用链变化就失效

---

### Decision 2: Pattern 格式化

**选择**: Winston 内联 formatter

**原因**:
- Winston 原生支持，可与其他 format 组合
- 减少维护的代码量
- Winston 会优化性能

**实现**:
```typescript
const myFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, name, log_position, message, meta }) => {
    return `${timestamp} ${level} [${name}] ${log_position}: ${message} ${JSON.stringify(meta)}`;
  })
);
```

**替代方案考虑**:
- 自定义 PatternFormatter + 预编译正则: 需要额外维护模块
- 6 次 `.replace()`: 性能稍差但实现简单

---

### Decision 3: 配置合并策略

**选择**: 递归合并（JSON Merge Patch 风格）

**原因**:
- 支持深层配置覆盖，不需要重复父级所有字段
- 与 YAML 继承语义一致

**实现**:
```typescript
function merge(target: any, source: any): any {
  if (isObject(target) && isObject(source)) {
    const result = { ...target };
    for (const key in source) {
      result[key] = merge(target[key], source[key]);
    }
    return result;
  }
  return source;
}
```

**效果**:
```yaml
root:
  console:
    enabled: true
    colors: true
loggers:
  db:
    console:
      enabled: false  # colors 保留
```

---

### Decision 4: 配置校验与加载策略

**选择**: 双模式初始化

**原因**:
- 生产环境需要快速失败，不带病运行
- 开发环境或配置可选场景需要容错能力

**实现**:

```typescript
// 模式A: 显式初始化（严格模式）
LoggerFactory.init();  // 配置错误抛异常

// 模式B: 懒加载（宽容模式）
const logger = LoggerFactory.getLogger('db');  // 配置错误降级 + warn
```

```typescript
private static lazyInit(): void {
  try {
    this.config = ConfigLoader.load();
    validateConfig(this.config);
    this.initialized = true;
  } catch (error) {
    console.warn(`[WARN] Logger config error: ${error.message}`);
    console.warn('[WARN] Using default config.');
    this.config = this.getDefaultConfig();
    this.initialized = true;
  }
}
```

---

### Decision 5: 优雅关闭

**选择**: 提供 `shutdown()` 和 `setupShutdownHandlers()`

**实现**:
```typescript
interface ShutdownOptions {
  timeout?: number;        // 默认 5000ms
  onShutdown?: () => void;
}

static async shutdown(options?: ShutdownOptions): Promise<void> {
  if (this.isShuttingDown) return;
  this.isShuttingDown = true;

  await Promise.race([
    this.container.close(),
    this.timeout(options?.timeout ?? 5000)
  ]);

  options?.onShutdown?.();
}

// 自动注册信号处理
static setupShutdownHandlers(options?: ShutdownOptions): void {
  const shutdown = async (signal: string) => {
    await this.shutdown(options);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
```

---

### Decision 6: Meta 输出

**选择**: 全部参数合并为 JSON 字符串

**实现**:
```typescript
const metaStr = JSON.stringify(meta.map(m => {
  if (m instanceof Error) {
    return { message: m.message, stack: m.stack };
  }
  return m;
}));
```

**效果**:
```typescript
logger.info('user login', { userId: 123 }, { ip: '192.168.1.1' });
// %{meta} = '[{"userId":123},{"ip":"192.168.1.1"}]'
```

---

## 模块设计

| 模块 | 路径 | 功能 | 依赖 |
|------|------|------|------|
| types | `src/types/index.ts` | 类型定义 | - |
| defaultConfig | `src/config/defaultConfig.ts` | 默认配置 | - |
| ConfigLoader | `src/core/ConfigLoader.ts` | YAML 加载、校验、缓存 | yaml |
| LogPosition | `src/core/LogPosition.ts` | 调用栈解析 | stacktrace-parser |
| LoggerFactory | `src/core/LoggerFactory.ts` | 工厂主体 | ConfigLoader, LogPosition |
| index | `src/index.ts` | 导出 | LoggerFactory |

## API 设计

### LoggerFactory.init()

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 无 | - | - | - | 显式初始化配置 |

**行为**:
- 加载并校验配置文件
- 成功则缓存配置，后续 getLogger 直接使用
- 失败则抛出异常

### LoggerFactory.getLogger(name: string): Logger

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 是 | - | logger 名称 |

**行为**:
- 未 init 时懒加载配置
- 加载成功则缓存并返回 logger
- 加载失败则降级到默认配置 + warn，返回 logger

### LoggerFactory.shutdown(options?: ShutdownOptions): Promise<void>

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| options.timeout | number | 否 | 5000 | 最大等待时间(ms) |
| options.onShutdown | () => void | 否 | - | 关闭完成回调 |

### LoggerFactory.setupShutdownHandlers(options?: ShutdownOptions): void

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| options.timeout | number | 否 | 5000 | shutdown 等待时间(ms) |
| options.signals | string[] | 否 | ['SIGTERM', 'SIGINT'] | 监听的信号 |

### Logger.debug/info/warn/error(message: string, ...meta: unknown[]): void

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| message | string | 是 | - | 日志消息 |
| ...meta | unknown[] | 否 | [] | 元数据，支持 Error 对象 |

---

## 配置文件结构

```yaml
root:
  level: info
  format: plain
  pattern: '%{timestamp} %{level} %{name} %{log_position}: %{message} %{meta}'
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

---

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| LogPosition 解析在不同调用链深度下可能不稳定 | 使用多层过滤而非固定偏移，预留 Fallback |
| Winston 内部实现变化可能影响 LogPosition 过滤规则 | 监控 Winston 版本更新，测试验证 |
| 懒加载模式下配置错误可能被延迟发现 | init() 模式用于生产环境，发现即失败 |

---

## Open Questions

1. 是否需要支持 `root.loggers` 继承 `root` 的配置？（当前设计是 loggers 和 root 平级）
2. `format: json` 时 pattern 是否仍然生效？还是直接输出 JSON？
3. 是否需要支持日志采样（sampling）功能？