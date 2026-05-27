## Why

在业务代码中实现方法缓存，通常需要手动构建缓存 key、检查缓存、调用方法、更新缓存等一系列重复样板代码。通过装饰器模式可以将这一流程自动化，让开发者只需声明式地标注 `@Cache` 即可实现方法缓存，同时通过 `@CacheEvict` 实现缓存清除。

## What Changes

- 新增 `@bics/cache-decorator` 包，提供 `@Cache` 和 `@CacheEvict` 方法装饰器
- 支持可插拔的缓存存储后端（CacheProvider），内置 Memory 和 Redis 实现
- 基于方法入参生成缓存 key，支持 TTL 过期
- 支持请求合并（并发场景下返回同一个 Promise）
- 错误结果也会被缓存，防止缓存穿透

## Capabilities

### New Capabilities

- `cache-decorator`: 方法缓存装饰器框架
  - `@Cache(name, options?)` 装饰器：填充缓存，支持 TTL 配置
  - `@CacheEvict(name, options?)` 装饰器：清除缓存，支持 `allEntries` 清除整组
  - `CacheProvider` 接口：定义缓存存储后端契约
  - `CacheProviderRegistry`：全局缓存提供者注册表
  - `MemoryCacheProvider`：内存 Map 实现（默认）
  - `RedisCacheProvider`：Redis 实现

### Modified Capabilities

- 无

## Impact

**新增包**：
- `packages/cache-decorator/`

**影响范围**：
- 所有需要方法缓存的业务代码可直接使用 `@Cache` 和 `@CacheEvict`

**依赖**：
- TypeScript + reflect-metadata（装饰器元数据支持）
- 可选：`ioredis`（Redis 支持时）

**Breaking Change**：
- 无，不影响现有 API