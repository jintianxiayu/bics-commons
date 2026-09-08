import 'reflect-metadata';
import { performance } from 'node:perf_hooks';
import { LockProviderRegistry } from '../core/lock-provider-registry';
import { Watchdog } from '../core/watchdog';
import { logLockEvent, type LockLogContext } from '../core/lock-logger';
import { LockAcquisitionError } from '../errors/lock-acquisition-error';
import {
    DistributedLockOptions,
    LockProvider,
    DEFAULT_TTL,
    DEFAULT_RENEW_INTERVAL,
    DEFAULT_RETRY_COUNT,
    DEFAULT_RETRY_DELAY,
} from '../core/lock-provider';

/** 获取锁重试过程使用稳定参数快照，避免调用点依赖位置参数顺序。 */
interface LockAcquisitionRequest {
    readonly provider: LockProvider;
    readonly key: string;
    readonly ttl: number;
    readonly retryCount: number;
    readonly retryDelay: number;
    readonly startedAt: number;
    readonly logContext: LockLogContext;
}

interface LockAcquisitionResult {
    readonly token: string | null;
    readonly attempts: number;
}

/** 看门狗启动参数与 Watchdog 构造契约保持一致。 */
interface WatchdogStartRequest {
    readonly provider: LockProvider;
    readonly key: string;
    readonly token: string;
    readonly ttl: number;
    readonly interval: number;
}

interface LockReleaseRequest {
    readonly provider: LockProvider;
    readonly key: string;
    readonly token: string;
    readonly logContext: LockLogContext;
}

/**
 * 分布式锁装饰器
 * 自动完成加锁→业务执行→释放锁的全流程，支持看门狗自动续期
 * @param options 装饰器配置选项
 * @returns 用于包装异步实例方法的属性描述符装饰器。
 * @throws {TypeError} 当目标方法不是异步方法时抛出。
 * @throws {LockAcquisitionError} 当超过重试次数仍未获取锁时抛出。
 */
