import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, test } from '@jest/globals';
import { ConfigLoader } from '../../src/core/ConfigLoader';
import { LoggerContext } from '../../src/core/LoggerContext';
import { LoggerFactoryRuntime } from '../../src/core/LoggerFactory';
import { createTempDirectory, removeTempDirectory, writeConfig } from '../helpers';

const temporaryDirectories: string[] = [];

/** 文件 JSON 夹具只声明查询日志断言消费的字段。 */
interface QueryEvent {
    readonly level: string;
    readonly name: string;
    readonly traceId: string;
    readonly logPosition: string;
    readonly meta: {
        readonly password: string;
        readonly tenantSecret: string;
        readonly phone: string;
    };
}

/** 文件 JSON 夹具只声明异常日志断言消费的字段。 */
interface FailureEvent {
    readonly logPosition: string;
    readonly meta: {
        readonly args: readonly {
            readonly name: string;
            readonly message: string;
            readonly stack: string;
        }[];
    };
}

function temporaryDirectory(): string {
    const directory = createTempDirectory('logger-file-');
    temporaryDirectories.push(directory);
    return directory;
}

/**
 * 为单个文件输出用例创建隔离运行时，确保配置路径和诊断通道不依赖测试进程全局状态。
 *
 * @param directory 当前用例的临时工作目录。
 * @param configPath 当前用例的 YAML 配置路径。
 * @returns 使用隔离配置加载器的日志运行时。
 * @throws 不主动抛出异常。
 */
function factoryFor(directory: string, configPath: string): LoggerFactoryRuntime {
    return new LoggerFactoryRuntime({
        configLoader: new ConfigLoader({
            env: { LOGGER_CONFIG_PATH: configPath },
            cwd: directory,
        }),
        diagnostics: () => undefined,
    });
}

function logFiles(directory: string): string[] {
    return readdirSync(directory)
        .filter((name) => !name.endsWith('.json') && !name.includes('-audit'))
        .map((name) => join(directory, name));
}

function readLines(files: readonly string[]): string[] {
    // 正则说明：\r? 兼容 Windows 可选回车符，\n 匹配换行符，使轮转文件在不同平台都按单条日志拆分。
    return files.flatMap((file) => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean));
}

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        removeTempDirectory(temporaryDirectories.pop()!);
    }
});

describe('rotating file integration', () => {
    test('writes logs when initialized with a direct config object', async () => {
        const directory = temporaryDirectory();
        const logDirectory = join(directory, 'direct-logs');
        const factory = new LoggerFactoryRuntime({
            configLoader: new ConfigLoader({
                env: { LOGGER_CONFIG_PATH: 'missing.yaml' },
                cwd: directory,
            }),
            diagnostics: () => undefined,
        });
        factory.init({
            root: {
                captureLogPosition: false,
                console: { enabled: false },
                file: {
                    enabled: true,
                    format: 'json',
                    dirname: './direct-logs',
                    filename: 'direct.log',
                    maxSize: '1m',
                    maxFiles: 2,
                },
            },
            processErrors: {
                uncaughtException: false,
                unhandledRejection: false,
                exitOnError: false,
            },
        });

        factory.getLogger('direct').info('direct config event');
        await factory.shutdown({ timeout: 3_000 });

        /** 事件数组中的每个映射均以 K 表示 JSON 日志字段名、V 表示解析后的字段值。 */
        const events = readLines(logFiles(logDirectory)).map((line) => JSON.parse(line) as Record<string, unknown>);
        assert.equal(events.length, 1);
        assert.equal(events[0]!.name, 'direct');
        assert.equal(events[0]!.message, 'direct config event');
    });

    test('writes masked one-line JSON with trace context and normalized Error', async () => {
        const directory = temporaryDirectory();
        const logDirectory = join(directory, 'logs');
        const configPath = writeConfig(
            directory,
            `
root:
  level: warn
  captureLogPosition: true
  console:
    enabled: false
  file:
    enabled: true
    format: json
    dirname: ./logs
    filename: app.log
    datePattern: YYYY-MM-DD
    maxSize: 1m
    maxFiles: 2
loggers:
  database:
    level: debug
masking:
  enabled: true
  fields:
    tenantSecret: '********'
processErrors:
  uncaughtException: false
  unhandledRejection: false
  exitOnError: false
`
        );
        const factory = factoryFor(directory, configPath);
        const app = factory.getLogger('app');
        const database = factory.getLogger('database');
        const metadata = {
            password: 'file-secret',
            tenantSecret: 'tenant-secret',
            phone: '13800138000',
            statusCode: 200,
        };

        app.info('filtered event', { shouldNotAppear: true });
        LoggerContext.withContext({ traceId: 'file-trace' }, () => {
            database.debug('query completed', metadata);
            database.error('query failed', new Error('database unavailable'));
        });
        await factory.shutdown({ timeout: 3_000 });
        database.info('late event');

        const files = logFiles(logDirectory);
        assert.equal(files.length, 1);
        const lines = readLines(files);
        assert.equal(lines.length, 2);
        assert.ok(lines.every((line) => !line.includes('\u001b')));
        assert.ok(lines.every((line) => !line.includes('file-secret')));
        assert.ok(lines.every((line) => !line.includes('tenant-secret')));
        assert.ok(lines.every((line) => !line.includes('filtered event')));
        assert.ok(lines.every((line) => !line.includes('late event')));

        /** 查询日志映射中 K 为 JSON 日志字段名，V 为查询事件对应的解析值。 */
        const query = JSON.parse(lines[0]!) as QueryEvent;
        assert.equal(query.level, 'debug');
        assert.equal(query.name, 'database');
        assert.equal(query.traceId, 'file-trace');
        // 正则说明：:\d+$ 要求调用位置以至少一位行号结束，验证查询日志包含 file:line。
        assert.match(query.logPosition, /:\d+$/);
        // 正则说明：:\d+:\d+$ 检测行号和列号双数字结尾，doesNotMatch 验证查询日志没有输出列号。
        assert.doesNotMatch(query.logPosition, /:\d+:\d+$/);
        assert.equal(query.meta.password, '********');
        assert.equal(query.meta.tenantSecret, '********');
        // 正则说明：8000$ 将末四位固定在字符串结尾，验证号码脱敏仅保留原值最后四位。
        assert.match(query.meta.phone, /8000$/);

        /** 失败日志映射中 K 为 JSON 日志字段名，V 为错误事件对应的解析值。 */
        const failure = JSON.parse(lines[1]!) as FailureEvent;
        // 正则说明：:\d+$ 要求错误调用位置以至少一位行号结束，验证异常日志同样保留 file:line。
        assert.match(failure.logPosition, /:\d+$/);
        const normalizedError = failure.meta.args[0];
        assert.ok(normalizedError);
        assert.equal(normalizedError.name, 'Error');
        assert.equal(normalizedError.message, 'database unavailable');
        // 正则说明：固定文本 database unavailable 验证 Error stack 保留原始业务错误消息，不依赖平台相关栈格式。
        assert.match(normalizedError.stack, /database unavailable/);
        assert.equal(metadata.password, 'file-secret');
    });
});

