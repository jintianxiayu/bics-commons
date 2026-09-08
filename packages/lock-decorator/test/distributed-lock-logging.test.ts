jest.mock('@jintianxiayu/logger', () => ({
    LoggerFactory: { getLogger: jest.fn() },
}));

import 'reflect-metadata';
import { LoggerFactory, type LoggerInterface } from '@jintianxiayu/logger';
import { DistributedLock } from '../src/decorators/distributed-lock';
import { LockProviderRegistry } from '../src/core/lock-provider-registry';
import type { LockProvider } from '../src/core/lock-provider';
import { Watchdog } from '../src/core/watchdog';
import { LockAcquisitionError } from '../src/errors/lock-acquisition-error';

interface CapturedLog {
    readonly order: number;
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly message: string;
    readonly metadata: Record<string, unknown>;
}

const logger: jest.Mocked<LoggerInterface> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
const getLogger = jest.mocked(LoggerFactory.getLogger);

function createProvider(): jest.Mocked<LockProvider> {
    return {
        acquire: jest.fn().mockResolvedValue('token-123'),
        release: jest.fn().mockResolvedValue(true),
        renew: jest.fn().mockResolvedValue(true),
    };
}

function registerProvider(provider: LockProvider): void {
    LockProviderRegistry.register('logging-provider', provider);
    LockProviderRegistry.setDefault('logging-provider');
}

function capturedLogs(): CapturedLog[] {
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    const logs: CapturedLog[] = [];
    for (const level of levels) {
        logger[level].mock.calls.forEach((call, index) => {
            logs.push({
                order: logger[level].mock.invocationCallOrder[index] ?? Number.MAX_SAFE_INTEGER,
                level,
                message: call[0],
                metadata: (call[1] ?? {}) as Record<string, unknown>,
            });
        });
    }
    return logs.sort((left, right) => left.order - right.order);
}

function capturedEvents(): string[] {
    return capturedLogs().map((log) => String(log.metadata.event));
}

beforeEach(() => {
    LockProviderRegistry.clear();
    getLogger.mockReturnValue(logger);
    logger.debug.mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    LockProviderRegistry.clear();
});

