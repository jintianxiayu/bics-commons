---
"@jintianxiayu/logger": minor
---

新增命名 Logger 级别 Profile：单份对象或 YAML 配置通过 LOGGER_PROFILE 在启动时选择环境策略，保留基础输出和安全配置；未选择时沿用基础配置，非法策略在初始化时失败。旧版消费者需先升级再启用 profiles。
