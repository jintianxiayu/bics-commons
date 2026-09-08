---
'@jintianxiayu/cache-decorator': minor
---

BREAKING: cache-decorator 新增结构化缓存决策日志，并要求消费方提供兼容的 @jintianxiayu/logger peer、在首次缓存调用前完成 Logger 初始化；默认配置可能新增 warn/error 输出。与现有 minor 变更合并后目标版本仍为 0.2.0。
