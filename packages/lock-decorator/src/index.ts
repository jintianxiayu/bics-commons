export { DistributedLock } from './decorators/distributed-lock';
export { LockProviderRegistry } from './core/lock-provider-registry';
export { RedisLockProvider } from './core/redis-lock-provider';
export { LockAcquisitionError } from './errors/lock-acquisition-error';
export type { LockProvider, DistributedLockOptions } from './core/lock-provider';
export { DEFAULT_TTL, DEFAULT_RENEW_INTERVAL, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_DELAY } from './core/lock-provider';
export { Watchdog } from './core/watchdog';
