# 下游消费者盘点

盘点日期：2026-09-07

## 仓库内结果

在排除 `node_modules`、`dist`、OpenSpec 工件和 lock 包自身后检索 `@jintianxiayu/lock-decorator`，只发现仓库根 README 的包清单与说明，没有发现生产代码消费者。因此本仓库内没有需要同步修改的调用方。

## 仓库外状态

本仓库无法推导私有服务或 npm 下载方清单，外部消费者负责人和服务名称待维护者补充。发布 `0.2.0` 前不得把该项视为已通知完成。

通知内容至少包括：

- 必须显式安装满足 `^0.2.0` 的 `@jintianxiayu/logger`；
- 必须在第一次锁调用前初始化 Logger，并在应用退出时统一关闭；
- 新增 `debug`、`warn`、`error` 锁事件及其日志量影响；
- Watchdog 续期拒绝不再触发 `unhandledRejection`，应改为监控 `lock.operation_failed` 且 `operation: renew`；
- Redis key、token、TTL 与 Lua 协议不变，不需要迁移 Redis 数据。

## 发布计划核对

`calm-locks-log.md` 只声明 `@jintianxiayu/lock-decorator` minor，目标版本为 `0.2.0`。执行
`pnpm change status` 和 `pnpm run release:version:dry-run` 均成功；全局计划同时包含
`@jintianxiayu/cache-decorator` 的 `0.2.0`，来源是工作区既有的 cache changesets，不属于本变更，因而保留不动。
