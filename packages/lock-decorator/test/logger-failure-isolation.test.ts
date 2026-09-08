import 'reflect-metadata';
import type { LoggerInterface } from '@jintianxiayu/logger';
import type { LockProvider } from '../src/core/lock-provider';

interface IsolatedRuntime {
    readonly DistributedLock: typeof import('../src/decorators/distributed-lock').DistributedLock;
    readonly LockProviderRegistry: typeof import('../src/core/lock-provider-registry').LockProviderRegistry;
}

function createProvider(): jest.Mocked<LockProvider> {
    return {
        acquire: jest.fn().mockResolvedValue('token'),
        release: jest.fn().mockResolvedValue(true),
        renew: jest.fn().mockResolvedValue(true),
    };
}

/** 重新加载完整 decorator 调用链，确保每个用例都从未获取 Logger 的状态开始。 */
function loadRuntime(getLogger: jest.Mock<LoggerInterface, [string]>): IsolatedRuntime {
    jest.resetModules();
    jest.doMock('@jintianxiayu/logger', () => ({ LoggerFactory: { getLogger } }));
    let runtime: IsolatedRuntime | undefined;
    jest.isolateModules(() => {
        runtime = {
            DistributedLock: jest.requireActual<typeof import('../src/decorators/distributed-lock')>(
                '../src/decorators/distributed-lock'
            ).DistributedLock,
            LockProviderRegistry: jest.requireActual<typeof import('../src/core/lock-provider-registry')>(
                '../src/core/lock-provider-registry'
            ).LockProviderRegistry,
        };
    });
    if (!runtime) {
        throw new Error('Distributed lock runtime was not loaded');
    }
    return runtime;
}

function suppressConsole(): jest.SpyInstance[] {
    return [
        jest.spyOn(console, 'debug').mockImplementation(),
        jest.spyOn(console, 'info').mockImplementation(),
        jest.spyOn(console, 'warn').mockImplementation(),
        jest.spyOn(console, 'error').mockImplementation(),
    ];
}

afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.dontMock('@jintianxiayu/logger');
});

it('lock-operation-logging/获取 Logger 失败', async () => {
    const loggerError = new Error('invalid logger config');
    const getLogger = jest.fn<LoggerInterface, [string]>(() => {
        throw loggerError;
    });
    const { DistributedLock, LockProviderRegistry } = loadRuntime(getLogger);
    const provider = createProvider();
    LockProviderRegistry.register('provider', provider);
    LockProviderRegistry.setDefault('provider');
    const consoleSpies = suppressConsole();
    class Service {
        @DistributedLock({ renewInterval: 30000 })
        async run(): Promise<string> {
            return 'business-result';
        }
    }

    await expect(new Service().run()).resolves.toBe('business-result');

    expect(getLogger.mock.calls.length).toBeGreaterThan(1);
    expect(provider.acquire).toHaveBeenCalledTimes(1);
    expect(provider.release).toHaveBeenCalledTimes(1);
    for (const spy of consoleSpies) {
        expect(spy).not.toHaveBeenCalled();
    }
});

it('lock-operation-logging/level 方法同步抛错', async () => {
    const logger: jest.Mocked<LoggerInterface> = {
        debug: jest.fn<void, [string, ...unknown[]]>(() => {
            throw new Error('debug failed');
        }),
        info: jest.fn(),
        warn: jest.fn<void, [string, ...unknown[]]>(() => {
            throw new Error('warn failed');
        }),
        error: jest.fn<void, [string, ...unknown[]]>(() => {
            throw new Error('error failed');
        }),
    };
    const getLogger = jest.fn<LoggerInterface, [string]>(() => logger);
    const { DistributedLock, LockProviderRegistry } = loadRuntime(getLogger);
    const provider = createProvider();
    LockProviderRegistry.register('provider', provider);
    LockProviderRegistry.setDefault('provider');
    const consoleSpies = suppressConsole();
    class Service {
        @DistributedLock({ renewInterval: 30000 })
        async run(): Promise<string> {
            return 'business-result';
        }
    }

    await expect(new Service().run()).resolves.toBe('business-result');
    provider.acquire.mockResolvedValueOnce(null);
    await expect(new Service().run()).rejects.toBeInstanceOf(Error);
    const providerError = new Error('provider failed');
    provider.acquire.mockRejectedValueOnce(providerError);
    await expect(new Service().run()).rejects.toBe(providerError);

    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(provider.release).toHaveBeenCalledTimes(1);
    for (const spy of consoleSpies) {
        expect(spy).not.toHaveBeenCalled();
    }
});

it('lock-operation-logging/Logger 已关闭', async () => {
    const logger: jest.Mocked<LoggerInterface> = {
        debug: jest.fn<void, [string, ...unknown[]]>(() => {
            throw new Error('Logger is closed');
        }),
        info: jest.fn(),
        warn: jest.fn<void, [string, ...unknown[]]>(() => {
            throw new Error('Logger is closed');
        }),
        error: jest.fn<void, [string, ...unknown[]]>(() => {
            throw new Error('Logger is closed');
        }),
    };
    const getLogger = jest.fn<LoggerInterface, [string]>(() => logger);
    const { DistributedLock, LockProviderRegistry } = loadRuntime(getLogger);
    const provider = createProvider();
    LockProviderRegistry.register('provider', provider);
    LockProviderRegistry.setDefault('provider');
    class Service {
        @DistributedLock({ renewInterval: 30000 })
        async run(): Promise<string> {
            return 'still-runs';
        }
    }

    await expect(new Service().run()).resolves.toBe('still-runs');

    expect(provider.acquire).toHaveBeenCalledTimes(1);
    expect(provider.release).toHaveBeenCalledTimes(1);
});
