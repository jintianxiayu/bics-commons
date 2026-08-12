## 1. 生命周期测试基础设施

- [x] 1.1 在 LoggerFactory 测试中增加可控 deferred Promise 与内部 container close 替身，支持确定性驱动关闭完成和拒绝分支（后续依赖：2.x、3.x、4.x）
- [x] 1.2 增加 timer、process listener、process.exit 和未处理 rejection 的测试清理 helper，确保每个用例恢复全局状态（依赖：1.1；后续依赖：3.x、5.x）
- [x] 1.3 增加当前缺陷的回归基线测试，证明快速关闭后不遗留 timer、并发调用保持等待以及关闭后同名 wrapper 不被复用（依赖：1.1、1.2）

## 2. 共享关闭状态与访问守卫

- [x] 2.1 用共享 `shutdownPromise` 生命周期状态替换 `isShuttingDown` 的立即返回逻辑，并快照首个调用的 timeout 与回调（依赖：1.1）
- [x] 2.2 在 `init()` 和 `getLogger()` 的配置加载/cache lookup 前加入统一关闭状态守卫和稳定错误信息（依赖：2.1）
- [x] 2.3 增加并发关闭成功测试，验证所有调用保持等待、container 只关闭一次且观察相同结果（依赖：2.1）
- [x] 2.4 增加后续调用传入不同 timeout/回调的测试，验证仅首个调用的选项生效且回调最多执行一次（依赖：2.1）
- [x] 2.5 增加关闭期间调用 `init()`、获取已有名称和获取新名称的测试，验证均拒绝且不加载配置或创建资源（依赖：2.2）

## 3. Timeout、错误与回调终止路径

- [x] 3.1 抽取单轮 container close 与 timeout 竞速 helper，并在 close 先结束、close 拒绝及 timeout 结束路径统一清理 timer（依赖：2.1）
- [x] 3.2 为 timeout 后仍未结束的 close Promise 安装拒绝观察，避免迟到拒绝成为 unhandled rejection（依赖：3.1）
- [x] 3.3 实现关闭结果、内部状态清理和 `onShutdown` 的确定性顺序，保证回调抛错不会跳过状态恢复（依赖：3.1、3.2）
- [x] 3.4 使用 fake timer 测试快速关闭会取消 5 秒 timeout 且不遗留 Jest open handle（依赖：1.2、3.1）
- [x] 3.5 使用 fake timer 测试 timeout 先到达时关闭正常完成、状态恢复且迟到 close rejection 被安全处理（依赖：1.2、3.2、3.3）
- [x] 3.6 增加 close 同步抛错/异步拒绝测试，验证所有并发调用收到一致错误且 timer 与状态均被清理（依赖：2.3、3.3）
- [x] 3.7 增加 `onShutdown` 正常与抛错测试，验证清理发生在回调前、每轮只调用一次且错误向所有等待者传播（依赖：2.4、3.3）

## 4. 缓存失效与干净重建

- [x] 4.1 将 container、initialized、wrapper cache 与 ConfigLoader cache 的复位集中到单轮关闭的统一清理函数（依赖：3.3）
- [x] 4.2 增加关闭后重新获取同名 logger 的测试，验证返回全新 wrapper 且不复用已关闭 container/transport（依赖：4.1）
- [x] 4.3 增加关闭后配置文件变化再 `init()`/懒加载的测试，验证新配置生效且旧配置缓存失效（依赖：4.1）
- [x] 4.4 增加正常、timeout、close reject 和回调 reject 后重新初始化测试，覆盖所有关闭终止分支（依赖：3.5、3.6、3.7、4.1）
- [x] 4.5 增加 no-op logger 关闭后失效与空闲状态重复 `shutdown()` 的回归测试（依赖：4.1）

## 5. 信号处理器生命周期

- [x] 5.1 增加 signal-to-handler registry 与精确移除 helper，使用 handler 引用管理 LoggerFactory listener 所有权（依赖：2.1）
- [x] 5.2 重构 `setupShutdownHandlers()`，只为未注册信号添加 listener，并保留每个信号首次注册的 timeout/回调选项（依赖：5.1）
- [x] 5.3 在任一信号触发及 `reset()` 时移除全部工厂 handler，同时保留应用注册的其他 listener（依赖：5.1、5.2）
- [x] 5.4 增加默认信号、自定义信号、重复注册和部分重叠集合测试，验证每个信号最多一个工厂 listener（依赖：1.2、5.2）
- [x] 5.5 增加信号触发测试，验证只启动一轮关闭、只请求一次正常退出并清理其他信号 handler（依赖：5.3、5.4）
- [x] 5.6 增加 `reset()` 精确清理测试，验证 LoggerFactory listener 被移除而外部 listener 保留（依赖：1.2、5.3）

## 6. 文档与完整验证

- [x] 6.1 更新 README 的 `shutdown()` 说明，记录并发等待、首个 options 生效、关闭期间拒绝访问、关闭后重新获取 logger 和 timeout 行为（依赖：4.5）
- [x] 6.2 更新 README/demo 的 `setupShutdownHandlers()` 说明，记录重复注册幂等、信号触发清理及推荐停机顺序（依赖：5.5、5.6）
- [x] 6.3 运行 logger 完整测试并启用 Jest open-handle 检查，确认不再报告 shutdown timeout 或 signal listener 残留（依赖：3.4、4.4、5.6）
- [x] 6.4 运行 logger build、lint 和 README TypeScript 示例编译，确认公开 API 签名保持兼容且无新增运行时依赖（依赖：6.1、6.2、6.3）
- [x] 6.5 记录 prerelease 的容器 SIGTERM 验证步骤、观察指标与版本回滚方式（依赖：6.4）
