## 1. 公共类型与配置加载

- [x] 1.1 新增并从包根导出 LoggerLevelOverride、LoggerLevelProfile，扩展 LoggerConfig.profiles；扩展 test/type-contract/contract.ts 验证 P16–P17 的旧用法、新类型正例和缺失 level、非法级别、额外字段负例；构建后运行 `pnpm exec tsc -p packages/logger/test/type-contract/tsconfig.json --noEmit`。
- [x] 1.2 在 ConfigLoader 中校验全部 profiles 的映射结构、名称、必填 level 和字段白名单；在 ConfigLoader.test.ts 以对象和 YAML 用例验证 P01–P03、P11–P12，覆盖空策略、包名、大小写、重复 YAML 键、未选中策略错误及基础错误不可被覆盖掩盖。
- [x] 1.3 将现有配置来源统一到 Profile 选择和解析流程，读取 LOGGER_PROFILE 并精确查找；单元测试验证 P05–P07 的未设置选择器、非法选择器、显式来源优先级及缺失 Profile 不回退，保留既有默认配置测试。
- [x] 1.4 在创建输出资源前完成所选命名 Logger level 合并并冻结；单元测试验证 P08–P10 的优先级、其他字段和显式 false 保留、Profile 独有名称继承 root、未选中名称不进入生效配置以及输入对象不被修改。

## 2. 生命周期及实际输出验证

- [x] 2.1 在 LoggerFactory.test.ts 验证 P13–P15：首次成功后环境及文件变化不影响缓存和后来创建的 Logger、失败无输出资源且可修正重试、getLogger 延迟初始化遵循同样选择规则；测试隔离并恢复环境变量。
- [x] 2.2 使用独立进程 fixture 或现有 Console/File 集成测试验证 P04 和 P08：同一 YAML 下 dev/qa 实际输出 debug，prod 过滤 debug 并输出 info；覆盖启用 Console 和 File 的输出路径，验证命名输出配置保持有效。

## 3. 使用文档与发布记录

- [x] 3.1 更新 packages/logger/README.md 和 DESIGN.md 的公共类型、单 YAML 示例、来源选择与覆盖顺序、缺省/错误行为及启动时序；人工对照规格核对 P01、P04–P07、P13、P15 的示例，并写明先升级消费者再部署 profiles、回滚旧版恢复旧格式配置。
- [x] 3.2 添加仅针对 @jintianxiayu/logger 的 minor changeset，说明命名 Logger 级别 Profile 能力及配置兼容性；运行 `pnpm run release:status` 核对版本计划，当前 1.0.1 基线预期为 1.1.0，不执行实际发布。

## 4. 集成检查与交付

- [x] 4.1 先运行 `pnpm --filter @jintianxiayu/logger test`，再运行 `pnpm test`；运行 `pnpm run build`、`pnpm run lint`、`pnpm run format:check` 并复核类型契约检查通过；报告真实结果，区分已有失败和本次回归。
- [x] 4.2 对照 P01–P17 检查每个 Scenario 的实际测试位置和结果，验证无遗漏；运行 `openspec validate add-logger-level-profiles --strict` 并审查最终 diff，确认范围与提案一致。规格校验不替代运行时或类型测试。

## 验证记录

- P01–P03、P05–P12：packages/logger/test/unit/LevelProfiles.test.ts（41 项通过）。为避免继续扩大现有 ConfigLoader.test.ts，配置用例放在独立文件，仍直接测试同一 ConfigLoader。
- P04、P08、P15：packages/logger/test/integration/LevelProfileOutput.test.ts；独立进程读取同一 YAML，验证 dev/qa/prod 的 Console/File 输出、脱敏与位置开关保留。
- P13–P15：packages/logger/test/unit/LoggerFactory.test.ts；验证失败不创建文件资源、修正选择器后延迟初始化、后续配置变化不影响缓存和新获取的日志器。
- P16–P17：packages/logger/test/type-contract/contract.ts；构建后包根类型正例及四类 @ts-expect-error 负例通过。
- logger：11 套、101 项测试通过；全仓：51 套通过、3 套跳过，449 项通过、60 项 Redis 相关测试按既有条件跳过。
- 全仓 build、lint 和 git diff --check 通过。最初单包构建及 pnpm exec tsc 遇到 Windows tsc 命令解析问题；随后全仓标准 build 成功，类型契约以等价的 node node_modules/typescript/bin/tsc -p packages/logger/test/type-contract/tsconfig.json --noEmit 成功验证。
- 全仓 format:check 已执行但未全绿：仅四个原有 packages/*/CHANGELOG.md 报格式问题，git diff 确认这些文件未修改。本次修改及新增的源码、测试、README 和 DESIGN 定向格式检查全部通过，未扩展修改历史发布记录。
- README 的单 YAML Profile 示例实际解析通过（README_PROFILE_EXAMPLE_OK）；文档按工具包使用者视角增量更新。
- pnpm run release:status 确认仅 logger 1.0.1 → 1.1.0（minor），记录为 .changeset/crisp-zebras-exist.md。
- openspec validate add-logger-level-profiles --strict 通过；逐项核对 P01–P17 均有测试，未进行实际发布、提交或归档。
