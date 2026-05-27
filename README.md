# bics-commons

TypeScript 工具库 monorepo，基于 Lerna + Yarn/NPM Workspaces 管理。

## 包列表

| 包 | 版本 | 说明 |
| --- | --- | --- |
| [@bics/logger](./packages/logger) | 0.0.0 | SLF4J 风格的日志工厂，基于 Winston 实现 |
| [@bics/cache-decorator](./packages/cache-decorator) | 0.0.1 | TypeScript 方法缓存装饰器 |
| [@bics/http-client-decorator](./packages/http-client-decorator) | 0.0.0 | 基于装饰器的 HTTP 客户端框架 |
| [@bics/lock-decorator](./packages/lock-decorator) | 0.0.1 | 分布式锁装饰器，支持 Redis 存储和看门狗自动续期 |

## 快速开始

### 安装依赖

```bash
npm install
```

### 构建所有包

```bash
npm run build
```

### 运行测试

```bash
npm test
```

### 代码格式检查

```bash
npm run format:check
npm run lint
```

## 项目结构

```
bics-commons/
├── packages/
│   ├── logger/                # @bics/logger
│   ├── cache-decorator/       # @bics/cache-decorator
│   ├── http-client-decorator/ # @bics/http-client-decorator
│   └── lock-decorator/        # @bics/lock-decorator
├── openspec/                  # 变更追踪文档
├── lerna.json                 # Lerna 配置
├── package.json               # 根 workspace 配置
├── tsconfig.base.json         # 基础 TypeScript 配置
├── eslint.config.mjs          # ESLint 配置
└── .prettierrc                # Prettier 配置
```

## 技术栈

- **包管理**: Lerna + Yarn/NPM Workspaces
- **语言**: TypeScript 6.0+
- **代码质量**: ESLint + Prettier
- **测试**: Jest + ts-jest
- **装饰器**: experimentalDecorators + emitDecoratorMetadata

## 贡献

请参考各包的 README 文档了解详细用法。

## License

MIT
