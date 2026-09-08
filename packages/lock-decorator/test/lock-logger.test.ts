import 'reflect-metadata';
import type { LoggerInterface } from '@jintianxiayu/logger';

type LockLoggerModule = typeof import('../src/core/lock-logger');

interface LockLoggerHarness {
    readonly lockLogger: LockLoggerModule;
    readonly getLogger: jest.Mock<LoggerInterface, [string]>;
    readonly logger: jest.Mocked<LoggerInterface>;
}

const logDefinitions = [
    ['lock.acquire_started', 'debug', 'Distributed lock acquisition started'],
    ['lock.acquire_retry', 'debug', 'Distributed lock acquisition retry scheduled'],
    ['lock.acquired', 'debug', 'Distributed lock acquired'],
    ['lock.watchdog_started', 'debug', 'Distributed lock watchdog started'],
    ['lock.watchdog_skipped', 'debug', 'Distributed lock watchdog skipped'],
    ['lock.renewed', 'debug', 'Distributed lock renewed'],
    ['lock.execution_started', 'debug', 'Distributed lock execution started'],
    ['lock.execution_completed', 'debug', 'Distributed lock execution completed'],
    ['lock.release_started', 'debug', 'Distributed lock release started'],
    ['lock.released', 'debug', 'Distributed lock released'],
    ['lock.acquire_exhausted', 'warn', 'Distributed lock acquisition exhausted'],
    ['lock.ownership_lost', 'warn', 'Distributed lock ownership lost'],
    ['lock.operation_failed', 'error', 'Distributed lock operation failed'],
] as const;

function createMockLogger(): jest.Mocked<LoggerInterface> {
    return {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
}

/** 为每个用例隔离模块级 Logger 缓存，并注入可控的应用 Logger。 */
function loadLockLogger(getLoggerImplementation?: (name: string) => LoggerInterface): LockLoggerHarness {
    jest.resetModules();
    const logger = createMockLogger();
    const getLogger = jest.fn<LoggerInterface, [string]>(getLoggerImplementation ?? (() => logger));
    jest.doMock('@jintianxiayu/logger', () => ({ LoggerFactory: { getLogger } }));
    let lockLogger: LockLoggerModule | undefined;
    jest.isolateModules(() => {
        lockLogger = jest.requireActual<LockLoggerModule>('../src/core/lock-logger');
    });
    if (!lockLogger) {
        throw new Error('Lock logger module was not loaded');
    }
    return { lockLogger, getLogger, logger };
}

afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.dontMock('@jintianxiayu/logger');
});

it('lock-operation-logging/L01 导入包和定义装饰器类不获取 Logger', () => {
    const { getLogger } = loadLockLogger();

    jest.isolateModules(() => {
        const { DistributedLock } = jest.requireActual<typeof import('../src')>('../src');
        DistributedLock();
        class Service {
            @DistributedLock()
            async run(): Promise<string> {
                return 'unused';
            }
        }
        expect(Service).toBeDefined();
    });

    expect(getLogger).not.toHaveBeenCalled();
});

it('lock-operation-logging/L02 首次运行期事件获取并复用命名 Logger', () => {
    const { lockLogger, getLogger, logger } = loadLockLogger();

    lockLogger.logLockEvent('lock.acquire_started');
    lockLogger.logLockEvent('lock.acquired');

    expect(getLogger).toHaveBeenCalledTimes(1);
    expect(getLogger).toHaveBeenCalledWith('@jintianxiayu/lock-decorator');
    expect(logger.debug).toHaveBeenCalledTimes(2);
});

it.each(logDefinitions)('lock-operation-logging/L03 %s 使用固定 %s 和 message', (event, level, message) => {
    const { lockLogger, logger } = loadLockLogger();

    lockLogger.logLockEvent(event, { className: 'Service', methodName: 'run' });

    expect(logger[level]).toHaveBeenCalledWith(message, {
        className: 'Service',
        methodName: 'run',
        event,
    });
    expect(logger.info).not.toHaveBeenCalled();
});

it('lock-operation-logging/L04 metadata 仅保留白名单且调用点不能覆盖 event', () => {
    const { lockLogger, logger } = loadLockLogger();
    const unsafeContext = {
        className: 'Service',
        event: 'lock.operation_failed',
        key: 'secret-lock-key',
        token: 'secret-token',
        traceId: 'caller-trace',
    } as unknown as Parameters<typeof lockLogger.logLockEvent>[1];

    lockLogger.logLockEvent('lock.acquired', unsafeContext);

    expect(logger.debug).toHaveBeenCalledWith('Distributed lock acquired', {
        className: 'Service',
        event: 'lock.acquired',
    });
});

it('lock-operation-logging/L05 获取失败不缓存，后续事件仍可重试', () => {
    const logger = createMockLogger();
    const getLogger = jest
        .fn<LoggerInterface, [string]>()
        .mockImplementationOnce(() => {
            throw new Error('invalid logger config');
        })
        .mockReturnValue(logger);
    const harness = loadLockLogger(getLogger);

    expect(() => harness.lockLogger.logLockEvent('lock.acquire_started')).not.toThrow();
    expect(() => harness.lockLogger.logLockEvent('lock.acquire_started')).not.toThrow();

    expect(getLogger).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledTimes(1);
});

it.each(['debug', 'warn', 'error'] as const)(
    'lock-operation-logging/L06 Logger %s 同步失败被隔离且不使用 console 兜底',
    (level) => {
        const { lockLogger, logger } = loadLockLogger();
        logger[level].mockImplementation(() => {
            throw new Error('logger closed');
        });
        const consoleSpies = [
            jest.spyOn(console, 'debug').mockImplementation(),
            jest.spyOn(console, 'info').mockImplementation(),
            jest.spyOn(console, 'warn').mockImplementation(),
            jest.spyOn(console, 'error').mockImplementation(),
        ];
        const event =
            level === 'debug' ? 'lock.acquired' : level === 'warn' ? 'lock.ownership_lost' : 'lock.operation_failed';

        expect(() => lockLogger.logLockEvent(event)).not.toThrow();

        for (const spy of consoleSpies) {
            expect(spy).not.toHaveBeenCalled();
        }
    }
);
