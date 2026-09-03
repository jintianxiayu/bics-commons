import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, test } from '@jest/globals';
import { createTempDirectory, removeTempDirectory, writeConfig } from '../helpers';

const temporaryDirectories: string[] = [];

/** 子进程结果需同时保留退出信号和输出，便于验证不同 exitOnError 策略下的真实进程行为。 */
interface ChildResult {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
}

/** 致命日志夹具只声明稳定顶层字段，其余 Winston 字段保持未知。 */
interface FatalEvent {
    readonly level: unknown;
    readonly name: unknown;
    readonly [key: string]: unknown;
}

/**
 * 在隔离子进程中触发致命错误，防止异常或拒绝终止当前 Jest 进程。
 *
 * @param args 传给进程错误夹具的配置路径、错误模式和断言标记。
 * @returns 子进程退出状态及捕获的标准输出、标准错误。
 * @throws 返回的 Promise 会在启动失败、运行错误或夹具超时时拒绝。
 */
function runProcessErrorChild(args: readonly string[]): Promise<ChildResult> {
    return new Promise((resolveResult, reject) => {
        const fixture = join(__dirname, '..', 'fixtures', 'process-error-child.ts');
        const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', fixture, ...args], {
            cwd: resolve(__dirname, '../..'),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Process error fixture timed out'));
        }, 10_000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => (stdout += chunk));
        child.stderr.on('data', (chunk: string) => (stderr += chunk));
        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolveResult({ code, signal, stdout, stderr });
        });
    });
}

/**
 * 汇总轮转文件中的致命日志事件，避免测试依赖具体日期后缀或文件分片数量。
 *
 * @param logDirectory 夹具写入致命日志的目录。
 * @returns 目录内所有日志行解析得到的事件列表；每个事件的 K 为 JSON 字段名，V 为对应解析值。
 * @throws 当目录读取、文件读取或 JSON 解析失败时透传异常。
 */
function readFatalEvents(logDirectory: string): FatalEvent[] {
    // 正则说明：\r? 兼容 Windows 可选回车符，\n 匹配换行符，使致命日志文件在不同平台都按事件拆分。
    const lines = readdirSync(logDirectory)
        .filter((name) => name.endsWith('.log'))
        .flatMap((name) => readFileSync(join(logDirectory, name), 'utf8').split(/\r?\n/).filter(Boolean));
    return lines.map((line) => JSON.parse(line) as FatalEvent);
}

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        removeTempDirectory(temporaryDirectories.pop()!);
    }
});

describe('Winston process error integration', () => {
    for (const mode of ['exception', 'rejection'] as const) {
        for (const exitOnError of [true, false]) {
            test(`records ${mode} once with exitOnError=${exitOnError}`, async () => {
                const directory = createTempDirectory(`logger-${mode}-`);
                temporaryDirectories.push(directory);
                const logDirectory = join(directory, 'logs');
                // 正则说明：\\ 精确匹配单个 Windows 反斜杠，g 标志替换全部路径分隔符，确保 YAML 使用跨平台的正斜杠路径。
                const normalizedLogDirectory = logDirectory.replace(/\\/g, '/');
                const configPath = writeConfig(
                    directory,
                    `
root:
  level: info
  console:
    enabled: false
  file:
    enabled: true
    format: json
    dirname: ${JSON.stringify(normalizedLogDirectory)}
    filename: fatal.log
    datePattern: YYYY-MM-DD
    maxSize: 1m
    maxFiles: 2
processErrors:
  uncaughtException: true
  unhandledRejection: true
  exitOnError: ${exitOnError}
`
                );
                const marker = `${mode}-marker-${exitOnError}`;
                const result = await runProcessErrorChild([configPath, mode, marker, String(exitOnError)]);

                // 正则说明：固定文本 READY 只验证夹具已完成日志器初始化，不依赖其余可能变化的子进程输出。
                assert.match(result.stdout, /READY/);
                assert.equal(result.signal, null);
                if (exitOnError) {
                    assert.notEqual(result.code, 0);
                } else {
                    assert.equal(result.code, 0, result.stderr);
                }

                const matchingEvents = readFatalEvents(logDirectory).filter((event) =>
                    JSON.stringify(event).includes(marker)
                );
                assert.equal(matchingEvents.length, 1, result.stderr);
                assert.equal(matchingEvents[0]!.level, 'error');
                assert.equal(matchingEvents[0]!.name, 'root');
                assert.match(JSON.stringify(matchingEvents[0]), new RegExp(marker));
            });
        }
    }
});
