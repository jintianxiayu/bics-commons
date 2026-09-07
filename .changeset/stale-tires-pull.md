---
"@jintianxiayu/lock-decorator": minor
---

解耦 RedisLockProvider 与 ioredis，新增 RedisLockClient 及 ioredis、node-redis 适配工厂。目标版本 0.2.0：构造时需显式包装现有客户端，调用方须直接声明所用 Redis 客户端依赖；锁协议和连接所有权保持不变。发布前需盘点外部消费者并通知构造及依赖迁移，外部服务名单尚待维护者补充。
