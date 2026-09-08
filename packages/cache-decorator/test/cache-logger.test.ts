import type { LoggerInterface } from '@jintianxiayu/logger';

type CacheLoggerModule = typeof import('../src/core/cache-logger');

interface CacheLoggerHarness {
    readonly cacheLogger: CacheLoggerModule;
    readonly getLogger: jest.Mock<LoggerInterface, [string]>;
    readonly logger: jest.Mocked<LoggerInterface>;
}

const logContext = {
    cacheName: 'users',
    methodName: 'findUser',
    providerName: 'default',
} as const;

function createMockLogger(): jest.Mocked<LoggerInterface> {
    return {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
}

/**
 * 为每个用例重新加载 cache Logger 模块，隔离模块级 Logger 缓存并允许注入获取失败。
 * @param getLoggerImplementation 可选的 LoggerFactory.getLogger 替代实现。
 * @returns 独立模块、Logger 获取 mock 和四个 level 方法 mock。
 * @throws 隔离模块未能同步加载时抛出。
 */
function loadCacheLogger(getLoggerImplementation?: (name: string) => LoggerInterface): CacheLoggerHarness {
    jest.resetModules();
    const logger = createMockLogger();
    const getLogger = jest.fn<LoggerInterface, [string]>(getLoggerImplementation ?? (() => logger));
    jest.doMock('@jintianxiayu/logger', () => ({ LoggerFactory: { getLogger } }));
    let cacheLogger: CacheLoggerModule | undefined;
    jest.isolateModules(() => {
        cacheLogger = jest.requireActual<CacheLoggerModule>('../src/core/cache-logger');
    });
    if (!cacheLogger) {
        throw new Error('Cache logger module was not loaded');
    }
    return { cacheLogger, getLogger, logger };
}

afterEach(() => {
    jest.resetModules();
    jest.dontMock('@jintianxiayu/logger');
});

it('cache-operation-logging/L01 导入和 decorator 求值不初始化 Logger', () => {
    const { getLogger } = loadCacheLogger();
    const { Cache } = jest.requireActual<typeof import('../src/decorators/cache')>('../src/decorators/cache');
    const { CacheEvict } = jest.requireActual<typeof import('../src/decorators/cache-evict')>(
        '../src/decorators/cache-evict'
    );

    Cache('users');
    CacheEvict('users');

    expect(getLogger).not.toHaveBeenCalled();
});

it('cache-operation-logging/L02 首次运行期事件获取并复用应用命名 Logger', () => {
    const { cacheLogger, getLogger, logger } = loadCacheLogger();

    cacheLogger.logCacheEvent('cache.miss', logContext);
    cacheLogger.logCacheEvent('cache.hit', { ...logContext, entryType: 'value' });

    expect(getLogger).toHaveBeenCalledTimes(1);
    expect(getLogger).toHaveBeenCalledWith('@jintianxiayu/cache-decorator');
    expect(logger.debug).toHaveBeenCalledTimes(2);
});

it('cache-operation-logging/正常缓存决策使用 debug', () => {
    const { cacheLogger, logger } = loadCacheLogger();
    const events = [
        'cache.pending_hit',
        'cache.hit',
        'cache.miss',
        'cache.write_dispatched',
        'cache.evict_dispatched',
        'cache.evict_completed',
    ] as const;

    for (const event of events) {
        cacheLogger.logCacheEvent(event, logContext);
    }

    expect(logger.debug).toHaveBeenCalledTimes(events.length);
    expect(logger.debug.mock.calls.map((call) => (call[1] as { event: string }).event)).toEqual(events);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
});

it('cache-operation-logging/可恢复回退与淘汰跳过使用 warn', () => {
    const { cacheLogger, logger } = loadCacheLogger();

    cacheLogger.logCacheEvent('cache.key_fallback', { ...logContext, reason: 'resolver_error' });
    cacheLogger.logCacheEvent('cache.evict_skipped', { ...logContext, reason: 'business_error' });

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls.map((call) => (call[1] as { event: string }).event)).toEqual([
        'cache.key_fallback',
        'cache.evict_skipped',
    ]);
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
});

it('cache-operation-logging/缓存基础设施失败使用 error', () => {
    const { cacheLogger, logger } = loadCacheLogger();
    const providerError = new Error('redis unavailable');

    cacheLogger.logCacheEvent('cache.operation_failed', {
        ...logContext,
        operation: 'read',
        error: providerError,
    });

    expect(logger.error).toHaveBeenCalledWith(
        'Cache operation failed',
        expect.objectContaining({ event: 'cache.operation_failed', operation: 'read', error: providerError })
    );
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
});

it('Logger 获取或写入同步失败时不向缓存调用方抛出', () => {
    const getLoggerError = new Error('invalid logger config');
    const failedGet = loadCacheLogger(() => {
        throw getLoggerError;
    });
    expect(() => failedGet.cacheLogger.logCacheEvent('cache.miss', logContext)).not.toThrow();

    const failedWrite = loadCacheLogger();
    failedWrite.logger.debug.mockImplementationOnce(() => {
        throw new Error('transport failed');
    });
    expect(() => failedWrite.cacheLogger.logCacheEvent('cache.miss', logContext)).not.toThrow();
});

it('Provider 日志标签将缺省和空名称稳定映射为 default', () => {
    const { cacheLogger } = loadCacheLogger();

    expect(cacheLogger.cacheProviderLabel(undefined)).toBe('default');
    expect(cacheLogger.cacheProviderLabel('')).toBe('default');
    expect(cacheLogger.cacheProviderLabel('redis-primary')).toBe('redis-primary');
});
