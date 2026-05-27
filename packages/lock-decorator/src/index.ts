export { DistributedLock } from './decorators/distributed-lock';
export { LockProviderRegistry } from './core/lock-provider-registry';
export { RedisLockProvider } from './core/redis-lock-provider';
export { LockAcquisitionError } from './errors/lock-acquisition-error';
export {
  LockProvider,
  DistributedLockOptions,
  DEFAULT_TTL,
  DEFAULT_RENEW_INTERVAL,
  DEFAULT_RETRY_COUNT,
  DEFAULT_RETRY_DELAY,
} from './core/lock-provider';
export { Watchdog } from './core/watchdog';