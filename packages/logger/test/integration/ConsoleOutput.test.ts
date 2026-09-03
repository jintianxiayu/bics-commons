import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, test } from '@jest/globals';
import { createTempDirectory, removeTempDirectory, writeConfig } from '../helpers';

const temporaryDirectories: string[] = [];

/** 控制台 JSON 夹具只声明当前断言消费的稳定字段。 */
interface ConsoleJsonEvent {
    readonly name: string;
    readonly traceId: string;
    readonly logPosition: string;
    readonly meta: {
        readonly password: string;
        readonly statusCode: number;
    };
}

/**
 * 在独立子进程中运行控制台夹具，避免 Winston 输出和进程状态污染 Jest 本身。
 *
 * @param script 需要执行的 TypeScript 夹具路径。
 * @param args 传递给夹具进程的命令行参数。
 * @returns 子进程退出码及捕获的标准输出、标准错误。
 * @throws 返回的 Promise 会在子进程无法启动时拒绝。
 */
function runChild(
    script: string,
    args: readonly string[]
): Promise<{
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}> {
    return new Promise((resolveResult, reject) => {
        const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', script, ...args], {
            cwd: resolve(__dirname, '../..'),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => (stdout += chunk));
        child.stderr.on('data', (chunk: string) => (stderr += chunk));
        child.once('error', reject);
        child.once('exit', (code) => resolveResult({ code, stdout, stderr }));
    });
}

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        removeTempDirectory(temporaryDirectories.pop()!);
    }
});

test('console JSON is a single parseable line without ANSI or raw secrets', async () => {
    const directory = createTempDirectory('logger-console-');
    temporaryDirectories.push(directory);
    const configPath = writeConfig(
        directory,
        `
root:
  level: info
  captureLogPosition: true
  console:
    enabled: true
    colors: true
    format: plain
  file:
    enabled: false
loggers:
  console:
    console:
      format: json
      pattern: '%{message}'
processErrors:
  uncaughtException: false
  unhandledRejection: false
  exitOnError: false
`
    );
    const fixture = join(__dirname, '..', 'fixtures', 'console-output-child.ts');
    const result = await runChild(fixture, [configPath]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    // 正则说明：\r? 兼容 Windows 可选回车符，\n 匹配换行符，使子进程输出在 Windows 和 Unix 下都按日志行拆分。
    const lines = result.stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1);
    assert.ok(!lines[0]!.includes('\u001b'));
    assert.ok(!lines[0]!.includes('console-secret'));
    /** 解析事件中 K 为 JSON 日志字段名，V 为夹具输出的对应 JSON 值。 */
    const event = JSON.parse(lines[0]!) as ConsoleJsonEvent;
    assert.equal(event.name, 'console');
    assert.equal(event.traceId, 'console-trace');
    // 正则说明：:\d+$ 要求位置以冒号和至少一位行号结束，验证日志保留 file:line 结尾。
    assert.match(event.logPosition, /:\d+$/);
    // 正则说明：:\d+:\d+$ 会匹配行号和列号双数字结尾，doesNotMatch 用于确保列号未泄露到公共格式。
    assert.doesNotMatch(event.logPosition, /:\d+:\d+$/);
    assert.equal(event.meta.password, '********');
    assert.equal(event.meta.statusCode, 201);
});

test('each Plain transport follows its own pattern without appending log position', async () => {
    const directory = createTempDirectory('logger-console-plain-');
    temporaryDirectories.push(directory);
    const logDirectory = join(directory, 'logs');
    const configPath = writeConfig(
        directory,
        `
root:
  level: info
  captureLogPosition: true
  console:
    enabled: true
    colors: false
    format: plain
    pattern: '%{level}|%{name}|%{message}'
  file:
    enabled: true
    format: plain
    pattern: 'file|%{log_position}|%{message}'
    dirname: '${logDirectory.replaceAll('\\', '/')}'
    filename: combined.log
processErrors:
  uncaughtException: false
  unhandledRejection: false
  exitOnError: false
`
    );
    const fixture = join(__dirname, '..', 'fixtures', 'console-output-child.ts');
    const result = await runChild(fixture, [configPath]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.trim(), 'info|console|console event');

    const fileName = readdirSync(logDirectory).find((name) => !name.endsWith('.json') && !name.includes('-audit'));
    assert.ok(fileName);
    const fileOutput = readFileSync(join(logDirectory, fileName), 'utf8').trim();
    // 正则说明：^file\| 固定模板前缀，.+:\d+ 要求非空 file:line，\|console event$ 固定消息与结尾，验证完整文件模板结构。
    assert.match(fileOutput, /^file\|.+:\d+\|console event$/);
    // 正则说明：:\d+:\d+ 检测行号后仍包含列号，并限定其后紧接固定消息，doesNotMatch 验证文件日志只输出 file:line。
    assert.doesNotMatch(fileOutput, /:\d+:\d+\|console event$/);
});
