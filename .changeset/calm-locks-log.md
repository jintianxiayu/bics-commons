---
'@jintianxiayu/lock-decorator': minor
---

BREAKING: lock-decorator 新增结构化锁生命周期日志，并要求消费方提供兼容的 @jintianxiayu/logger peer、在首次锁调用前初始化 Logger。Watchdog 续期 Promise 拒绝现在会被记录并停止后续续期，不再形成 unhandled rejection；已开始的业务继续执行且结束时仍尝试释放锁。与现有 minor 变更合并后目标版本仍为 0.2.0。
