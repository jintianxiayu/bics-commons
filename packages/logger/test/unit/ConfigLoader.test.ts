import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DEFAULT_PATTERN } from '../../src/config/defaultConfig';
import { ConfigLoader } from '../../src/core/ConfigLoader';
import { LoggerConfigError } from '../../src/core/errors';
import { createTempDirectory, removeTempDirectory, writeConfig } from '../helpers';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
    const directory = createTempDirectory('logger-config-');
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        removeTempDirectory(temporaryDirectories.pop()!);
    }
});

describe('ConfigLoader', () => {
    test('uses immutable defaults when no path is configured', () => {
        const directory = temporaryDirectory();
        const config = new ConfigLoader({ env: {}, cwd: directory }).load();

        assert.equal(config.root.level, 'info');
        assert.equal(config.root.captureLogPosition, true);
        assert.equal(config.root.console.enabled, true);
        assert.equal(config.root.console.colors, false);
        assert.equal(config.root.console.pattern, DEFAULT_PATTERN);
        assert.equal(config.root.file.enabled, false);
        assert.equal(config.root.file.pattern, DEFAULT_PATTERN);
        assert.equal(config.root.file.dirname, join(directory, 'logs'));
        assert.equal(config.processErrors.exitOnError, true);
        assert.ok(Object.isFrozen(config.root));
        assert.ok(Object.isFrozen(config.root.console));
    });

    test('prefers an explicit path over LOGGER_CONFIG_PATH', () => {
        const directory = temporaryDirectory();
        writeConfig(
            directory,
            `
root:
  level: warn
`
        );
        const loader = new ConfigLoader({
            env: { LOGGER_CONFIG_PATH: 'missing.yaml' },
            cwd: directory,
        });

        const config = loader.load('logger.yaml');

        assert.equal(config.root.level, 'warn');
    });

    test('prefers a direct config object over LOGGER_CONFIG_PATH and applies normal validation', () => {
        const directory = temporaryDirectory();
        const loader = new ConfigLoader({
            env: { LOGGER_CONFIG_PATH: 'missing.yaml' },
            cwd: directory,
        });

        const config = loader.load({
            root: {
                level: 'debug',
                console: { colors: true },
            },
        });

        assert.equal(config.root.level, 'debug');
        assert.equal(config.root.console.colors, true);
        assert.ok(Object.isFrozen(config.root));
        assert.throws(
            () => loader.load({ root: { level: 'verbose' } } as never),
            // 正则说明：root\.level 中转义点号以匹配字段路径字面量，其余固定文本验证错误完整列出全部受支持级别。
            /root\.level must be one of: debug, info, warn, error/
        );
    });

    test('deeply inherits root values and preserves explicit false', () => {
        const directory = temporaryDirectory();
        writeConfig(
            directory,
            `
root:
  level: warn
  captureLogPosition: false
  console:
    enabled: true
    colors: true
    format: plain
    pattern: '%{level}|root-console'
  file:
    enabled: false
    pattern: '%{message}|root-file'
loggers:
  database:
    level: debug
    captureLogPosition: true
    console:
      colors: false
      pattern: '%{message}|database-console'
processErrors:
  uncaughtException: false
  unhandledRejection: false
  exitOnError: false
`
        );

        const config = new ConfigLoader({
            env: { LOGGER_CONFIG_PATH: 'logger.yaml' },
            cwd: directory,
        }).load();
        const database = config.loggers.get('database')!;

        assert.equal(database.level, 'debug');
        assert.equal(config.root.captureLogPosition, false);
        assert.equal(database.captureLogPosition, true);
        assert.equal(database.console.enabled, true);
        assert.equal(database.console.colors, false);
        assert.equal(database.console.format, 'plain');
        assert.equal(config.root.console.pattern, '%{level}|root-console');
        assert.equal(database.console.pattern, '%{message}|database-console');
        assert.equal(database.file.enabled, false);
        assert.equal(database.file.pattern, '%{message}|root-file');
        assert.equal(config.loggers.has('Database'), false);
    });
});

describe('ConfigLoader validation', () => {
    test('fails explicitly for a missing configured file', () => {
        const directory = temporaryDirectory();
        const loader = new ConfigLoader({
            env: { LOGGER_CONFIG_PATH: 'missing.yaml' },
            cwd: directory,
        });

        assert.throws(() => loader.load(), LoggerConfigError);
        // 正则说明：固定错误文本验证空白显式路径被拒绝，避免只匹配通用 Error 类型而遗漏具体失败原因。
        assert.throws(() => loader.load('  '), /Logger configuration path must not be empty/);
    });

    test('fails for empty, malformed, or non-mapping YAML', () => {
        const directory = temporaryDirectory();
        for (const source of ['', 'root: [', '- item']) {
            const configPath = writeConfig(directory, source);
            assert.throws(
                () =>
                    new ConfigLoader({
                        env: { LOGGER_CONFIG_PATH: configPath },
                        cwd: directory,
                    }).load(),
                LoggerConfigError
            );
        }
    });

    test('rejects unknown fields, plain placeholders, and masking tokens', () => {
        const directory = temporaryDirectory();
        const invalidSources = [
            'root:\n  unknown: true',
            'root:\n  captureLogPosition: invalid',
            "root:\n  pattern: '%{unknown}'",
            "root:\n  console:\n    pattern: '%{unknown}'",
            "masking:\n  fields:\n    secret: '{middle2}'",
            "masking:\n  fields:\n    Token: 'x'\n    token: 'y'",
            'loggers:\n  app:\n    masking:\n      enabled: false',
        ];

        for (const source of invalidSources) {
            const configPath = writeConfig(directory, source);
            assert.throws(
                () =>
                    new ConfigLoader({
                        env: { LOGGER_CONFIG_PATH: configPath },
                        cwd: directory,
                    }).load(),
                LoggerConfigError
            );
        }
    });

    test('validates a transport pattern only when its effective format is plain', () => {
        const directory = temporaryDirectory();
        const jsonConfigPath = writeConfig(
            directory,
            `
root:
  console:
    format: json
    pattern: '%{unknown}'
`
        );
        const jsonConfig = new ConfigLoader({
            env: { LOGGER_CONFIG_PATH: jsonConfigPath },
            cwd: directory,
        }).load();
        assert.equal(jsonConfig.root.console.pattern, '%{unknown}');

        const inheritedPlainPath = writeConfig(
            directory,
            `
root:
  console:
    format: json
    pattern: '%{unknown}'
loggers:
  worker:
    console:
      format: plain
`
        );
        assert.throws(
            () =>
                new ConfigLoader({
                    env: { LOGGER_CONFIG_PATH: inheritedPlainPath },
                    cwd: directory,
                }).load(),
            LoggerConfigError
        );
    });

    test('requires a root output when process error handling is enabled', () => {
        const directory = temporaryDirectory();
        const configPath = writeConfig(
            directory,
            `
root:
  console:
    enabled: false
  file:
    enabled: false
processErrors:
  uncaughtException: true
  unhandledRejection: false
`
        );

        assert.throws(
            () =>
                new ConfigLoader({
                    env: { LOGGER_CONFIG_PATH: configPath },
                    cwd: directory,
                }).load(),
            // 正则说明：固定错误片段验证启用进程错误处理时必须存在根输出通道，不依赖错误消息中的其他上下文。
            /requires at least one enabled root transport/
        );
    });
});
