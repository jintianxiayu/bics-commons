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

/**
 * 分布式锁装饰器
 * 自动完成加锁→业务执行→释放锁的全流程，支持看门狗自动续期
 * @param options 装饰器配置选项
 */
export function DistributedLock(options: DistributedLockOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const isValidReturnType = Reflect.hasMetadata('design:returntype', target, propertyKey);
    if (!isValidReturnType) {
      throw new TypeError('@DistributedLock can only be applied to async methods');
    }

    const returnType = Reflect.getMetadata(
      'design:returntype',
      target,
      propertyKey,
    ) as unknown;
    const isAsync =
      returnType === Promise ||
      (returnType instanceof Function && returnType.prototype?.then !== undefined);

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
      const token = await acquireLockWithRetry(provider, lockKey, ttl, retryCount, retryDelay);

      if (token === null) {
        throw new LockAcquisitionError(lockKey, retryCount);
      }

      const watchdog = renewInterval < ttl ? startWatchdog(provider, lockKey, token, ttl, renewInterval) : null;

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
 */
function resolveLockKey(
  target: object,
  propertyKey: string,
  options: DistributedLockOptions,
  args: unknown[],
): string {
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
 * @param provider 锁提供者
 * @param key 锁键
 * @param ttl 过期时间
 * @param retryCount 最大重试次数
 * @param retryDelay 重试间隔
 * @returns 成功返回 token，失败返回 null
 */
async function acquireLockWithRetry(
  provider: LockProvider,
  key: string,
  ttl: number,
  retryCount: number,
  retryDelay: number,
): Promise<string | null> {
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

/** 启动看门狗续期 */
function startWatchdog(
  provider: LockProvider,
  key: string,
  token: string,
  ttl: number,
  interval: number,
): Watchdog {
  const watchdog = new Watchdog({ provider, key, token, ttl, interval });
  watchdog.start();
  return watchdog;
}

/** 延迟函数 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}