export function DistributedLock(
    options: DistributedLockOptions = {}
): (target: object, propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor {
    return function (target: object, propertyKey: string, descriptor: PropertyDescriptor) {
        const isValidReturnType = Reflect.hasMetadata('design:returntype', target, propertyKey);
        if (!isValidReturnType) {
            throw new TypeError('@DistributedLock can only be applied to async methods');
        }

        const returnType = Reflect.getMetadata('design:returntype', target, propertyKey) as unknown;
        const isAsync =
            returnType === Promise || (returnType instanceof Function && returnType.prototype?.then !== undefined);

        if (!isAsync) {
            throw new TypeError('@DistributedLock can only be applied to async methods');
        }

        const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;
        const logContext = {
            className: target.constructor?.name ?? 'Anonymous',
            methodName: String(propertyKey),
        } as const;

        descriptor.value = async function (...args: unknown[]): Promise<unknown> {
            let provider: LockProvider;
            try {
                provider = LockProviderRegistry.get();
            } catch (error) {
                logLockEvent('lock.operation_failed', {
                    ...logContext,
                    operation: 'provider_resolution',
                    error,
                });
                throw error;
            }
            const ttl = options.ttl ?? DEFAULT_TTL;
            const renewInterval = options.renewInterval ?? DEFAULT_RENEW_INTERVAL;
            const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
            const retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
            let lockKey: string;
            try {
                lockKey = resolveLockKey(target, propertyKey, options, args);
            } catch (error) {
                logLockEvent('lock.operation_failed', {
                    ...logContext,
                    operation: 'key_resolution',
                    reason: 'resolver_error',
                });
                throw error;
            }
            const maxAttempts = retryCount + 1;
            logLockEvent('lock.acquire_started', {
                ...logContext,
                maxAttempts,
                ttlMs: ttl,
                retryDelayMs: retryDelay,
            });
            const acquisitionStartedAt = performance.now();
            const acquisition = await acquireLockWithRetry({
                provider,
                key: lockKey,
                ttl,
                retryCount,
                retryDelay,
                startedAt: acquisitionStartedAt,
                logContext,
            });

            if (acquisition.token === null) {
                logLockEvent('lock.acquire_exhausted', {
                    ...logContext,
                    ...(acquisition.attempts > 0 ? { attempt: acquisition.attempts } : {}),
                    maxAttempts,
                    ttlMs: ttl,
                    retryDelayMs: retryDelay,
                    durationMs: elapsedSince(acquisitionStartedAt),
                });
                throw new LockAcquisitionError(lockKey, retryCount);
            }
            const token = acquisition.token;
            logLockEvent('lock.acquired', {
                ...logContext,
                attempt: acquisition.attempts,
                maxAttempts,
                ttlMs: ttl,
                durationMs: elapsedSince(acquisitionStartedAt),
            });

            let watchdog: Watchdog | null = null;
            if (renewInterval < ttl) {
                watchdog = startWatchdog({ provider, key: lockKey, token, ttl, interval: renewInterval });
                logLockEvent('lock.watchdog_started', {
                    ...logContext,
                    ttlMs: ttl,
                    renewIntervalMs: renewInterval,
                });
            } else {
                logLockEvent('lock.watchdog_skipped', {
                    ...logContext,
                    ttlMs: ttl,
                    renewIntervalMs: renewInterval,
                    reason: 'watchdog_disabled',
                });
            }

            try {
                logLockEvent('lock.execution_started', logContext);
                try {
                    const result = await originalMethod.apply(this, args);
                    logLockEvent('lock.execution_completed', { ...logContext, outcome: 'success' });
                    return result;
                } catch (error) {
                    logLockEvent('lock.execution_completed', { ...logContext, outcome: 'business_error' });
                    throw error;
                }
            } finally {
                watchdog?.stop();
                await releaseLock({ provider, key: lockKey, token, logContext });
            }
        };

        return descriptor;
    };
}

/**
 * 解析锁键
 * @param target 装饰器目标对象
 * @param propertyKey 属性名
 * @param options 装饰器配置
 * @param args 方法参数
 * @returns 锁键字符串
 * @throws 当业务提供的动态锁键函数抛出异常时透传。
 */
function resolveLockKey(target: object, propertyKey: string, options: DistributedLockOptions, args: unknown[]): string {
    if (options.key === undefined || options.key === null) {
        return `${target.constructor?.name ?? 'Anonymous'}.${String(propertyKey)}`;
    }
    if (typeof options.key === 'string') {
        return options.key;
    }
    return options.key(...args);
}

/**
 * 带重试的锁获取
 * @param request 锁提供者、锁键、有效期及重试策略。
 * @returns 成功返回 token，失败返回 null
 * @throws 当锁提供者获取锁或重试等待失败时透传异常。
 */
async function acquireLockWithRetry({
    provider,
    key,
    ttl,
    retryCount,
    retryDelay,
    startedAt,
    logContext,
}: LockAcquisitionRequest): Promise<LockAcquisitionResult> {
    let attempts = 0;
    while (attempts <= retryCount) {
        const attempt = attempts + 1;
        let token: string | null;
        try {
            token = await provider.acquire(key, ttl);
        } catch (error) {
            logLockEvent('lock.operation_failed', {
                ...logContext,
                attempt,
                maxAttempts: retryCount + 1,
                ttlMs: ttl,
                retryDelayMs: retryDelay,
                durationMs: elapsedSince(startedAt),
                operation: 'acquire',
                error,
            });
            throw error;
        }
        attempts = attempt;
        if (token !== null) {
            return { token, attempts };
        }
        if (attempts <= retryCount) {
            logLockEvent('lock.acquire_retry', {
                ...logContext,
                attempt,
                maxAttempts: retryCount + 1,
                ttlMs: ttl,
                retryDelayMs: retryDelay,
                durationMs: elapsedSince(startedAt),
            });
            await sleep(retryDelay);
        }
    }
    return { token: null, attempts };
}

/**
 * 创建并立即启动锁续期看门狗，保证业务执行期间锁不会因自然过期而失效。
 *
 * @param request 锁提供者、锁标识和续期时间配置。
 * @returns 已启动的看门狗实例，供业务结束时停止。
 * @throws 当看门狗构造或定时器启动失败时透传异常。
 */
function startWatchdog(request: WatchdogStartRequest): Watchdog {
    const watchdog = new Watchdog(request);
    watchdog.start();
    return watchdog;
}

/**
 * 记录并执行一次释放；拒绝仍以原异常传播给 decorator 的 finally 边界。
 * @param request Provider、锁标识及安全日志上下文。
 */
async function releaseLock({ provider, key, token, logContext }: LockReleaseRequest): Promise<void> {
    logLockEvent('lock.release_started', { ...logContext, phase: 'release' });
    try {
        const released = await provider.release(key, token);
        if (released) {
            logLockEvent('lock.released', { ...logContext, phase: 'release' });
            return;
        }
        logLockEvent('lock.ownership_lost', { ...logContext, phase: 'release' });
    } catch (error) {
        logLockEvent('lock.operation_failed', {
            ...logContext,
            operation: 'release',
            phase: 'release',
            error,
        });
        throw error;
    }
}

/** 延迟函数 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 以单调时钟生成非负有限耗时。 */
function elapsedSince(startedAt: number): number {
    const duration = performance.now() - startedAt;
    return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}
