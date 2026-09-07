---
"@jintianxiayu/cache-decorator": minor
---

解耦 RedisCacheProvider 与具体 Redis SDK，新增 RedisCacheClient 及 ioredis、node-redis 适配工厂。目标版本 0.2.0：构造时必须显式包装调用方持有的连接，调用方需直接声明所用 Redis 客户端依赖并负责连接生命周期；Redis key、值格式和秒级 TTL 保持兼容。
