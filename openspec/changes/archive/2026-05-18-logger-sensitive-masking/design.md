## Context

### 背景

当前 `@bics/logger` 包已实现：
- SLF4J 风格的 Logger 获取
- 基于 Winston 的日志格式化
- traceId 异步上下文追踪
- YAML 配置加载

缺少敏感信息脱敏能力，存在日志泄露风险。

### 约束

- 不改变现有日志输出格式和 API
- 脱敏性能开销控制在 0.1ms 以内
- 配置与代码分离，通过 YAML 配置
- 容错优先，脱敏失败不能影响业务

## Goals / Non-Goals

**Goals:**
- 对 `log.info()`, `log.debug()` 等方法传入的 meta 数据进行敏感字段脱敏
- 支持按字段名匹配敏感数据（password, token, phone, creditCard 等）
- 支持模板化脱敏格式（{lastN}, {firstN}, {domain}, * 等）
- 支持嵌套对象和数组的递归脱敏
- 提供开关控制，默认开启

**Non-Goals:**
- 不处理 message 字符串的脱敏（仅 meta 脱敏）
- 不支持正则模式匹配（仅字段名匹配）
- 不处理循环引用检测

## Decisions

### Decision 1: 脱敏时机

**选择**: 在 `serializeMeta` 阶段脱敏（格式化前）

| 方案 | 优点 | 缺点 |
|------|------|------|
| serializeMeta 阶段 | 所有 meta 在写入前脱敏，%{meta} 输出已脱敏 | - |
| createFormat printf 阶段 | 可以同时处理 message | %{meta} 的 JSON 字符串化后才脱敏 |

**结论**: 在 `serializeMeta` 阶段脱敏，逻辑清晰，%{meta} 输出天然已脱敏。

---

### Decision 2: 敏感字段查找性能

**选择**: 初始化时构建 `Map<field, config>` + `Set`，运行时 O(1) 查找

```typescript
// 初始化时构建
const fieldLookup = new Map(sensitiveFields.map(c => [c.field, c]));
const fieldSet = new Set(sensitiveFields.map(c => c.field));

// 运行时查找
if (fieldSet.has(key)) {
  const config = fieldLookup.get(key);
  // ...
}
```

---

### Decision 3: 模板预编译

**选择**: 初始化时编译模板为渲染函数，运行时直接调用

```typescript
// 初始化时编译
const rendererCache = new Map<string, (value: string) => string>();

function getRenderer(template: string): (value: string) => string {
  if (!rendererCache.has(template)) {
    rendererCache.set(template, compileTemplate(template));
  }
  return rendererCache.get(template)!;
}
```

模板语法解析在初始化时完成，避免运行时正则匹配开销。

---

### Decision 4: 嵌套层级限制

**选择**: 最大嵌套 5 层，超过返回 `[MAX_DEPTH_EXCEEDED]`

```typescript
const MAX_DEPTH = 5;

function maskObject(obj: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH_EXCEEDED]';
  // ...
}
```

---

### Decision 5: 初始化时机

**选择**: 谁先调用谁初始化（LoggerFactory.init() 或第一次 getLogger()）

```typescript
private static maskingInitialized = false;

private static ensureMaskingInitialized(): void {
  if (!this.maskingInitialized) {
    SensitiveMasker.init(this.getSensitiveMaskingConfig());
    this.maskingInitialized = true;
  }
}
```

---

## 模块设计

### 1. SensitiveMasker 模块

```
packages/logger/src/core/SensitiveMasker.ts
```

| 功能 | 说明 |
|------|------|
| `init(config)` | 初始化脱敏配置，构建 Map/Set，注册预编译渲染函数 |
| `maskObject(obj)` | 递归脱敏对象，支持嵌套和数组 |
| `maskValue(value, config)` | 单值脱敏，按模板渲染 |
| `compileTemplate(template)` | 编译模板为渲染函数 |

### 2. 新增类型

```typescript
// packages/logger/src/types/index.ts

interface SensitiveFieldConfig {
  field: string;    // 字段名
  mask: string;     // 脱敏模板
}

interface SensitiveMaskingConfig {
  enabled?: boolean;           // 开关，默认 true
  fields?: SensitiveFieldConfig[];  // 自定义字段配置
}

interface LoggerConfig {
  level?: LogLevelName;
  console?: ConsoleConfig;
  file?: FileConfig;
  pattern?: string;
  sensitiveMasking?: SensitiveMaskingConfig;
}
```

### 3. 模板语法

| 语法 | 说明 | 示例 |
|------|------|------|
| `*` | 替代字符（个数等于模板中 * 的数量） | `****` → 4个星号 |
| `{lastN}` | 取原值最后 N 位 | `"13812345678"` → `{last4}` → `"5678"` |
| `{firstN}` | 取原值前 N 位 | `"13812345678"` → `{first3}` → `"138"` |
| `{domain}` | 取邮箱 @ 后的域名部分 | `"user@example.com"` → `"example.com"` |

### 4. 预定义默认敏感字段

```typescript
// packages/logger/src/config/defaultConfig.ts

const DEFAULT_SENSITIVE_FIELDS: SensitiveFieldConfig[] = [
  { field: 'password',       mask: '********' },
  { field: 'passwd',         mask: '********' },
  { field: 'pwd',            mask: '********' },
  { field: 'token',          mask: '********' },
  { field: 'apiKey',         mask: '********' },
  { field: 'api_key',        mask: '********' },
  { field: 'secretKey',      mask: '********' },
  { field: 'accessToken',    mask: '********' },
  { field: 'refreshToken',   mask: '********' },
  { field: 'phone',          mask: '*** *** {last4}' },
  { field: 'mobile',         mask: '*** *** {last4}' },
  { field: 'mobileNo',       mask: '*** *** {last4}' },
  { field: 'creditCard',     mask: '**** **** **** {last4}' },
  { field: 'cardNo',         mask: '**** **** **** {last4}' },
  { field: 'bankAccount',    mask: '**** **** **** {last4}' },
  { field: 'idCard',         mask: '**************{last4}' },
  { field: 'idNumber',       mask: '**************{last4}' },
  { field: 'email',          mask: '{first2}***@{domain}' },
];
```

### 5. 边界处理

| 场景 | 处理方式 |
|------|----------|
| 值类型异常 | null/undefined → 原值转字符串；非字符串 → String(value) |
| 长度不足 | 截断保护：取实际可用部分，如 `"123"` 用 `{last4}` → `"*123"` |
| 邮箱无 @ | 全掩码降级：返回 `********` |
| 嵌套过深 | 超过 5 层 → `[MAX_DEPTH_EXCEEDED]` |
| 解析异常 | 降级全掩码：`'*'.repeat(Math.min(value.length, 12))` |

---

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| 预编译函数缓存内存占用 | 敏感字段配置有限（< 20），模板种类少，缓存不会膨胀 |
| 脱敏性能影响日志吞吐量 | 优化后单次调用增加约 0.05ms，可忽略不计 |
| 新配置项增加学习成本 | 提供预定义默认值，开箱即用；文档详细说明 |

---

## Migration Plan

1. **开发阶段**: 实现 SensitiveMasker 模块及单元测试
2. **配置兼容**: 默认敏感字段自动生效，无需修改现有配置
3. **灰度验证**: 通过 `sensitive-masking.enabled: false` 可快速关闭验证
4. **回滚**: 删除 SensitiveMasker.ts，恢复 LoggerFactory.ts 即可

---

## Open Questions

无。