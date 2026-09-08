jest.mock('@jintianxiayu/logger', () => ({
    LoggerFactory: {
        getLogger: jest.fn(() => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
    },
}));

import 'reflect-metadata';
import { DistributedLock } from '../src/decorators/distributed-lock';
import { LockProviderRegistry } from '../src/core/lock-provider-registry';
import { LockAcquisitionError } from '../src/errors/lock-acquisition-error';
import { RedisLockProvider } from '../src/core/redis-lock-provider';
import { createIoredisLockClient } from '../src/adapters/ioredis-lock-client';
import { createNodeRedisLockClient } from '../src/adapters/node-redis-lock-client';

const mockProvider = {
    acquire: jest.fn(),
    release: jest.fn(),
    renew: jest.fn(),
} as unknown as {
    acquire: jest.Mock;
    release: jest.Mock;
    renew: jest.Mock;
};

describe('@DistributedLock', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        LockProviderRegistry.clear();
        LockProviderRegistry.register('mock', mockProvider);
        LockProviderRegistry.setDefault('mock');
    });

    it('should acquire and release lock around method execution', async () => {
        mockProvider.acquire.mockResolvedValue('token-123');
        mockProvider.release.mockResolvedValue(true);

        class TestService {
            @DistributedLock({})
            async doSomething(): Promise<string> {
                return 'result';
            }
        }

        const service = new TestService();
        const result = await service.doSomething();

        expect(result).toBe('result');
        expect(mockProvider.acquire).toHaveBeenCalledWith('TestService.doSomething', 30000);
        expect(mockProvider.release).toHaveBeenCalledWith('TestService.doSomething', 'token-123');
    });

    it('should use custom key when provided', async () => {
        mockProvider.acquire.mockResolvedValue('token-123');
        mockProvider.release.mockResolvedValue(true);

        class TestService {
            @DistributedLock({ key: 'custom-lock-key' })
            async doSomething(): Promise<string> {
                return 'result';
            }
        }

        const service = new TestService();
        await service.doSomething();

        expect(mockProvider.acquire).toHaveBeenCalledWith('custom-lock-key', 30000);
    });

    it('should use function key when provided', async () => {
        mockProvider.acquire.mockResolvedValue('token-123');
        mockProvider.release.mockResolvedValue(true);

        class TestService {
            @DistributedLock({ key: (arg1: unknown) => `lock:${arg1}` })
            async doSomething(arg1: string): Promise<string> {
                return `result: ${arg1}`;
            }
        }

        const service = new TestService();
        await service.doSomething('order-123');

        expect(mockProvider.acquire).toHaveBeenCalledWith('lock:order-123', 30000);
    });

    it('should throw LockAcquisitionError when lock cannot be acquired', async () => {
        mockProvider.acquire.mockResolvedValue(null);

        class TestService {
            @DistributedLock({ retryCount: 0 })
            async doSomething(): Promise<string> {
                return 'result';
            }
        }

        const service = new TestService();

        await expect(service.doSomething()).rejects.toThrow(LockAcquisitionError);
        await expect(service.doSomething()).rejects.toThrow('Failed to acquire lock after 0 retries');
    });

    it('should throw LockAcquisitionError after retries exhausted', async () => {
        mockProvider.acquire.mockResolvedValue(null);

        class TestService {
            @DistributedLock({ retryCount: 2, retryDelay: 10 })
            async doSomething(): Promise<string> {
                return 'result';
            }
        }

        const service = new TestService();

        await expect(service.doSomething()).rejects.toThrow(LockAcquisitionError);
        expect(mockProvider.acquire).toHaveBeenCalledTimes(3);
    });

    it('should release lock even when method throws', async () => {
        mockProvider.acquire.mockResolvedValue('token-123');
        mockProvider.release.mockResolvedValue(true);

        class TestService {
            @DistributedLock({})
            async doSomething(): Promise<string> {
                throw new Error('business error');
            }
        }

        const service = new TestService();

        await expect(service.doSomething()).rejects.toThrow('business error');
        expect(mockProvider.release).toHaveBeenCalled();
    });

    it('should throw TypeError for non-async methods', () => {
        expect(() => {
            class TestService {
                @DistributedLock({})
                doSomething(): string {
                    return 'result';
                }
            }
            new TestService();
        }).toThrow(TypeError);
    });
});