describe('rotating file formats and retention', () => {
    test('writes plain log_position as file:line without color or column', async () => {
        const directory = temporaryDirectory();
        const logDirectory = join(directory, 'logs');
        const configPath = writeConfig(
            directory,
            `
root:
  level: info
  captureLogPosition: true
  console:
    enabled: false
  file:
    enabled: true
    format: plain
    pattern: '%{log_position}|%{level}|%{name}|%{message}|%{meta}'
    dirname: ./logs
    filename: plain.log
    maxSize: 1m
    maxFiles: 2
processErrors:
  uncaughtException: false
  unhandledRejection: false
  exitOnError: false
`
        );
        const factory = factoryFor(directory, configPath);
        factory.getLogger('plain').info('plain event', { token: 'plain-secret' });
        await factory.shutdown({ timeout: 3_000 });

        const output = readLines(logFiles(logDirectory))[0]!;
        const position = output.split('|')[0]!;
        // 正则说明：:\d+$ 要求纯文本位置以至少一位行号结束，验证输出满足 file:line 契约。
        assert.match(position, /:\d+$/);
        // 正则说明：:\d+:\d+$ 检测额外列号，doesNotMatch 验证纯文本位置严格排除 file:line:column。
        assert.doesNotMatch(position, /:\d+:\d+$/);
        assert.ok(!output.includes('\u001b'));
        assert.ok(!output.includes('plain-secret'));
        // 正则说明：固定 JSON 键 token 后要求恰好八个星号，验证完整掩码值且不误匹配其他字段。
        assert.match(output, /"token":"\*{8}"/);
    });

    test('maps datePattern, maxSize, and maxFiles to the rotating transport', async () => {
        const directory = temporaryDirectory();
        const logDirectory = join(directory, 'logs');
        const configPath = writeConfig(
            directory,
            `
root:
  level: info
  captureLogPosition: false
  console:
    enabled: false
  file:
    enabled: true
    format: json
    dirname: ./logs
    filename: rotate.log
    datePattern: YYYY-MM-DD
    maxSize: 1k
    maxFiles: 2
processErrors:
  uncaughtException: false
  unhandledRejection: false
  exitOnError: false
`
        );
        const factory = factoryFor(directory, configPath);
        const logger = factory.getLogger('rotation');
        for (let index = 0; index < 20; index += 1) {
            logger.info(`rotation-${index}`, { payload: 'x'.repeat(160) });
        }
        await factory.shutdown({ timeout: 5_000 });

        const fileNames = logFiles(logDirectory).map((file) => file.slice(logDirectory.length + 1));
        assert.ok(fileNames.length >= 1);
        assert.ok(fileNames.length <= 2);
        // 正则说明：^rotate- 固定前缀，年/月/日分别限制 4/2/2 位数字，\.log 固定扩展名，(?:\.\d+)? 允许轮转序号，$ 禁止多余后缀。
        assert.ok(fileNames.every((name) => /^rotate-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(name)));
        const lines = readLines(logFiles(logDirectory));
        assert.ok(lines.some((line) => line.includes('rotation-19')));
        assert.ok(
            lines.every((line) => !Object.prototype.hasOwnProperty.call(JSON.parse(line) as object, 'logPosition'))
        );
    });
});
