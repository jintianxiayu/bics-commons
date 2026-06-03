## Context

**当前状态**

`LoggerConfig.console.format` 字段在 `packages/logger/src/types/index.ts` 的 `ConsoleConfig` 接口中已声明为 `'plain' | 'json'` 可选字段，但消费方 `LoggerFactory.createTransports`（`packages/logger/src/core/LoggerFactory.ts:165-180`）在创建 winston Console transport 时**未读取该字段**。该方法硬编码使用 `createFormat(config.pattern || DEFAULT_PATTERN)` 输出纯文本，导致 `format` 配置完全失效。

`AsyncLocalStorage` 中的 `traceId` 注入逻辑目前仅在 `createFormat`（纯文本 printf）路径中处理；JSON 模式下若不显式处理，`traceId` 将无法出现在日志输出中，与现有契约不符。

**约束**

- 库公开 API（`LoggerConfig`/`ConsoleConfig` 类型签名）必须保持不变，不引入 Breaking Change。
- 现有未配置 `format` 字段的用户行为必须完全保持一致（继续走纯文本分支）。
- 文件输出（`DailyRotateFile`）的行为**不在本次变更范围**，仍走 `createFormat`。
- 不得引入新的第三方依赖。

**相关方**

- 库维护者：需实现并测试
- 库使用者：可通过 YAML 配置启用 JSON 输出，无需修改代码

## Goals / Non-Goals

**Goals**

- 让 `console.format: 'json'` 配置项真正生效，输出单行 JSON
- 让 `console.format: 'plain'`（含未配置）行为与现状完全一致
- JSON 模式下正确注入 `traceId` 到 `info.traceId` 字段
- 默认配置显式声明 `format: 'plain'`，固化默认行为
- 新增对应单元测试，覆盖三种场景

**Non-Goals**

- 不修改文件 transport（`DailyRotateFile`）的格式策略
- 不修改 `LoggerConfig` 类型签名（字段本就存在）
- 不引入新的依赖包
- 不实现自定义 JSON 字段映射（如允许用户配置额外字段）
- 不提供运行时热切换能力（仅按启动时配置生效）

## Decisions

### 决策 1：在 `createTransports` 内按 `format` 分支选择 winston formatter

**方案 A：在 `LoggerFactory.createTransports` 中增加 `if/else` 分支**

```ts
if (config.console?.enabled !== false) {
  const useJson = config.console?.format === 'json';
  const baseFormats = [winston.format.timestamp()];
  if (!useJson && config.console?.colors !== false) {
    baseFormats.push(winston.format.colorize({ all: true }));
  }
  const consoleFormat = useJson
    ? winston.format.combine(...baseFormats, createJsonFormat())
    : winston.format.combine(...baseFormats, createFormat(config.pattern || DEFAULT_PATTERN));
  transports.push(new winston.transports.Console({ format: consoleFormat }));
}
```

**方案 B：抽离为独立的 `createConsoleFormat(config)` 工厂函数**

将分支逻辑抽到 `core/consoleFormat.ts` 之类的文件中，由 `createTransports` 调用。

**选定方案 A**。理由：本次变更范围小（约 15~25 行），且 `createTransports` 已经是创建 transport 的核心位置，集中处理可读性更高；过早抽象会引入额外文件而无明显收益。`createFormat` 本身已私有于 `LoggerFactory.ts`，新增 `createJsonFormat` 同文件内私有函数即可。

**替代方案考虑**

- 方案 C：完全用 `winston.format.json()` 替代 `createJsonFormat`，不抽工具函数。否决——需要额外在 JSON 注入前注入 `traceId` 与 `name`，需在 winston pipeline 链上加 `format.printf` 调整 info 对象，抽函数更清晰。
- 方案 D：把 `traceId` 注入放到 `defaultMeta`。否决——`defaultMeta` 只在创建 logger 时注入一次，`AsyncLocalStorage` 的值随请求变化，必须在 `format` 阶段读取。