describe('@DistributedLock acquisition logging', () => {
    it('lock-operation-logging/首次获取成功', async () => {
        const provider = createProvider();
        registerProvider(provider);
        class Service {
            @DistributedLock({ renewInterval: 30000 })
            async run(): Promise<{ readonly status: string }> {
                return { status: 'ok' };
            }
        }

        const result = await new Service().run();

        expect(result).toEqual({ status: 'ok' });
        expect(capturedEvents()).toEqual([
            'lock.acquire_started',
            'lock.acquired',
            'lock.watchdog_skipped',
            'lock.execution_started',
            'lock.execution_completed',
            'lock.release_started',
            'lock.released',
        ]);
        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(capturedLogs().find((log) => log.metadata.event === 'lock.acquired')?.metadata).toEqual(
            expect.objectContaining({
                className: 'Service',
                methodName: 'run',
                attempt: 1,
                maxAttempts: 1,
                ttlMs: 30000,
                durationMs: expect.any(Number),
            })
        );
        const duration = capturedLogs().find((log) => log.metadata.event === 'lock.acquired')?.metadata.durationMs;
        expect(Number.isFinite(duration)).toBe(true);
        expect(Number(duration)).toBeGreaterThanOrEqual(0);
    });

    it('lock-operation-logging/竞争后重试成功', async () => {
        jest.useFakeTimers();
        const provider = createProvider();
        provider.acquire.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue('token-123');
        registerProvider(provider);
        class Service {
            @DistributedLock({ retryCount: 2, retryDelay: 50, renewInterval: 30000 })
            async run(): Promise<string> {
                return 'ok';
            }
        }

        const result = new Service().run();
        await jest.advanceTimersByTimeAsync(100);

        await expect(result).resolves.toBe('ok');
        const retries = capturedLogs().filter((log) => log.metadata.event === 'lock.acquire_retry');
        expect(retries.map((log) => log.metadata.attempt)).toEqual([1, 2]);
        expect(retries.every((log) => Number.isFinite(log.metadata.durationMs))).toBe(true);
        expect(capturedLogs().find((log) => log.metadata.event === 'lock.acquired')?.metadata.attempt).toBe(3);
        expect(provider.acquire).toHaveBeenCalledTimes(3);
    });

    it('lock-operation-logging/重试耗尽', async () => {
        jest.useFakeTimers();
        const provider = createProvider();
        provider.acquire.mockResolvedValue(null);
        registerProvider(provider);
        const business = jest.fn();
        class Service {
            @DistributedLock({ key: 'private-key', retryCount: 2, retryDelay: 10, renewInterval: 30000 })
            async run(): Promise<string> {
                business();
                return 'unsafe';
            }
        }

        const result = new Service().run();
        const rejection = expect(result).rejects.toEqual(
            expect.objectContaining({
                name: 'LockAcquisitionError',
                key: 'private-key',
                retryCount: 2,
            })
        );
        await jest.advanceTimersByTimeAsync(20);

        await rejection;
        expect(capturedEvents()).toEqual([
            'lock.acquire_started',
            'lock.acquire_retry',
            'lock.acquire_retry',
            'lock.acquire_exhausted',
        ]);
        expect(provider.acquire).toHaveBeenCalledTimes(3);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(business).not.toHaveBeenCalled();
        expect(provider.release).not.toHaveBeenCalled();
    });

    it('lock-operation-logging/Redis 不可用或连接超时', async () => {
        const provider = createProvider();
        const acquireError = new Error('redis unavailable');
        provider.acquire.mockRejectedValue(acquireError);
        registerProvider(provider);
        const business = jest.fn();
        class Service {
            @DistributedLock({ retryCount: 3 })
            async run(): Promise<string> {
                business();
                return 'unsafe';
            }
        }

        await expect(new Service().run()).rejects.toBe(acquireError);

        expect(provider.acquire).toHaveBeenCalledTimes(1);
        expect(provider.release).not.toHaveBeenCalled();
        expect(business).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
            'Distributed lock operation failed',
            expect.objectContaining({ event: 'lock.operation_failed', operation: 'acquire', error: acquireError })
        );
    });

    it('lock-operation-logging/默认 Provider 不存在', async () => {
        const resolver = jest.fn();
        class Service {
            @DistributedLock({ key: resolver })
            async run(): Promise<string> {
                return 'unsafe';
            }
        }

        const result = new Service().run();
        const providerError = await result.catch((error: unknown) => error);

        expect(providerError).toBeInstanceOf(Error);
        expect(logger.error).toHaveBeenCalledWith(
            'Distributed lock operation failed',
            expect.objectContaining({
                event: 'lock.operation_failed',
                operation: 'provider_resolution',
                error: providerError,
            })
        );
        expect(resolver).not.toHaveBeenCalled();
    });

    it('lock-operation-logging/动态 key resolver 抛错', async () => {
        const provider = createProvider();
        registerProvider(provider);
        const resolverError = new Error('resolver-sensitive-value');
        class Service {
            @DistributedLock({
                key: () => {
                    throw resolverError;
                },
            })
            async run(): Promise<string> {
                return 'unsafe';
            }
        }

        await expect(new Service().run()).rejects.toBe(resolverError);

        expect(provider.acquire).not.toHaveBeenCalled();
        expect(provider.release).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith('Distributed lock operation failed', {
            className: 'Service',
            methodName: 'run',
            operation: 'key_resolution',
            reason: 'resolver_error',
            event: 'lock.operation_failed',
        });
    });

    it('lock-operation-logging/使用缺省续期配置', async () => {
        const provider = createProvider();
        registerProvider(provider);
        class Service {
            @DistributedLock()
            async run(): Promise<string> {
                return 'ok';
            }
        }

        await expect(new Service().run()).resolves.toBe('ok');

        expect(logger.debug).toHaveBeenCalledWith('Distributed lock watchdog started', {
            className: 'Service',
            methodName: 'run',
            ttlMs: 30000,
            renewIntervalMs: 10000,
            event: 'lock.watchdog_started',
        });
        expect(provider.renew).not.toHaveBeenCalled();
        expect(provider.release).toHaveBeenCalledTimes(1);
    });

    it('lock-operation-logging/显式禁用 Watchdog', async () => {
        const provider = createProvider();
        registerProvider(provider);
        class Service {
            @DistributedLock({ ttl: 1000, renewInterval: 1000 })
            async run(): Promise<string> {
                return 'ok';
            }
        }

        await expect(new Service().run()).resolves.toBe('ok');

        expect(logger.debug).toHaveBeenCalledWith('Distributed lock watchdog skipped', {
            className: 'Service',
            methodName: 'run',
            ttlMs: 1000,
            renewIntervalMs: 1000,
            reason: 'watchdog_disabled',
            event: 'lock.watchdog_skipped',
        });
        expect(provider.renew).not.toHaveBeenCalled();
        expect(provider.release).toHaveBeenCalledTimes(1);
    });
});

