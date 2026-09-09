---
'@jintianxiayu/cache-decorator': major
---

业务异常缓存改为默认关闭，并新增独立 TTL、筛选器与可移植 codec 策略；Redis 异常条目采用版本化 envelope，共享 key 的读取方必须先完成 major 升级再启用策略。
