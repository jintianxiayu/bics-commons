## 1. 项目初始化

- [x] 1.1 创建 `packages/cache-decorator` 包目录结构
- [x] 1.2 配置 `package.json`：name、version、dependencies（reflect-metadata）、devDependencies（@types/node、jest、typescript）
- [x] 1.3 配置 `tsconfig.json` 和 `jest.config.js`
- [x] 1.4 创建 `src/index.ts` 入口文件

## 2. 核心接口定义

- [x] 2.1 实现 `CacheProvider` 接口（`src/core/cache-provider.ts`）
- [x] 2.2 实现 `CacheProviderRegistry` 全局注册表（`src/core/cache-provider-registry.ts`）

## 3. 内置 CacheProvider 实现

- [x] 3.1 实现 `MemoryCacheProvider`（`src/core/native-cache.ts`）
- [x] 3.2 实现 `RedisCacheProvider`（`src/core/redis-cache.ts`），依赖 ioredis

## 4. 辅助模块

- [x] 4.1 实现 `KeyBuilder` 缓存 key 生成器（`src/core/key-builder.ts`）
- [x] 4.2 实现 `PendingCache` 请求合并（`src/core/pending-cache.ts`）

## 5. 装饰器实现

- [x] 5.1 实现 `@Cache` 装饰器（`src/decorators/cache.ts`）
- [x] 5.2 实现 `@CacheEvict` 装饰器（`src/decorators/cache-evict.ts`）

## 6. 导出与整合

- [x] 6.1 更新 `src/index.ts` 导出所有公共 API
- [x] 6.2 添加 `tsconfig.build.json` 构建配置

## 7. 测试编写

- [x] 7.1 编写 `@Cache` 装饰器单元测试
- [x] 7.2 编写 `@CacheEvict` 装饰器单元测试
- [x] 7.3 编写 `MemoryCacheProvider` 单元测试
- [x] 7.4 编写 `KeyBuilder` 单元测试
- [x] 7.5 编写 `PendingCache` 单元测试
- [x] 7.6 编写 `CacheProviderRegistry` 单元测试

## 8. 编译验证

- [x] 8.1 TypeScript 编译检查
- [x] 8.2 运行所有测试确保通过

## 9. 文档

- [x] 9.1 编写 README.md 使用示例