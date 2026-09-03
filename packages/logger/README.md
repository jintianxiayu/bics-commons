# @jintianxiayu/logger

`@jintianxiayu/logger` 是一个面向 Node.js 应用的 Winston 日志封装。它提供命名日志器、YAML/对象配置、
Console 与轮转文件输出、结构化脱敏、异步 `traceId` 上下文，以及可等待日志刷新的显式关闭流程。

## 目录

- [要求与安装](#要求与安装)
- [快速开始](#快速开始)
- [配置](#配置)
- [日志与上下文](#日志与上下文)
- [输出格式](#输出格式)
- [敏感字段脱敏](#敏感字段脱敏)
- [进程错误与关闭](#进程错误与关闭)
- [公共 API](#公共-api)
- [常见问题](#常见问题)
- [开发](#开发)
- [许可证](#许可证)

## 要求与安装

- Node.js 20 或更高版本
- CommonJS 运行时；包内包含 TypeScript 类型声明

```bash
pnpm add @jintianxiayu/logger
```

也可以使用 `npm install @jintianxiayu/logger`。本仓库自身使用 pnpm 11。

## 快速开始

下面的示例显式关闭进程错误接管，适合由应用或框架统一处理未捕获异常的场景：

```ts
import { LoggerContext, LoggerFactory } from '@jintianxiayu/logger';

async function main(): Promise<void> {
    LoggerFactory.init({
        root: {
            console: {
                enabled: true,
                format: 'json',
            },
        },
        processErrors: {
            uncaughtException: false,
            unhandledRejection: false,
            exitOnError: false,
        },
    });

    const logger = LoggerFactory.getLogger('orders');

    await LoggerContext.withContext({ traceId: 'order-20260902-001' }, async () => {
        logger.info('Order created', {
            orderId: 'order-001',
            password: 'masked-before-output',
        });
    });

    await LoggerFactory.shutdown();
}

main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
});
```

CommonJS 调用方可以使用同一公共入口：

```js
const { LoggerFactory, LoggerContext } = require('@jintianxiayu/logger');
```

## 配置

### 配置来源与优先级

`LoggerFactory.init()` 接受配置对象或 YAML 文件路径：

```ts
LoggerFactory.init({ root: { level: 'debug' } });
LoggerFactory.init('./config/logger.yaml');
```

配置来源按以下顺序选择：

1. 传给 `LoggerFactory.init(source)` 的对象或路径；
2. `LOGGER_CONFIG_PATH` 环境变量指定的 YAML 路径；
3. 内置默认配置。

相对路径以 `process.cwd()` 为基准。显式来源无效时会直接抛错，不会回退到环境变量或默认值。
首次成功初始化后，后续 `init()` 调用保持幂等，不会重新读取或切换配置。未显式调用 `init()` 时，
第一次 `getLogger()` 会按相同规则延迟初始化。

### 配置项说明

所有配置项都是可选的。`root` 在内置默认值上合并，`loggers.<name>` 再深度继承合并后的 `root`，只覆盖
自己显式声明的字段。

#### 顶层配置

| 配置项          | 类型                            | 默认值              | 说明                                                              |
| --------------- | ------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `root`          | `LoggerOptions`                 | 内置根配置          | 定义所有日志器共享的级别、调用位置和输出方式                      |
| `loggers`       | `Record<string, LoggerOptions>` | `{}`                | 按名称覆盖 `root`；名称必须非空且不含首尾空白，并且区分大小写     |
| `masking`       | `SensitiveMaskingConfig`        | 启用内置策略        | 定义应用于所有日志器和输出通道的元数据脱敏规则                    |
| `processErrors` | 配置对象                        | 三个开关均为 `true` | 控制 Winston 对未捕获异常、未处理拒绝和进程退出的处理；字段见下表 |

`getLogger()` 会移除传入名称的首尾空白，并为同一个规范化名称返回同一实例。例如 `database` 与
`database` 返回同一个日志器，而 `Database` 是另一个名称。

#### 日志器配置

以下配置可用于 `root` 和任意 `loggers.<name>`。命名日志器未声明的值继承 `root`。

| 配置项               | 类型                             | `root` 默认值 | 说明                                                       |
| -------------------- | -------------------------------- | ------------- | ---------------------------------------------------------- |
| `level`              | `debug \| info \| warn \| error` | `info`        | 最低输出级别；例如 `info` 会输出 `info`、`warn` 和 `error` |
| `captureLogPosition` | `boolean`                        | `true`        | 是否允许采集调用位置；只有启用的输出实际需要位置时才会采集 |
| `console`            | `ConsoleConfig`                  | 见下表        | 控制标准输出的启用状态、格式、颜色和模板                   |
| `file`               | `FileConfig`                     | 见下表        | 控制轮转文件输出、目录、文件名和保留策略                   |

#### Console 配置

| 配置项            | 类型            | `root` 默认值   | 说明                                                         |
| ----------------- | --------------- | --------------- | ------------------------------------------------------------ |
| `console.enabled` | `boolean`       | `true`          | 是否启用 Console 输出                                        |
| `console.colors`  | `boolean`       | `false`         | 是否为 Plain 输出的日志级别添加 ANSI 颜色；JSON 输出忽略该项 |
| `console.format`  | `plain \| json` | `plain`         | Console 输出格式；JSON 始终输出无 ANSI 颜色的单行对象        |
| `console.pattern` | `string`        | 内置 Plain 模板 | Plain 输出模板；仅在最终格式为 `plain` 时校验和使用          |

内置 Plain 模板为：

```text
%{timestamp} %{level} [%{name}] [%{traceId}] %{log_position}: %{message} %{meta}
```

模板支持的占位符及缺失值行为见[输出格式](#输出格式)。

#### File 配置

| 配置项             | 类型               | `root` 默认值   | 说明                                                                    |
| ------------------ | ------------------ | --------------- | ----------------------------------------------------------------------- |
| `file.enabled`     | `boolean`          | `false`         | 是否启用轮转文件输出                                                    |
| `file.format`      | `plain \| json`    | `json`          | 文件内容格式；JSON 为单行对象，Plain 使用 `file.pattern`                |
| `file.pattern`     | `string`           | 内置 Plain 模板 | Plain 文件模板；仅在最终格式为 `plain` 时校验和使用                     |
| `file.dirname`     | `string`           | `./logs`        | 日志目录；相对路径以 `process.cwd()` 为基准解析                         |
| `file.filename`    | `string`           | `app.log`       | 轮转文件名；未包含 `%DATE%` 时会在扩展名前自动插入日期占位符            |
| `file.datePattern` | `string`           | `YYYY-MM-DD`    | 传给轮转文件传输的日期格式                                              |
| `file.maxSize`     | `number \| string` | `10m`           | 单个文件的大小上限；接受正数字节数或带可选 `k`、`m`、`g` 单位的正数文本 |
| `file.maxFiles`    | `number \| string` | `7d`            | 保留的文件数或天数；接受正整数、数字文本，或 `7d` 形式的天数文本        |

例如，默认文件名最终会生成类似 `app-2026-09-02.log` 的文件。同一物理文件目标不能混用不同输出格式，
也不能声明冲突的轮转配置，否则初始化失败。

#### 脱敏配置

| 配置项            | 类型                     | 默认值 | 说明                                                                   |
| ----------------- | ------------------------ | ------ | ---------------------------------------------------------------------- |
| `masking.enabled` | `boolean`                | `true` | 是否对元数据递归应用内置和自定义字段策略                               |
| `masking.fields`  | `Record<string, string>` | `{}`   | 自定义字段与掩码模板；字段匹配不区分大小写，重复名称或无效模板会被拒绝 |

自定义模板支持的语法和内置敏感字段见[敏感字段脱敏](#敏感字段脱敏)。

#### 进程错误配置

| 配置项                             | 类型      | 默认值 | 说明                                    |
| ---------------------------------- | --------- | ------ | --------------------------------------- |
| `processErrors.uncaughtException`  | `boolean` | `true` | 是否让根输出处理未捕获异常              |
| `processErrors.unhandledRejection` | `boolean` | `true` | 是否让根输出处理未处理的 Promise 拒绝   |
| `processErrors.exitOnError`        | `boolean` | `true` | 是否由 Winston 在处理进程错误后退出进程 |

启用 `uncaughtException` 或 `unhandledRejection` 时，`root.console` 与 `root.file` 必须至少启用一个。
如果应用框架自行管理致命错误和退出流程，应显式关闭相应选项。

路径、文件名、日期格式、Plain 模板和脱敏模板等字符串配置不能为空。未知字段、错误类型、无效级别或格式、
错误模板和冲突文件目标都会在初始化阶段被拒绝。

## 日志与上下文

日志器支持四个级别：`debug`、`info`、`warn` 和 `error`。

```ts
const logger = LoggerFactory.getLogger('database');

logger.debug('Query started', { sqlId: 'query-001' });
logger.info('Query completed', { durationMs: 12 });
logger.warn('Pool utilization is high', { utilization: 0.9 });
logger.error('Query failed', new Error('connection lost'));
```

`message` 必须是字符串；运行时收到非字符串消息会抛出 `TypeError`。一个普通对象元数据参数会直接成为
`meta`；其他参数组合会放入 `meta.args`。`Error`、日期、循环引用和常见非 JSON 值会先转换为稳定的
可序列化结构，元数据处理失败时会降级为安全占位值，不中断主日志调用。

`LoggerContext.withContext()` 使用异步上下文隔离并继承嵌套值：

```ts
await LoggerContext.withContext({ traceId: 'request-001', tenant: 'north' }, async () => {
    logger.info('Handling request');
    const tenant = LoggerContext.get<string>('tenant');
});
```

只有非空字符串 `traceId` 会自动进入日志事件；其他上下文字段可通过 `LoggerContext.get()` 读取，但不会
自动输出。并发异步调用链之间的上下文相互隔离，回调完成、抛错或拒绝后会恢复父级上下文。

## 输出格式

JSON 输出为单行对象，固定包含 `timestamp`、`level`、`name` 和 `message`，并按实际数据添加
`traceId`、`logPosition` 与 `meta`。JSON 输出不会包含 ANSI 颜色。

Plain 输出可以通过 `pattern` 组合以下占位符：

| 占位符            | 输出内容                                             | 缺失值与特殊行为                                        |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `%{timestamp}`    | 日志事件生成时的 ISO 8601 UTC 时间                   | 始终存在                                                |
| `%{level}`        | `debug`、`info`、`warn` 或 `error`                   | Console 的 Plain 输出启用 `colors` 时会包含 ANSI 颜色码 |
| `%{name}`         | `LoggerFactory.getLogger(name)` 对应的命名日志器名称 | 进程异常和未处理拒绝使用 `root`                         |
| `%{traceId}`      | 当前 `LoggerContext` 中的非空字符串 `traceId`        | 未设置或不是非空字符串时输出 `-`                        |
| `%{log_position}` | 发起日志调用的源码位置，格式为 `file:line`           | 未采集到位置时输出 `-`；不包含列号                      |
| `%{message}`      | 传给日志方法的字符串消息                             | 始终存在；消息中的占位符文本不会再次展开                |
| `%{meta}`         | 完成规范化和脱敏后的元数据 JSON                      | 没有元数据时输出 `-`；序列化失败时输出安全占位对象      |

占位符名称区分大小写，可以与任意普通文本组合并重复使用。未知占位符或未闭合的 `%{...}` 会在
初始化阶段触发配置错误。只有 `pattern` 本身会进行占位符替换，`message` 和 `meta` 中的同名文本均按
原始业务数据输出。

缺失的可选值在 Plain 输出中显示为 `-`。当 `captureLogPosition` 启用且输出格式需要调用位置时，
`logPosition` 使用 `file:line`，不包含列号。

Console 和 File 可以分别选择 `plain` 或 `json`。文件输出使用日期/大小轮转；同一物理文件目标不能
混用不同格式或冲突的轮转配置。

## 敏感字段脱敏

脱敏在所有输出通道之前递归执行，字段名匹配不区分大小写，并且不会修改调用方传入的对象。

内置策略包括：

- `password`、`token`、`authorization`、`cookie` 等凭证字段完整替换为 `********`；
- `phone`、`creditCard`、`bankAccount`、`idNumber` 等号码字段只保留末四位；
- `email` 在格式有效时保留前两个字符和域名，否则完整遮盖。

自定义模板支持普通文本以及 `{firstN}`、`{lastN}`、`{domain}`，其中 `N` 是正整数。动态模板遇到过短值、
复杂对象或无效邮箱时会使用完整掩码。模板语法在初始化阶段校验。

> 脱敏只处理元数据字段，不解析 `message` 文本。不要把令牌、密码或个人信息拼接进日志消息。

## 进程错误与关闭

默认配置会让 Winston 捕获未处理的异常和 Promise 拒绝，并启用 `exitOnError`。如果应用框架已有自己的
致命错误处理和退出流程，应在初始化配置中显式关闭相应选项。启用任一进程错误处理器时，根日志器必须
至少启用一个 Console 或 File 输出。

本库不注册 `SIGINT` 或 `SIGTERM` 处理器。应用应在自己的生命周期钩子中显式等待关闭：

```ts
await LoggerFactory.shutdown({ timeout: 5_000 });
```

- 默认超时为 5 秒，`timeout` 必须是正整数毫秒值；
- 多次调用共享同一个关闭结果，不会重复结束 Winston 流；
- 关闭会等待 Winston `finish`，并等待轮转文件流关闭；日志器、传输或文件流报错以及超时都会拒绝 Promise；
- 开始关闭后，已有日志器的新写入会被忽略，且不能再初始化或获取日志器；默认工厂在同一进程中不能重新打开。

`shutdown()` 只能确认本库交给 Winston 传输的日志已完成本地关闭流程，不代表外部日志采集或存储平台已经持久化。

## 公共 API

包根入口只导出以下运行时符号：

| 符号                                          | 用途                                                |
| --------------------------------------------- | --------------------------------------------------- |
| `LoggerFactory.init(source?)`                 | 使用对象、YAML 路径、环境变量或默认值初始化单例工厂 |
| `LoggerFactory.getLogger(name)`               | 获取缓存的命名日志器；必要时延迟初始化              |
| `LoggerFactory.shutdown(options?)`            | 停止接收新日志并等待当前传输完成关闭                |
| `LoggerContext.withContext(values, callback)` | 在同步或异步回调范围内合并上下文                    |
| `LoggerContext.get(key)`                      | 读取当前异步调用链中的上下文字段                    |

`LoggerFactory.getLogger()` 返回的日志器实现 `LoggerInterface`：

```ts
interface LoggerInterface {
    debug(message: string, ...meta: unknown[]): void;
    info(message: string, ...meta: unknown[]): void;
    warn(message: string, ...meta: unknown[]): void;
    error(message: string, ...meta: unknown[]): void;
}
```

公开类型还包括 `ConsoleConfig`、`FileConfig`、`LoggerConfig`、`LoggerInterface`、`LoggerOptions`、
`LogLevelName`、`SensitiveFieldConfig`、`SensitiveMaskingConfig` 和 `ShutdownOptions`。内部加载器、格式器、
传输工厂和生命周期错误类不属于包根公共 API，请勿从 `dist/` 子路径导入。

## 常见问题

### 配置文件没有生效

确认 `LoggerFactory.init()` 只在首次成功初始化前调用。已经初始化的工厂不会热加载配置。相对配置路径和
日志目录都以进程启动时的 `process.cwd()` 为基准。

### 关闭时超时或报错

`shutdown()` 会等待控制台/文件传输及轮转文件流。先检查磁盘权限、日志目录、被其他进程占用的文件，
以及传入的超时时间。调用方必须处理关闭 Promise 的拒绝并决定最终退出策略。

### 日志里仍出现敏感信息

确认敏感值位于元数据对象中，并检查 `masking.enabled` 是否为 `true`。消息字符串不会被字段脱敏器解析；
自定义字段名按大小写不敏感规则匹配。

## 开发

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm test
```

实现边界、格式与关闭流程的内部说明见 [DESIGN.md](./DESIGN.md)。

## 许可证

MIT