describe('@DistributedLock execution and compatibility logging', () => {
    it('lock-operation-logging/业务成功且释放成功', async () => {
        const provider = createProvider();
        const stop = jest.spyOn(Watchdog.prototype, 'stop');
        provider.release.mockImplementation(async () => {
            expect(stop).toHaveBeenCalledTimes(1);
            return true;
        });
        registerProvider(provider);
        const returned = { id: 42 };
        class Service {
            @DistributedLock()
            async run(): Promise<{ readonly id: number }> {
                return returned;
            }
        }

        await expect(new Service().run()).resolves.toBe(returned);

        expect(capturedEvents().slice(-4)).toEqual([
            'lock.execution_started',
            'lock.execution_completed',
            'lock.release_started',
            'lock.released',
        ]);
        expect(capturedLogs().find((log) => log.metadata.event === 'lock.execution_completed')?.metadata.outcome).toBe(
            'success'
        );
        expect(provider.release).toHaveBeenCalledTimes(1);
    });

    it('lock-operation-logging/业务异常且释放成功', async () => {
        const provider = createProvider();
        registerProvider(provider);
        const businessError = new Error('business-sensitive-value');
        class Service {
            @DistributedLock({ renewInterval: 30000 })
            async run(): Promise<string> {
                throw businessError;
            }
        }

        await expect(new Service().run()).rejects.toBe(businessError);

        expect(provider.release).toHaveBeenCalledTimes(1);
        expect(capturedLogs().find((log) => log.metadata.event === 'lock.execution_completed')?.metadata).toEqual(
            expect.objectContaining({ outcome: 'business_error' })
        );
        expect(
            capturedLogs().find((log) => log.metadata.event === 'lock.execution_completed')?.metadata.error
        ).toBeUndefined();
    });

    it('lock-operation-logging/释放返回 false', async () => {
        const provider = createProvider();
        provider.release.mockResolvedValue(false);
        registerProvider(provider);
        class Service {
            @DistributedLock({ renewInterval: 30000 })
            async run(): Promise<string> {
                return 'ok';
            }
        }

        await expect(new Service().run()).resolves.toBe('ok');

        expect(provider.release).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith('Distributed lock ownership lost', {
            className: 'Service',
            methodName: 'run',
            phase: 'release',
            event: 'lock.ownership_lost',
        });
    });

    it('lock-operation-logging/释放命令异常', async () => {
        const provider = createProvider();
        const releaseError = new Error('release failed');
        provider.release.mockRejectedValue(releaseError);
        registerProvider(provider);
        class Service {
            @DistributedLock({ renewInterval: 30000 })
            async run(): Promise<string> {
                return 'business-result';
            }
        }

        await expect(new Service().run()).rejects.toBe(releaseError);

        expect(provider.release).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
            'Distributed lock operation failed',
            expect.objectContaining({ event: 'lock.operation_failed', operation: 'release', error: releaseError })
        );
    });

    it('lock-operation-logging/业务与释放同时异常', async () => {
        const provider = createProvider();
        const businessError = new Error('business failed');
        const releaseError = new Error('release failed');
        provider.release.mockRejectedValue(releaseError);
        registerProvider(provider);
        class Service {
            @DistributedLock({ renewInterval: 30000 })
            async run(): Promise<string> {
                throw businessError;
            }
        }

        await expect(new Service().run()).rejects.toBe(releaseError);

        expect(capturedLogs().find((log) => log.metadata.event === 'lock.execution_completed')?.metadata.outcome).toBe(
            'business_error'
        );
        expect(capturedLogs().find((log) => log.metadata.operation === 'release')?.metadata.error).toBe(releaseError);
    });

    it('lock-operation-logging/同一 key 并发或重复获取', async () => {
        const provider = createProvider();
        provider.acquire.mockResolvedValueOnce('holder-token').mockResolvedValueOnce(null);
        registerProvider(provider);
        let finishHolder: (() => void) | undefined;
        const holderGate = new Promise<void>((resolve) => {
            finishHolder = resolve;
        });
        class Service {
            @DistributedLock({ key: 'shared', renewInterval: 30000 })
            async run(value: string): Promise<string> {
                if (value === 'holder') {
                    await holderGate;
                }
                return value;
            }
        }
        const service = new Service();

        const holder = service.run('holder');
        await expect(service.run('contender')).rejects.toBeInstanceOf(LockAcquisitionError);
        finishHolder?.();
        await expect(holder).resolves.toBe('holder');

        expect(provider.acquire).toHaveBeenCalledTimes(2);
        expect(provider.release).toHaveBeenCalledTimes(1);
    });

    it('lock-operation-logging/使用自定义 LockProvider', async () => {
        const provider = createProvider();
        provider.acquire.mockResolvedValue('custom-token');
        registerProvider(provider);
        class Service {
            @DistributedLock({ key: 'custom', renewInterval: 30000 })
            async run(): Promise<string> {
                return 'custom-result';
            }
        }

        await expect(new Service().run()).resolves.toBe('custom-result');

        expect(provider.acquire).toHaveBeenCalledWith('custom', 30000);
        expect(provider.release).toHaveBeenCalledWith('custom', 'custom-token');
        expect(capturedEvents()).toContain('lock.acquired');
    });

    it('lock-operation-logging/直接调用底层 Provider', async () => {
        const provider = createProvider();

        await expect(provider.acquire('direct-key', 5000)).resolves.toBe('token-123');

        expect(capturedLogs()).toEqual([]);
    });

    it('lock-operation-logging/动态 key 和业务数据包含敏感信息', async () => {
        const provider = createProvider();
        provider.acquire.mockResolvedValue('secret-token');
        registerProvider(provider);
        const businessError = new Error('secret-business-error');
        class Service {
            @DistributedLock({ key: (email: unknown) => `tenant:${String(email)}`, renewInterval: 30000 })
            async run(_email: string, _password: string): Promise<string> {
                throw businessError;
            }
        }

        await expect(new Service().run('person@example.com', 'secret-password')).rejects.toBe(businessError);
        class ReturnService {
            @DistributedLock({ key: 'secret-return-key', renewInterval: 30000 })
            async run(): Promise<string> {
                return 'secret-return-value';
            }
        }
        await expect(new ReturnService().run()).resolves.toBe('secret-return-value');

        const output = JSON.stringify(capturedLogs());
        expect(output).not.toContain('tenant:person@example.com');
        expect(output).not.toContain('person@example.com');
        expect(output).not.toContain('secret-password');
        expect(output).not.toContain('secret-token');
        expect(output).not.toContain('secret-return-key');
        expect(output).not.toContain('secret-business-error');
        expect(output).not.toContain('secret-return-value');
    });

    it('lock-operation-logging/非法或极值选项', async () => {
        const provider = createProvider();
        registerProvider(provider);
        class NonFiniteService {
            @DistributedLock({ ttl: Number.NaN, renewInterval: Number.NaN, retryCount: 0, retryDelay: -1 })
            async run(): Promise<string> {
                return 'non-finite';
            }
        }

        await expect(new NonFiniteService().run()).resolves.toBe('non-finite');
        expect(provider.acquire).toHaveBeenLastCalledWith('NonFiniteService.run', Number.NaN);

        class ZeroService {
            @DistributedLock({ ttl: 0, renewInterval: 0, retryCount: 0, retryDelay: 0 })
            async run(): Promise<string> {
                return 'zero';
            }
        }

        await expect(new ZeroService().run()).resolves.toBe('zero');
        expect(provider.acquire).toHaveBeenLastCalledWith('ZeroService.run', 0);

        class NegativeService {
            @DistributedLock({ ttl: -100, renewInterval: -100, retryCount: 0, retryDelay: -100 })
            async run(): Promise<string> {
                return 'negative';
            }
        }

        await expect(new NegativeService().run()).resolves.toBe('negative');
        expect(provider.acquire).toHaveBeenLastCalledWith('NegativeService.run', -100);

        const extreme = Number.MAX_SAFE_INTEGER;
        class ExtremeService {
            @DistributedLock({ ttl: extreme, renewInterval: extreme, retryCount: extreme, retryDelay: Infinity })
            async run(): Promise<string> {
                return 'extreme';
            }
        }

        await expect(new ExtremeService().run()).resolves.toBe('extreme');
        expect(provider.acquire).toHaveBeenLastCalledWith('ExtremeService.run', extreme);

        provider.acquire.mockClear();
        class NegativeRetryService {
            @DistributedLock({ retryCount: -1 })
            async run(): Promise<string> {
                return 'unreachable';
            }
        }

        await expect(new NegativeRetryService().run()).rejects.toBeInstanceOf(LockAcquisitionError);
        expect(provider.acquire).not.toHaveBeenCalled();
    });
});
