## 1. 项目初始化

- [x] 1.1 在 packages/ 下创建 lock-decorator 包目录结构
- [x] 1.2 初始化 package.json，添加 name: @bics/lock-decorator
- [x] 1.3 添加依赖：ioredis, uuid 及各类型定义包
- [x] 1.4 配置 tsconfig.json（继承 base）

## 2. 核心类型与接口

- [x] 2.1 定义 LockProvider 接口（acquire/renew/release）
- [x] 2.2 定义 DistributedLockOptions 类型（key/ttl/renewInterval/retryCount/retryDelay）
- [x] 2.3 定义 LockAcquisitionError 异常类
- [x] 2.4 验证接口与类型定义符合 spec 要求

## 3. LockProviderRegistry 全局注册表

- [x] 3.1 实现 register/add/get/setDefault/clear 方法
- [x] 3.2 编写单元测试覆盖所有场景
- [x] 3.3 验证符合 lock-provider-registry spec

## 4. RedisLockProvider 实现

- [x] 4.1 实现 acquire（SET NX PX 原子设锁）
- [x] 4.2 实现 release（Lua 脚本校验 + 删除）
- [x] 4.3 实现 renew（Lua 脚本校验 + PEXPIRE）
- [x] 4.4 编写单元测试（mock Redis client）
- [x] 4.5 验证符合 redis-lock-provider spec

## 5. 看门狗实现

- [x] 5.1 实现 Watchdog 类（start/stop，独立的 setInterval 续期线程）
- [x] 5.2 实现续期失败检测与线程停止逻辑
- [x] 5.3 编写单元测试（mock LockProvider）

## 6. @DistributedLock 装饰器

- [x] 6.1 实现装饰器基本结构
- [x] 6.2 实现 key 解析逻辑（undefined/null/string/function）
- [x] 6.3 实现加锁 + 重试逻辑
- [x] 6.4 实现看门狗启动/停止
- [x] 6.5 实现 finally 释放锁逻辑
- [x] 6.6 抛出 LockAcquisitionError 异常
- [x] 6.7 类型校验：仅适用于 async 方法
- [x] 6.8 编写单元测试
- [x] 6.9 验证符合 distributed-lock-decorator spec

## 7. 入口文件与统一导出

- [x] 7.1 创建 index.ts，统一导出所有公共 API
- [x] 7.2 验证导出完整性

## 8. 集成验证

- [x] 8.1 在项目中运行构建验证编译通过
- [x] 8.2 运行单元测试验证功能正确