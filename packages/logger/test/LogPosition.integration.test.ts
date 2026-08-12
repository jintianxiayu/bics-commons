import { existsSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import { LoggerFactory } from '../src/core/LoggerFactory';
import { LogPosition } from '../src/core/LogPosition';

const TEST_CONFIG_PATH = path.join(__dirname, 'test-log-position-config.yaml');
const TEST_LOG_DIR = path.join(__dirname, 'test-log-position-output');

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

function configure(format: 'plain' | 'json', pattern: string): void {
    writeFileSync(
        TEST_CONFIG_PATH,
        `root:
  level: debug
  pattern: '${pattern}'
  console:
    enabled: true
    colors: false
    format: ${format}
  file:
    enabled: false
`
    );
    process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
}

function logFromBusinessHelper(message: string): void {
    LoggerFactory.getLogger('position-integration').info(message, { value: 1 });
}

describe('LoggerFactory log position integration', () => {
    beforeEach(() => {
        LoggerFactory.reset();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await LoggerFactory.shutdown();
        await new Promise<void>((resolve) => setImmediate(resolve));
        delete process.env.LOGGER_CONFIG_PATH;
        if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH);
        if (existsSync(TEST_LOG_DIR)) rmSync(TEST_LOG_DIR, { recursive: true });
    });

    it('captures once and replaces every plain position placeholder', () => {
        configure('plain', '%{log_position}|%{message}|%{log_position}');
        const capture = jest.spyOn(LogPosition, 'capture').mockReturnValue('src/business.ts:12:34');
        const output = captureStdout();
        try {
            LoggerFactory.getLogger('position').info('event');

            expect(output.lines).toEqual(['src/business.ts:12:34|event|src/business.ts:12:34']);
            expect(capture).toHaveBeenCalledTimes(1);
        } finally {
            output.restore();
        }
    });

    it('does not capture for a plain pattern without the placeholder', () => {
        configure('plain', '%{message}');
        const capture = jest.spyOn(LogPosition, 'capture');
        const output = captureStdout();
        try {
            const logger = LoggerFactory.getLogger('no-position');
            for (let index = 0; index < 100; index += 1) logger.info(`event-${index}`);

            expect(output.lines).toHaveLength(100);
            expect(capture).not.toHaveBeenCalled();
        } finally {
            output.restore();
        }
    });

    it('does not capture in JSON mode and preserves existing fields', () => {
        configure('json', '%{log_position}');
        const capture = jest.spyOn(LogPosition, 'capture');
        const output = captureStdout();
        try {
            LoggerFactory.getLogger('json-position').info('event', { id: 1 });

            const parsed = JSON.parse(output.lines[0]!) as Record<string, any>;
            expect(parsed).toMatchObject({ level: 'info', message: 'event', name: 'json-position', meta: [{ id: 1 }] });
            expect(parsed.timestamp).toBeDefined();
            expect(capture).not.toHaveBeenCalled();
        } finally {
            output.restore();
        }
    });

    it('does not expose internal position metadata in mixed JSON and plain transports', () => {
        writeFileSync(
            TEST_CONFIG_PATH,
            `root:
  level: info
  pattern: '%{log_position}|%{message}'
  console:
    enabled: true
    colors: false
    format: json
  file:
    enabled: true
    dirname: ${TEST_LOG_DIR}
    filename: mixed.log
    datePattern: YYYY-MM-DD
    maxFiles: 1d
`
        );
        process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
        const capture = jest.spyOn(LogPosition, 'capture').mockReturnValue('src/mixed.ts:4:5');
        const output = captureStdout();
        try {
            LoggerFactory.getLogger('mixed-position').info('mixed-event');

            const parsed = JSON.parse(output.lines[0]!) as Record<string, unknown>;
            expect(parsed).toMatchObject({ level: 'info', message: 'mixed-event', name: 'mixed-position' });
            expect(JSON.stringify(parsed)).not.toContain('src/mixed.ts:4:5');
            expect(Object.getOwnPropertySymbols(parsed)).toHaveLength(0);
            expect(capture).toHaveBeenCalledTimes(1);
        } finally {
            output.restore();
        }
    });

    it('points plain output at the business helper instead of logger infrastructure', () => {
        configure('plain', '%{log_position}|%{message}');
        const output = captureStdout();
        try {
            logFromBusinessHelper('business-event');

            const [position, message] = output.lines[0]!.split('|');
            expect(message).toBe('business-event');
            expect(position).toMatch(/^test\/LogPosition\.integration\.test\.ts:\d+:\d+$/);
            expect(position).not.toMatch(
                /src\/(?:core\/(?:LoggerFactory|LogPosition)|formatters\/PatternFormatter)|node_modules/
            );
        } finally {
            output.restore();
        }
    });
});
