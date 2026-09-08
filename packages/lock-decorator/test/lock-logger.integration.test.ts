import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCommand } from './helpers/package-consumer';

jest.setTimeout(30_000);

interface LockLogMetadata {
    readonly event: string;
    readonly operation?: string;
    readonly error?: {
        readonly name: string;
        readonly message: string;
        readonly password: string;
        readonly email: string;
    };
    readonly [field: string]: unknown;
}

interface JsonLogEvent {
    readonly level: string;
    readonly name: string;
    readonly message: string;
    readonly traceId: string;
    readonly meta: LockLogMetadata;
}

interface ChildResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

const packageRoot = resolve(__dirname, '..');
const loggerRoot = resolve(packageRoot, '../logger');
const fixture = join(__dirname, 'fixtures', 'lock-logger-child.mjs');

function runFixture(profileLevel: 'debug' | 'warn'): Promise<ChildResult> {
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

it('lock-operation-logging/应用配置 lock 命名 Logger', async () => {
    const result = await runFixture('debug');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    for (const secret of [
        'provider-password-secret',
        'provider@example.com',
        'business-value-secret',
        'provider-token-secret',
        'success-key-secret',
        'contended-key-secret',
        'failure-key-secret',
    ]) {
        expect(result.stdout).not.toContain(secret);
    }

    const output = parseEvents(result.stdout);
    expect(output.map(({ level, meta }) => `${level}:${meta.event}`)).toEqual([
        'debug:lock.acquire_started',
        'debug:lock.acquired',
        'debug:lock.watchdog_skipped',
        'debug:lock.execution_started',
        'debug:lock.execution_completed',
        'debug:lock.release_started',
        'debug:lock.released',
        'debug:lock.acquire_started',
        'warn:lock.acquire_exhausted',
        'debug:lock.acquire_started',
        'error:lock.operation_failed',
    ]);
    expect(output.every(({ name }) => name === '@jintianxiayu/lock-decorator')).toBe(true);
    expect(output.every(({ traceId }) => traceId === 'lock-fixture-trace')).toBe(true);
    expect(output.every(({ meta }) => !('traceId' in meta))).toBe(true);
    expect(output.at(-1)?.meta).toMatchObject({
        event: 'lock.operation_failed',
        operation: 'acquire',
        error: {
            name: 'Error',
            message: 'redis unavailable',
            password: '********',
            email: 'pr***@example.com',
        },
    });
});

it('lock-operation-logging/基础设施异常包含敏感字段', async () => {
    const result = await runFixture('warn');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const output = parseEvents(result.stdout);
    expect(output.map(({ level, meta }) => `${level}:${meta.event}`)).toEqual([
        'warn:lock.acquire_exhausted',
        'error:lock.operation_failed',
    ]);
    expect(output.every(({ name }) => name === '@jintianxiayu/lock-decorator')).toBe(true);
});

it('lock decorator 源码不读取或写入 LoggerContext', () => {
    const sources = ['src/core/lock-logger.ts', 'src/core/watchdog.ts', 'src/decorators/distributed-lock.ts']
        .map((file) => readFileSync(join(packageRoot, file), 'utf8'))
        .join('\n');
    expect(sources).not.toContain('LoggerContext');
});
