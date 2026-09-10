## 1. 公共配置契约与解析

- [x] 1.1 将公共 `SensitiveFieldConfig` 和内部有效配置扩展为 `string | false`，调整 `parseMasking` 仅接受字符串模板或布尔值 `false`，并在 `ConfigLoader` 单元测试中验证：旧字符串配置保持兼容、布尔值 `false` 被保留、带引号的 `'false'` 仍作为固定文本模板、`true`/`null`/数字/对象/数组被拒绝，以及字符串与 `false` 混合时仍拒绝大小写不敏感的重复字段。
- [x] 1.2 新增 logger 公共类型编译夹具，使用编译正例验证字符串和字面量 `false` 可赋给 `SensitiveFieldConfig`，并使用 `@ts-expect-error` 负例固定 `true`、`null` 和数字非法；执行 `pnpm exec tsc -p packages/logger/test/type-contract/tsconfig.json --noEmit` 验证诊断结果。

## 2. 字段策略执行与输出

- [x] 2.1 在脱敏器构建策略映射时用字符串模板新增或覆盖策略、用 `false` 删除规范化字段策略，并扩展 `MetadataAndMasking.test.ts` 验证：未配置时的 `password`/`phone`/`email` 默认保护不变，`password: false` 大小写不敏感地退出，`passwd`/`pwd` 和相近字段不受牵连，退出对象型父字段后仍递归脱敏内部 `token`，全局关闭时仍只复制和规范化元数据且不修改输入对象。
- [x] 2.2 扩展 Console 与 File 输出集成测试，使用一个命名 Logger 验证显式退出字段在所有启用通道中输出未掩码值、其他内置字段仍脱敏、日志结构不变、`message` 不被字段策略解析且调用方对象未被修改；执行 logger 集成测试验证最终可观察行为。

## 3. 使用说明与发布记录

- [x] 3.1 更新 `packages/logger/README.md` 的 `masking.fields` 类型、YAML/TypeScript 示例和敏感字段章节，明确 `false` 必须是不加引号的布尔值、退出按大小写不敏感字段名全局作用于所有命名 Logger/输出通道/嵌套层级、别名不会联动退出、对象子字段仍递归检查以及旧版运行时的升级顺序；对照 README 示例与公共导出进行人工核验。
- [x] 3.2 为 `@jintianxiayu/logger` 新建独立的 `minor` changeset，描述新增单字段退出能力、默认兼容性、安全影响和“先升级再配置”的要求；执行 `pnpm change status` 验证版本计划，并确认未修改或吸收工作区中已有 changeset。

## 4. 质量与规格验证

- [x] 4.1 依次执行 `pnpm --filter @jintianxiayu/logger test --runInBand`、`pnpm --filter @jintianxiayu/logger run typecheck`、`pnpm --filter @jintianxiayu/logger run lint`、`pnpm --filter @jintianxiayu/logger run format:check` 和 `pnpm --filter @jintianxiayu/logger run build`，确认 logger 的行为、类型、代码质量与产物声明全部通过。
- [x] 4.2 执行 `pnpm run build`、`pnpm test`、`pnpm run lint`、`pnpm run format:check` 和 `openspec validate allow-disabling-default-masking-fields --strict`，验证公共类型扩展未破坏其他 workspace 消费者，并逐项核对规格中的每个 Scenario 已由上述类型、单元、集成或文档验证覆盖；如存在无关基线失败，保留失败证据并明确区分，不得将严格规格校验当作测试通过。
