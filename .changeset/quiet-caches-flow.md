---
'@jintianxiayu/cache-decorator': patch
---

缓存装饰器固定改为 fail-open：Provider 解析、读取、写入或淘汰失败时保留业务成功值或原始业务异常，并消费非等待写入与单 key 删除的异步 rejection。直接调用 Provider 仍保持 fail-fast。

这是维护者因公共 API 未调整而批准的 patch 版本例外，计划从 1.0.1 升级到 1.0.2；运行时错误语义不兼容，下游不得再依赖装饰器传播 Provider rejection。
