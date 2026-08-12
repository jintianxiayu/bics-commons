import { existsSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import { LoggerContext } from '../src/core/LoggerContext';
import { LoggerFactory } from '../src/core/LoggerFactory';

const TEST_CONFIG_PATH = path.join(__dirname, 'test-meta-serialization-config.yaml');

function writeConfig(): void {
    writeFileSync(
        TEST_CONFIG_PATH,
        `root:
  level: debug
  pattern: '%{meta}'
  console:
    enabled: true
    colors: false
    format: plain
  file:
    enabled: false
loggers:
  json:
    console:
      format: json
`
    );
}

function captureStdout(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const stream = (console as unknown as { _stdout: NodeJS.WriteStream })._stdout;
    const original = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array) => {
        const value = typeof chunk === 'string' ? chunk : chunk.toString();
        lines.push(...value.split(/\r?\n/).filter(Boolean));
        return true;
    }) as typeof stream.write;
    return { lines, restore: () => (stream.write = original) };
}

function createUnsafeMeta(): Record<string, unknown> {
    const cause = new TypeError('inner diagnostic');
    const error = new Error('outer diagnostic') as Error & { cause: Error; code: string };
    Object.defineProperty(error, 'cause', { configurable: true, value: cause });
    error.code = 'E_META';

    const meta: Record<string, unknown> = {
        bigint: 9007199254740993n,
        date: new Date('2026-08-13T01:02:03.000Z'),
        error,
        password: 'raw-password-value',
        token: new Error('raw-token-diagnostic'),
    };
    Object.defineProperty(meta, 'broken', {
        enumerable: true,
        get(): never {
            throw new Error('raw-getter-diagnostic');
        },
    });
    meta.self = meta;
    return meta;
}

describe('logger meta serialization integration', () => {
    beforeEach(() => {
        LoggerFactory.reset();
        writeConfig();
        process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
    });

    afterEach(async () => {
        await LoggerFactory.shutdown({ timeout: 0 });
        LoggerContext.clear();
        delete process.env.LOGGER_CONFIG_PATH;
        if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH);
    });

    it('emits identical safe meta semantics in plain and JSON modes', () => {
        const output = captureStdout();
        try {
            const unsafe = createUnsafeMeta();
            expect(() => LoggerFactory.getLogger('plain').info('event', unsafe)).not.toThrow();
            expect(() =>
                LoggerContext.withContext({ traceId: 'trace-meta' }, () => {
                    LoggerFactory.getLogger('json').info('event', unsafe);
                })
            ).not.toThrow();

            const plainMeta = JSON.parse(output.lines[0]!) as Array<Record<string, unknown>>;
            const jsonLine = JSON.parse(output.lines[1]!) as Record<string, any>;

            expect(jsonLine.meta).toEqual(plainMeta);
            expect(jsonLine).toMatchObject({ level: 'info', message: 'event', name: 'json', traceId: 'trace-meta' });
            expect(jsonLine.timestamp).toBeDefined();
            expect(plainMeta[0]).toMatchObject({
                bigint: '9007199254740993',
                date: '2026-08-13T01:02:03.000Z',
                error: { name: 'Error', message: 'outer diagnostic', code: 'E_META' },
                password: '********',
                token: '********',
                broken: '[Property Access Error]',
                self: '[Circular]',
            });
            const combined = output.lines.join('\n');
            expect(combined).not.toContain('raw-password-value');
            expect(combined).not.toContain('raw-token-diagnostic');
            expect(combined).not.toContain('raw-getter-diagnostic');
        } finally {
            output.restore();
        }
    });

    it.each(['debug', 'info', 'warn', 'error'] as const)('does not throw at %s level', (level) => {
        const output = captureStdout();
        try {
            const logger = LoggerFactory.getLogger('json');

            expect(() => logger[level](`${level}-event`, createUnsafeMeta())).not.toThrow();

            const parsed = JSON.parse(output.lines[0]!) as Record<string, any>;
            expect(parsed.level).toBe(level);
            expect(parsed.message).toBe(`${level}-event`);
            expect(parsed.meta[0].self).toBe('[Circular]');
            expect(parsed.meta[0].bigint).toBe('9007199254740993');
        } finally {
            output.restore();
        }
    });
});
