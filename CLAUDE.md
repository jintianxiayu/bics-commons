# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 开发命令

```bash
# 安装依赖
npm install

# 构建所有包
npm run build

# 运行所有测试
npm test

# 单个包测试
npx lerna run test --scope=@bics/logger

# 代码格式检查
npm run format:check

# ESLint 检查
npm run lint

# 格式化代码
npm run format
```

## 项目架构

### Monorepo 结构

本项目使用 Lerna + Yarn/NPM Workspaces 管理多包 monorepo：

```
packages/
├── logger/                # @bics/logger - 日志工厂
├── cache-decorator/       # @bics/cache-decorator - 缓存装饰器
└── http-client-decorator/ # @bics/http-client-decorator - HTTP 客户端
```

### 包设计模式

- **@bics/logger**: 基于 Winston 的 SLF4J 风格日志工厂，支持 YAML 配置、敏感信息脱敏、AsyncLocalStorage traceId 传递
- **@bics/cache-decorator**: 装饰器驱动的缓存方案，`@Cache` 和 `@CacheEvict` 装饰器，仅适用于返回 Promise 的方法
- **@bics/http-client-decorator**: 装饰器声明式 HTTP 客户端，Koa 风格中间件机制

### TypeScript 配置

- 基础配置: `tsconfig.base.json`
- 各包独立配置继承 base
- 装饰器支持: `experimentalDecorators` + `emitDecoratorMetadata`

### 代码规范

TypeScript 编码规范位于 `.claude/rules/typescript-style.md`，关键规则：
- 优先 `interface` 定义对象类型
- 禁止使用 `any`，使用 `unknown` 替代
- `async` 函数内必须用 `try/catch`，禁止 `.then().catch()`
- 单一职责，函数不超过 200 行，参数不超过 4 个

## OpenSpec 变更追踪

本项目采用 OpenSpec 规范驱动开发流程，配置文件位于 `openspec/config.yaml`：

- **proposal**: 变更提案，需包含回滚计划、影响评估
- **design**: 架构设计，详细到模块/字段/参数级别
- **specs**: 规格说明，使用 Given/When/Then 格式
- **tasks**: 任务清单，按基础设施到业务逻辑排序

归档变更存储在 `openspec/changes/archive/` 目录。

## CodeGraph

项目已配置 CodeGraph MCP server，结构化查询优先于 grep+Read：

- `codegraph_search`: 符号查找
- `codegraph_callers`: 调用关系
- `codegraph_explore`: 架构探索
- `codegraph_impact`: 影响分析
