# Logger Trace Context 设计文档

## Context

`@bics/logger` 是基于 Winston 的生产级日志库，当前支持：
- YAML 配置文件
- 命名 Logger
- 配置继承
- `%{log_position}` 占位符自动捕获调用位置
- 优雅关闭

当前缺失 traceId 支持，导致微服务问题排查时无法关联同一请求的所有日志。

## Goals / Non-Goals

**Goals:**
- 提供 LoggerContext 模块，支持上下文存储和获取
- 支持 `%{traceId}` 占位符在日志 pattern 中使用
- 通过 AsyncLocalStorage 实现跨异步调用链的上下文传递
- 保持 logger 包通用性，不绑定任何特定协议（HTTP/RPC/MQ 等）

**Non-Goals:**
- 不负责 traceId 的生成和来源（由调用方决定）
- 不实现 traceId 的传播逻辑（由调用方的中间件/框架负责）
- 不支持 Node.js 以外的运行时

## Decisions

### Decision 1: LoggerContext API 设计

**选择：** 提供 `set`、`get`、`clear`、`withContext` 四个方法

| 方法 | 签名 | 说明 |
|------|------|------|
| set | `set(key: string, value: string): void` | 设置上下文值 |
| get | `get(key: string): string \| undefined` | 获取上下文值 |
| clear | `clear(): void` | 清空当前上下文 |
| withContext | `withContext(values: Record<string, string>, fn: () => T): T` | 自动清理的包装函数 |

**替代方案考虑：**
- 只提供 `set`/`get`：缺少自动清理机制，调用方容易遗漏 `clear`
- 提供 `run` 方法（接受回调）：与 `withContext` 功能相同，但 `withContext` 命名更直观

### Decision 2: AsyncLocalStorage 存储结构

**选择：** 使用 `AsyncLocalStorage<Map<string, string>>` 存储上下文

```typescript
const contextStore = new AsyncLocalStorage<Map<string, string>>();
```

**替代方案考虑：**
- 直接存储字符串值：无法支持多值（traceId、userId 等）
- 使用 `AsyncResource` 绑定：更复杂，对于当前场景过于重量级

### Decision 3: %{traceId} 占位符默认值

**选择：** traceId 不存在时显示 `-`

```
pattern: '%{timestamp} %{level} [%{traceId}] %{message}'
输出（有traceId）: 2026-05-18 13:45 info [abc123] query executed
输出（无traceId）: 2026-05-18 13:45 info [-] query executed
```

**替代方案考虑：**
- 显示空字符串：日志中难以区分"没有设置"和"设置为空"
- 隐藏整个 `[%{traceId}]` 段：需要复杂的条件逻辑

### Decision 4: withContext 实现

**选择：** 使用 `store.enterWith` 进入新的上下文域

```typescript
withContext(values: Record<string, string>, fn: () => T): T {
  const currentStore = contextStore.getStore();
  const newStore = new Map(currentStore);

  for (const [k, v] of Object.entries(values)) {
    newStore.set(k, v);
  }

  return contextStore.run(newStore, fn);
}
```

**关键点：**
- 合并当前上下文和新值，而非替换
- 使用 `contextStore.run` 确保子调用也共享新上下文
- 无需手动清理，run 退出后自动失效

### Decision 5: 与 Winston 集成方式

**选择：** 在 `createFormat` 的 printf 中读取 `contextStore.getStore()`

```typescript
function createFormat(pattern: string): winston.Logform.Format {
  return winston.format.printf(info => {
    const store = contextStore.getStore();
    const traceId = store?.get('traceId') || '-';

    // 替换 %{traceId} 占位符
    return pattern.replace(/%\{traceId\}/g, traceId);
  });
}
```

## 架构设计

### 模块列表

| 模块 | 文件 | 功能 | 依赖 |
|------|------|------|------|
| LoggerContext | `src/core/LoggerContext.ts` | 上下文存储和传递 | async_hooks |
| LoggerFactory | `src/core/LoggerFactory.ts` | 读取上下文输出日志 | LoggerContext |
| 类型定义 | `src/types/index.ts` | ContextOptions 类型 | - |
| 入口导出 | `src/index.ts` | 导出 LoggerContext | LoggerContext |

### 数据流

```
┌─────────────────────────────────────────────────────────┐
│                    调用方                                 │
│  LoggerContext.set('traceId', 'abc123')                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│               AsyncLocalStorage                         │
│  Map { traceId: 'abc123' }                              │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              logger.info('hello')                        │
│                    │                                    │
│                    ▼                                    │
│         winston.Logger.info()                           │
│                    │                                    │
│                    ▼                                    │
│         createFormat().printf()                         │
│                    │                                    │
│                    ▼                                    │
│      contextStore.getStore().get('traceId')            │
│                    │                                    │
│                    ▼                                    │
│         输出: 'hello [abc123]'                          │
└─────────────────────────────────────────────────────────┘
```

## 测试设计

### 模块划分测试用例

#### LoggerContext 模块

| 用例 | 输入 | 预期输出 |
|------|------|---------|
| set/get | `set('a', '1')` → `get('a')` | `'1'` |
| get 不存在的 key | `get('none')` | `undefined` |
| clear | `set('a', '1')` → `clear()` → `get('a')` | `undefined` |
| withContext 基本 | `withContext({a:'1'}, () => get('a'))` | `'1'` |
| withContext 嵌套 | 外层 `{a:'1'}` → 内层 `{b:'2'}` → `get('a')`+`get('b')` | `'1'`, `'2'` |
| withContext 退出后清理 | `withContext({a:'1'}, () => get('a'))` → 外部 `get('a')` | `undefined` |
| 覆盖已有 key | `set('a','1')` → `withContext({a:'2'}, () => get('a'))` | `'2'` |

#### LoggerFactory traceId 集成

| 用例 | 输入 | 预期输出 |
|------|------|---------|
| 带 traceId 输出 | set traceId → logger.info | 输出含 traceId |
| 无 traceId 输出 | 不设置 → logger.info | 输出显示 `-` |
| withContext 带 traceId | withContext({traceId:'t1'}, logger.info) | 输出含 't1' |
| 异步传递 | async 函数内 set traceId → 调用另一 async 函数 → logger | traceId 传递 |

## 风险与权衡

**[Risk] AsyncLocalStorage 兼容性**
- Node.js < 12.17 不支持
- → Mitigation：package.json engines 字段要求 `>=12.17`

**[Risk] 嵌套 withContext 的上下文合并**
- 内层 withContext 可能意外覆盖外层 key
- → Mitigation：文档说明覆盖行为，调用方注意 key 设计

**[Risk] 忘记 clear 导致内存泄漏**
- 理论上 long-running 进程不断 set 不 clear 可能积累
- → Mitigation：withContext 自动清理；set 应配合 clear 或 withContext 使用

## Open Questions

1. 是否需要 `remove(key)` 方法单独删除某个 key？（当前只有 clear）
2. 是否需要支持 key 的过期时间？（当前无过期机制）
3. 是否需要导出 `has(key)` 方法？（当前可通过 `get(key) !== undefined` 判断）