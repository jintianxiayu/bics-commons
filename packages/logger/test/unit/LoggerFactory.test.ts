import assert from 'node:assert/strict';
import { ConfigLoader } from '../../src/core/ConfigLoader';
import { LoggerFactory, LoggerFactoryRuntime } from '../../src/core/LoggerFactory';
import { LoggerConfigError, LoggerLifecycleError } from '../../src/core/errors';
import { createTempDirectory, disabledOutputConfig, removeTempDirectory, writeConfig } from '../helpers';

const temporaryDirectories: string[] = [];

/**
 * 为生命周期单元测试创建隔离日志工厂，避免默认单例状态在用例之间相互影响。
 *
 * @param source 写入临时配置文件的 YAML 文本。
 * @returns 使用独立目录和配置加载器的日志运行时。
 * @throws 当临时目录或配置文件创建失败时透传文件系统异常。
 */
function createFactory(source = disabledOutputConfig()): LoggerFactoryRuntime {
    const directory = createTempDirectory('logger-factory-');
    temporaryDirectories.push(directory);
    const configPath = writeConfig(directory, source);
    return new LoggerFactoryRuntime({
        configLoader: new ConfigLoader({
            env: { LOGGER_CONFIG_PATH: configPath },
            cwd: directory,
        }),
        diagnostics: () => undefined,
    });
}

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        removeTempDirectory(temporaryDirectories.pop()!);
    }
});

describe('LoggerFactoryRuntime', () => {
    test('keeps the public factory surface minimal', () => {
        const methods = Object.getOwnPropertyNames(LoggerFactory);
        assert.ok(methods.includes('init'));
        assert.ok(methods.includes('getLogger'));
        assert.ok(methods.includes('shutdown'));
        assert.ok(!methods.includes('setupShutdownHandlers'));
    });

    test('initializes idempotently and caches exact normalized names', async () => {
        const factory = createFactory();
        factory.init();
        factory.init();

        const database = factory.getLogger('database');
        assert.equal(factory.getLogger('database'), database);
        assert.equal(factory.getLogger(' database '), database);
        assert.notEqual(factory.getLogger('Database'), database);
        await factory.shutdown();
    });

    test('loads configuration only once after successful initialization', async () => {
        const directory = createTempDirectory('logger-load-once-');
        temporaryDirectories.push(directory);
        const configPath = writeConfig(directory, disabledOutputConfig());
        const factory = new LoggerFactoryRuntime({
            configLoader: new ConfigLoader({
                env: { LOGGER_CONFIG_PATH: configPath },
                cwd: directory,
            }),
            diagnostics: () => undefined,
        });

        factory.init();
        writeConfig(directory, 'root: [');
        assert.doesNotThrow(() => factory.init());
        assert.doesNotThrow(() => factory.getLogger('app'));
        await factory.shutdown();
    });

    test('initializes from a direct config object instead of the environment path', async () => {
        const directory = createTempDirectory('logger-direct-config-');
        temporaryDirectories.push(directory);
        const factory = new LoggerFactoryRuntime({
            configLoader: new ConfigLoader({
                env: { LOGGER_CONFIG_PATH: 'missing.yaml' },
                cwd: directory,
            }),
            diagnostics: () => undefined,
        });

        factory.init({
            root: {
                level: 'debug',
                console: { enabled: false },
                file: { enabled: false },
            },
            processErrors: {
                uncaughtException: false,
                unhandledRejection: false,
                exitOnError: false,
            },
        });

        assert.doesNotThrow(() => factory.getLogger('app'));
        assert.doesNotThrow(() => factory.init('missing.yaml'));
        await factory.shutdown();
    });

    test('rejects empty names and lazily surfaces configuration errors', () => {
        const factory = createFactory();
        assert.throws(() => factory.getLogger('  '), TypeError);

        const invalid = createFactory('root:\n  unknown: true');
        assert.throws(() => invalid.getLogger('app'), LoggerConfigError);
    });

    test('shares shutdown, stops accepting writes, and cannot reopen', async () => {
        const factory = createFactory();
        const logger = factory.getLogger('app');
        const first = factory.shutdown({ timeout: 1_000 });
        const second = factory.shutdown({ timeout: 0 });
        assert.equal(second, first);
        await first;

        assert.doesNotThrow(() => logger.info('late log'));
        assert.throws(() => factory.getLogger('new'), LoggerLifecycleError);
        assert.throws(() => factory.init(), LoggerLifecycleError);
    });

    test('removes process error listeners after every shutdown', async () => {
        const uncaughtExceptionListeners = process.listenerCount('uncaughtException');
        const unhandledRejectionListeners = process.listenerCount('unhandledRejection');

        for (let iteration = 0; iteration < 3; iteration += 1) {
            const factory = new LoggerFactoryRuntime({ diagnostics: () => undefined });
            factory.init({
                root: {
                    console: { enabled: true },
                    file: { enabled: false },
                },
                processErrors: {
                    uncaughtException: true,
                    unhandledRejection: true,
                    exitOnError: false,
                },
            });

            assert.ok(process.listenerCount('uncaughtException') > uncaughtExceptionListeners);
            assert.ok(process.listenerCount('unhandledRejection') > unhandledRejectionListeners);
            await factory.shutdown();
            assert.equal(process.listenerCount('uncaughtException'), uncaughtExceptionListeners);
            assert.equal(process.listenerCount('unhandledRejection'), unhandledRejectionListeners);
        }
    });

    test('validates shutdown timeout', async () => {
        const factory = createFactory();
        factory.init();
        // 正则说明：固定错误片段 positive integer 验证关闭超时必须为正整数，同时避免绑定完整错误句式。
        await assert.rejects(factory.shutdown({ timeout: 0 }), /positive integer/);
        await factory.shutdown({ timeout: 1_000 });
    });

    test('closes an uninitialized factory without creating resources', async () => {
        const factory = createFactory();
        await factory.shutdown();
        assert.throws(() => factory.getLogger('app'), LoggerLifecycleError);
    });

    test('rejects conflicting formats for the same physical file', () => {
        const factory = createFactory(`
root:
  console:
    enabled: false
  file:
    enabled: true
    format: json
    dirname: ./logs
    filename: shared.log
loggers:
  audit:
    file:
      format: plain
processErrors:
  uncaughtException: false
  unhandledRejection: false
  exitOnError: false
`);

        // 正则说明：固定错误片段验证同一物理文件禁止混用 plain 与 JSON，不依赖目标路径等动态上下文。
        assert.throws(() => factory.init(), /cannot mix plain and JSON formats/);
    });
});
