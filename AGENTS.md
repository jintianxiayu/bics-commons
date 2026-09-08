# 仓库指南

## 项目概述与技术栈

本项目是基于 pnpm workspace 的 TypeScript 公共工具库 monorepo，以 `@jintianxiayu/*` 作用域发布。当前包含 Winston 日志封装、方法缓存装饰器、基于 Axios 的声明式 HTTP 客户端，以及基于 Redis 的分布式锁装饰器。

项目使用 Node.js 20.19+/22.13+/24+、TypeScript 6、ES2021 和 NodeNext 模块解析；包管理与独立版本发布使用 pnpm 11，测试使用 Jest 29 与 ts-jest，代码质量由 ESLint 10 和 Prettier 3 管理。行为规格和变更记录通过 OpenSpec 维护。

## 项目结构与模块组织

各子包位于 `packages/<name>/`：源码放在 `src/`，测试放在 `test/`，编译产物输出到 `dist/`。当前包包括 `logger`、`cache-decorator`、`http-client-decorator` 和 `lock-decorator`。根目录保存共享的 TypeScript、ESLint、Prettier 和 workspace 配置；`openspec/specs/` 保存现行规格，`openspec/changes/` 保存变更记录，`scripts/` 保存本地发布辅助脚本。不要手工修改 `dist/`、`node_modules/` 或 `.pnpm-store/`。

## 构建、测试与开发命令

- `pnpm install`：安装全部 workspace 依赖。
- `pnpm run build`：清理并编译所有子包。
- `pnpm test`：运行全部 Jest 测试。
- `pnpm --filter @jintianxiayu/logger test`：仅测试指定子包。
- `pnpm run lint`：检查所有 TypeScript 代码。
- `pnpm run format:check`：检查格式；`pnpm run format` 自动格式化。
- `pnpm change`：记录待发布变更；`pnpm run release:status` 查看版本计划。

## 编码风格与命名约定

遵循严格 TypeScript 配置。Prettier 统一使用 4 空格缩进、单引号、分号、ES5 尾逗号和 120 字符行宽。所有控制语句必须使用花括号，避免重复导入；有意未使用的参数以 `_` 开头。包目录使用 kebab-case，类、接口和类型使用 PascalCase，函数与变量使用 camelCase。

## 测试规范

测试文件必须位于对应包的 `test/` 下并命名为 `*.test.ts`。行为修改应补充聚焦的单元测试；涉及文件系统、进程、Redis 或 HTTP 边界时应增加集成测试。先运行受影响包的测试，再运行 `pnpm test`。当前未设置最低覆盖率阈值；需要报告时执行 `pnpm --filter <package> test -- --coverage`。

## 提交与拉取请求规范

包级变更优先使用带作用域的 Conventional Commit，例如 `fix(logger): 修复配置解析`；仓库级维护可使用简洁的中文说明。每个提交只包含一个逻辑变更，可发布变更需附带 `pnpm change` 记录。拉取请求应说明受影响的包、行为及兼容性影响，关联 Issue 或 OpenSpec 变更，并列出实际执行的构建、检查和测试命令；公共 API 或配置变化必须明确标注。