### 决策 2：JSON 模式下的 `traceId` 注入位置

将 `traceId` 注入实现为独立 winston `Format` 包装，挂在 JSON 格式化之前：

```ts
const createJsonFormat = (): winston.Logform.Format =>
  winston.format.printf(info => {
    const store = LoggerContext.getStore();
    const traceId = store?.get('traceId');
    if (traceId) {
      info.traceId = traceId;
    }
    return winston.format.json().transform(info);
  });
```

**替代方案考虑**

- 方案 B：用 `winston.format((info) => { info.traceId = ...; return info; })()` 替换 `printf`。否决——`printf` 是 winston 中最直观的"读 store + 调下游 formatter"的写法，且与现有 `createFormat` 风格一致。
- 方案 C：把 `traceId` 作为 `info.metadata` 的子键。否决——会改变输出 JSON 的字段位置，破坏下游解析约定。

### 决策 3：默认配置中显式声明 `format: 'plain'`

在 `defaultConfig.ts` 的 `defaultConfig.console` 块中新增 `format: 'plain'`，与代码分支保持显式一致。

**理由**：当前 `defaultConfig.console` 只声明了 `enabled` 和 `colors`，缺少 `format` 容易让读者误以为该字段被忽略。显式化是文档性质的强化，零行为变化。

### 决策 4：JSON 模式关闭 colorize

colorize 通过 ANSI 转义序列上色，输出在 JSON 模式下无效（JSON 中会嵌入转义字符破坏结构），因此 JSON 分支跳过 `colorize`。

### 决策 5：测试策略

| 模块                         | 测试类型   | 覆盖场景                                                                                   |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `LoggerFactory` 控制台输出   | 单元测试   | `format: 'plain'` 输出含 `pattern` 模板；`format: 'json'` 输出合法 JSON 含 level/message；未配置时回退到 plain；JSON 模式下 `traceId` 出现在输出中 |
| `defaultConfig`              | 单元测试   | `defaultConfig.console.format === 'plain'`                                                 |

测试通过 spy/stub winston transport 的 `write`/`log` 方法捕获输出，断言格式与字段。复用 `packages/logger/src/core/__tests__/` 现有结构（如不存在则新建）。

## Risks / Trade-offs

- **风险：JSON 输出格式与下游消费方约定不一致** → 缓解：使用 winston 默认的 `format.json()`，输出字段为 `level/message/timestamp`，与生态中绝大多数采集器（如 Filebeat、Vector）默认解析规则一致；README 中明确列出输出字段。
- **风险：现有用户曾"依赖"`format` 字段被忽略的事实（即在 JSON 输出场景下使用自定义 `pattern` 但发现无效）** → 缓解：低概率——`format` 字段无实现意味着任何依赖都会立刻被用户发现并反馈；变更后行为符合声明的契约。
- **风险：JSON 模式下的 `traceId` 字段命名与现有惯例冲突** → 缓解：选用 `traceId`（驼峰）作为字段名，与现有 `createFormat` 中 `%{traceId}` 占位符语义一致；README 中明确说明字段位置为顶层。
- **取舍：测试需要 spy winston Console transport** → 接受：winston 的 transport 协议稳定，spy `write` 方法是社区常用做法；不引入额外测试框架。

## Migration Plan

无需数据迁移或部署步骤。

**部署**

1. 合并 PR 后，使用者在 YAML 中配置 `console.format: json` 即时生效，无需升级额外的依赖。
2. 默认行为不变，无需通知现有用户。

**回滚**

- 单一提交、单一文件为主的小范围变更，`git revert` 即可恢复。
- 回滚后行为：所有 `console.format` 配置项恢复"被忽略"的现状（与本次变更前的状态等价）。
- 无需数据修复或缓存清理。

## Open Questions

- JSON 模式下是否需要在 README 中显式列出输出字段列表？（倾向于列，避免下游解析歧义）—— 实施阶段决定。
- 是否需要为 file transport 同步支持 `format: 'json'`？（超出本次范围，留待后续变更）
