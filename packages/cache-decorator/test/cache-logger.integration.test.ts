import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCommand } from './helpers/package-consumer';

jest.setTimeout(30_000);

interface CacheLogMetadata {
    readonly event: string;
    readonly cacheName: string;
    readonly methodName: string;
    readonly providerName: string;
    readonly entryType?: string;
    readonly operation?: string;
    readonly error?: {
        readonly name: string;
        readonly message: string;
        readonly password: string;
        readonly email: string;
    };
}

interface JsonLogEvent {
    readonly level: string;
    readonly name: string;
    readonly message: string;
    readonly traceId: string;
    readonly meta: CacheLogMetadata;
}

interface ChildResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

const packageRoot = resolve(__dirname, '..');
const loggerRoot = resolve(packageRoot, '../logger');
const fixture = join(__dirname, 'fixtures', 'cache-logger-child.mjs');
const providerFailureFixture = join(__dirname, 'fixtures', 'cache-provider-failure-child.mjs');

/**
 * 在隔离进程运行真实 Logger fixture，确保关闭流程完整刷新结构化输出。
 * @param profileLevel cache 命名 profile 的筛选级别。
 * @returns 子进程退出码和完整标准流。
 * @throws 子进程无法启动时拒绝。
 */
function runFixture(profileLevel: 'debug' | 'error'): Promise<ChildResult> {
    return new Promise((resolveResult, reject) => {
        const child = spawn(process.execPath, [fixture, profileLevel], {
            cwd: packageRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
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

/**
 * 在严格未处理 rejection 模式运行 Provider 异步失败 fixture。
 * @returns 子进程退出码和完整标准流。
 * @throws 子进程无法启动时拒绝。
 */
function runProviderFailureFixture(): Promise<ChildResult> {
    return new Promise((resolveResult, reject) => {
        const child = spawn(process.execPath, ['--unhandled-rejections=strict', providerFailureFixture], {
            cwd: packageRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
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

function parseEvents(output: string): JsonLogEvent[] {
    return output
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JsonLogEvent);
}

beforeAll(() => {
    const compiler = require.resolve('typescript/bin/tsc');
    runCommand({ executable: process.execPath, args: [compiler, '-p', loggerRoot], cwd: loggerRoot });
    runCommand({ executable: process.execPath, args: [compiler, '-p', packageRoot], cwd: packageRoot });
});

it('cache-operation-logging/M03 cache-operation-logging/M04 使用真实命名 Logger 脱敏并关联 traceId', async () => {
    const result = await runFixture('debug');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('provider-password-secret');
    expect(result.stdout).not.toContain('provider@example.com');
    expect(result.stdout).not.toContain('business-value-secret');

    const output = parseEvents(result.stdout);
    expect(output.map(({ level, meta }) => `${level}:${meta.event}`)).toEqual([
        'debug:cache.miss',
        'debug:cache.write_dispatched',
        'error:cache.operation_failed',
    ]);
    expect(output.every(({ name }) => name === '@jintianxiayu/cache-decorator')).toBe(true);
    expect(output.every(({ traceId }) => traceId === 'cache-fixture-trace')).toBe(true);
    expect(output.every(({ meta }) => !('traceId' in meta))).toBe(true);
    expect(output[2]?.meta).toMatchObject({
        event: 'cache.operation_failed',
        cacheName: 'fixture-failure-users',
        methodName: 'getUser',
        providerName: 'failing',
        operation: 'read',
        error: {
            name: 'Error',
            message: 'redis unavailable',
            password: '********',
            email: 'pr***@example.com',
        },
    });
});

it('cache-operation-logging/Logger 配置筛选输出且复用应用提供的唯一 Logger runtime', async () => {
    const result = await runFixture('error');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const output = parseEvents(result.stdout);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
        level: 'error',
        name: '@jintianxiayu/cache-decorator',
        traceId: 'cache-fixture-trace',
        meta: { event: 'cache.operation_failed', operation: 'read' },
    });
});

it('异步缓存写入和单 key 删除拒绝不会触发未处理 rejection', async () => {
    const result = await runProviderFailureFixture();
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
});

it('cache decorator 源码不读取或写入 LoggerContext', () => {
    const sources = ['src/core/cache-logger.ts', 'src/decorators/cache.ts', 'src/decorators/cache-evict.ts']
        .map((file) => readFileSync(join(packageRoot, file), 'utf8'))
        .join('\n');
    expect(sources).not.toContain('LoggerContext');
});
