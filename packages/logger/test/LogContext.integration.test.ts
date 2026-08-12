import { existsSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import type winston from 'winston';
import { LOG_CONTEXT_SYMBOL, type LogContextMetadata } from '../src/core/LogContextMetadata';
import { LoggerContext } from '../src/core/LoggerContext';
import { LoggerFactory } from '../src/core/LoggerFactory';

const TEST_CONFIG_PATH = path.join(__dirname, 'test-log-context-config.yaml');
const TEST_LOG_DIR = path.join(__dirname, 'test-log-context-output');

interface LoggerFactoryInternals {
    container: winston.Container | null;
}

function factoryInternals(): LoggerFactoryInternals {
    return LoggerFactory as unknown as LoggerFactoryInternals;
}

function configure(format: 'plain' | 'json', pattern: string, fileEnabled = false): void {
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
    enabled: ${fileEnabled}
    dirname: ${TEST_LOG_DIR}
    filename: context.log
    datePattern: YYYY-MM-DD
    maxFiles: 1d
`
    );
    process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
}

function captureMetadata(name: string, log: () => void): LogContextMetadata & { meta: unknown[] } {
    const internalLogger = factoryInternals().container?.get(name);
    if (!internalLogger) throw new Error(`Missing internal logger: ${name}`);

    let captured: (LogContextMetadata & { meta: unknown[] }) | undefined;
    jest.spyOn(internalLogger, 'info').mockImplementation(((_message: string, metadata: typeof captured) => {
        captured = metadata;
        return internalLogger;
    }) as typeof internalLogger.info);
    log();
    if (!captured) throw new Error('Logger wrapper did not submit metadata');
    return captured;
}

function transform(
    transport: winston.transport,
    metadata: LogContextMetadata & { meta: unknown[] },
    message: string
): winston.Logform.TransformableInfo {
    if (!transport.format) throw new Error('Transport has no formatter');
    const info = {
        level: 'info',
        message,
        name: 'context-integration',
        ...metadata,
        [Symbol.for('level')]: 'info',
    } as unknown as winston.Logform.TransformableInfo;
    return transport.format.transform(info, transport.format.options) as winston.Logform.TransformableInfo;
}

describe('LoggerFactory context isolation integration', () => {
    beforeEach(() => {
        LoggerFactory.reset();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await LoggerFactory.shutdown();
        await new Promise<void>((resolve) => setImmediate(resolve));
        LoggerContext.clear();
        delete process.env.LOGGER_CONFIG_PATH;
        if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH);
        if (existsSync(TEST_LOG_DIR)) rmSync(TEST_LOG_DIR, { recursive: true });
    });

    it('captures one traceId at the plain logger call boundary and reuses it for repeated placeholders', () => {
        configure('plain', '%{traceId}|%{message}|%{traceId}');
        const logger = LoggerFactory.getLogger('context-integration');
        const get = jest.spyOn(LoggerContext, 'get');
        const metadata = captureMetadata('context-integration', () => {
            LoggerContext.withContext({ traceId: 'call-trace' }, () => logger.info('event'));
        });

        expect(get).toHaveBeenCalledTimes(1);
        expect(metadata[LOG_CONTEXT_SYMBOL]).toEqual({ captured: true, traceId: 'call-trace' });

        const internalLogger = factoryInternals().container!.get('context-integration');
        const output = LoggerContext.withContext({ traceId: 'formatter-trace' }, () =>
            transform(internalLogger.transports[0]!, metadata, 'event')
        );
        expect(output[Symbol.for('message')]).toBe('call-trace|event|call-trace');
    });

    it('preserves a missing call-time traceId during delayed plain formatting', () => {
        configure('plain', '%{traceId}|%{message}');
        const logger = LoggerFactory.getLogger('context-integration');
        const metadata = captureMetadata('context-integration', () => logger.info('event'));
        expect(metadata[LOG_CONTEXT_SYMBOL]).toEqual({ captured: true });

        const internalLogger = factoryInternals().container!.get('context-integration');
        const output = LoggerContext.withContext({ traceId: 'later-trace' }, () =>
            transform(internalLogger.transports[0]!, metadata, 'event')
        );
        expect(output[Symbol.for('message')]).toBe('-|event');
    });

    it('does not cache context when a logger is reused across scopes', () => {
        configure('plain', '%{traceId}|%{message}');
        const logger = LoggerFactory.getLogger('context-integration');
        const internalLogger = factoryInternals().container!.get('context-integration');

        const first = captureMetadata('context-integration', () => {
            LoggerContext.withContext({ traceId: 'trace-a' }, () => logger.info('event-a'));
        });
        jest.restoreAllMocks();
        const second = captureMetadata('context-integration', () => {
            LoggerContext.withContext({ traceId: 'trace-b' }, () => logger.info('event-b'));
        });

        expect(transform(internalLogger.transports[0]!, first, 'event-a')[Symbol.for('message')]).toBe(
            'trace-a|event-a'
        );
        expect(transform(internalLogger.transports[0]!, second, 'event-b')[Symbol.for('message')]).toBe(
            'trace-b|event-b'
        );
    });

    it('emits or omits the JSON traceId from the call-time context without exposing metadata', () => {
        configure('json', '%{message}');
        const logger = LoggerFactory.getLogger('context-integration');
        const internalLogger = factoryInternals().container!.get('context-integration');

        const present = captureMetadata('context-integration', () => {
            LoggerContext.withContext({ traceId: 'json-trace' }, () => logger.info('present'));
        });
        jest.restoreAllMocks();
        const missing = captureMetadata('context-integration', () => logger.info('missing'));

        const presentOutput = transform(internalLogger.transports[0]!, present, 'present');
        const missingOutput = LoggerContext.withContext({ traceId: 'later-trace' }, () =>
            transform(internalLogger.transports[0]!, missing, 'missing')
        );
        const presentJson = JSON.parse(String(presentOutput[Symbol.for('message')])) as Record<string, unknown>;
        const missingJson = JSON.parse(String(missingOutput[Symbol.for('message')])) as Record<string, unknown>;

        expect(presentJson.traceId).toBe('json-trace');
        expect(missingJson.traceId).toBeUndefined();
        expect(JSON.stringify(presentJson)).not.toContain('@jintianxiayu/logger/log-context');
        expect(JSON.stringify(missingJson)).not.toContain('@jintianxiayu/logger/log-context');
    });

    it('reuses one captured traceId across mixed JSON and plain transports', () => {
        configure('json', '%{traceId}|%{message}', true);
        const logger = LoggerFactory.getLogger('context-integration');
        const get = jest.spyOn(LoggerContext, 'get');
        const metadata = captureMetadata('context-integration', () => {
            LoggerContext.withContext({ traceId: 'mixed-trace' }, () => logger.info('mixed-event'));
        });
        expect(get).toHaveBeenCalledTimes(1);

        const internalLogger = factoryInternals().container!.get('context-integration');
        expect(internalLogger.transports).toHaveLength(2);
        const jsonOutput = transform(internalLogger.transports[0]!, metadata, 'mixed-event');
        const plainOutput = LoggerContext.withContext({ traceId: 'later-trace' }, () =>
            transform(internalLogger.transports[1]!, metadata, 'mixed-event')
        );
        const parsed = JSON.parse(String(jsonOutput[Symbol.for('message')])) as Record<string, unknown>;

        expect(parsed.traceId).toBe('mixed-trace');
        expect(JSON.stringify(parsed)).not.toContain('@jintianxiayu/logger/log-context');
        expect(plainOutput[Symbol.for('message')]).toBe('mixed-trace|mixed-event');
    });

    it('does not read context when no enabled output needs traceId', () => {
        configure('plain', '%{message}');
        const logger = LoggerFactory.getLogger('context-integration');
        const get = jest.spyOn(LoggerContext, 'get');
        captureMetadata('context-integration', () => logger.info('event'));
        expect(get).not.toHaveBeenCalled();
    });
});
