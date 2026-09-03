import 'reflect-metadata';
import { LockProviderRegistry } from '../core/lock-provider-registry';
import { Watchdog } from '../core/watchdog';
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
}

/** 看门狗启动参数与 Watchdog 构造契约保持一致。 */
interface WatchdogStartRequest {
    readonly provider: LockProvider;
    readonly key: string;
    readonly token: string;
    readonly ttl: number;
    readonly interval: number;
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

        descriptor.value = async function (...args: unknown[]): Promise<unknown> {
            const provider = LockProviderRegistry.get();
            const ttl = options.ttl ?? DEFAULT_TTL;
            const renewInterval = options.renewInterval ?? DEFAULT_RENEW_INTERVAL;
            const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
            const retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
            const lockKey = resolveLockKey(target, propertyKey, options, args);
            const token = await acquireLockWithRetry({ provider, key: lockKey, ttl, retryCount, retryDelay });

            if (token === null) {
                throw new LockAcquisitionError(lockKey, retryCount);
            }

            const watchdog =
                renewInterval < ttl
                    ? startWatchdog({ provider, key: lockKey, token, ttl, interval: renewInterval })
                    : null;

            try {
                return await originalMethod.apply(this, args);
            } finally {
                watchdog?.stop();
                await provider.release(lockKey, token);
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
}: LockAcquisitionRequest): Promise<string | null> {
    let attempts = 0;
    while (attempts <= retryCount) {
        const token = await provider.acquire(key, ttl);
        if (token !== null) {
            return token;
        }
        attempts++;
        if (attempts <= retryCount) {
            await sleep(retryDelay);
        }
    }
    return null;
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

/** 延迟函数 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