describe.each([
    { name: 'ioredis', adapt: createIoredisLockClient },
    { name: 'node-redis', adapt: createNodeRedisLockClient },
])('$name 装饰器契约', ({ adapt }) => {
    const source = { set: jest.fn(), eval: jest.fn() };
    const provider = new RedisLockProvider(adapt(source));

    beforeEach(() => {
        jest.useFakeTimers();
        jest.resetAllMocks();
        source.set.mockResolvedValue('OK');
        source.eval.mockResolvedValue(1);
        LockProviderRegistry.clear();
        LockProviderRegistry.register('redis', provider);
        LockProviderRegistry.setDefault('redis');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
        LockProviderRegistry.clear();
    });

    it('redis-lock-client/D01 缺省装饰器配置保持原行为', async () => {
        const acquire = jest.spyOn(provider, 'acquire');
        const renew = jest.spyOn(provider, 'renew');
        const release = jest.spyOn(provider, 'release');
        class DefaultService {
            @DistributedLock()
            async run(): Promise<string> {
                return new Promise((resolve) => setTimeout(() => resolve('result'), 11000));
            }
        }
        const result = new DefaultService().run();
        await jest.advanceTimersByTimeAsync(9999);
        expect(acquire).toHaveBeenCalledTimes(1);
        expect(acquire).toHaveBeenCalledWith('DefaultService.run', 30000);
        expect(renew).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        const token = source.set.mock.calls[0]?.[1];
        expect(renew).toHaveBeenCalledWith('DefaultService.run', token, 30000);
        await jest.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toBe('result');
        expect(release).toHaveBeenCalledWith('DefaultService.run', token);
        expect(jest.getTimerCount()).toBe(0);
        source.set.mockResolvedValue(null);
        await expect(new DefaultService().run()).rejects.toBeInstanceOf(LockAcquisitionError);
        expect(acquire).toHaveBeenCalledTimes(2);
    });

    it.each(['recover', 'exhaust'])('redis-lock-client/D02 显式重试配置仅重试竞争：%s', async (outcome) => {
        source.set
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(outcome === 'recover' ? 'OK' : null);
        const business = jest.fn().mockResolvedValue('result');
        const acquire = jest.spyOn(provider, 'acquire');
        class RetriedService {
            @DistributedLock({ key: 'explicit', ttl: 5000, renewInterval: 5000, retryCount: 2, retryDelay: 50 })
            async run(): Promise<string> {
                return business();
            }
        }
        const result = new RetriedService().run();
        const assertion =
            outcome === 'recover'
                ? expect(result).resolves.toBe('result')
                : expect(result).rejects.toBeInstanceOf(LockAcquisitionError);
        await jest.advanceTimersByTimeAsync(49);
        expect(acquire).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(acquire).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(50);
        await assertion;
        expect(acquire).toHaveBeenCalledTimes(3);
        expect(acquire).toHaveBeenLastCalledWith('explicit', 5000);
        expect(business).toHaveBeenCalledTimes(outcome === 'recover' ? 1 : 0);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('redis-lock-client/D03 业务异常后的正常清理', async () => {
        const error = new Error('business failed');
        const release = jest.spyOn(provider, 'release');
        class FailedService {
            @DistributedLock()
            async run(): Promise<string> {
                throw error;
            }
        }
        await expect(new FailedService().run()).rejects.toBe(error);
        expect(release).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('redis-lock-client/E01 获取异常阻止业务执行', async () => {
        const error = new Error('Redis unavailable');
        source.set.mockRejectedValue(error);
        const business = jest.fn();
        class UnavailableService {
            @DistributedLock({ retryCount: 3 })
            async run(): Promise<string> {
                business();
                return 'unsafe';
            }
        }
        await expect(new UnavailableService().run()).rejects.toBe(error);
        expect(source.set).toHaveBeenCalledTimes(1);
        expect(source.eval).not.toHaveBeenCalled();
        expect(business).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });
});

it('redis-lock-client/D04 既有自定义 LockProvider 继续可用', async () => {
    jest.useFakeTimers();
    const custom = {
        acquire: jest.fn().mockResolvedValue('custom-token'),
        release: jest.fn().mockResolvedValue(true),
        renew: jest.fn().mockResolvedValue(true),
    };
    LockProviderRegistry.register('custom', custom);
    LockProviderRegistry.setDefault('custom');
    class CustomService {
        @DistributedLock({ key: 'custom', ttl: 1000, renewInterval: 100 })
        async run(): Promise<string> {
            return new Promise((resolve) => setTimeout(() => resolve('custom-result'), 150));
        }
    }
    try {
        const result = new CustomService().run();
        await jest.advanceTimersByTimeAsync(150);
        await expect(result).resolves.toBe('custom-result');
        expect(custom.acquire).toHaveBeenCalledWith('custom', 1000);
        expect(custom.renew).toHaveBeenCalledWith('custom', 'custom-token', 1000);
        expect(custom.release).toHaveBeenCalledWith('custom', 'custom-token');
        expect(jest.getTimerCount()).toBe(0);
    } finally {
        jest.useRealTimers();
        LockProviderRegistry.clear();
    }
});
