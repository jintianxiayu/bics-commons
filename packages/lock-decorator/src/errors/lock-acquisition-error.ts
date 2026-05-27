/**
 * 锁获取失败异常
 * 当无法在重试次数内获取分布式锁时抛出
 */
export class LockAcquisitionError extends Error {
  /**
   * @param key 获取失败的锁键
   * @param retryCount 已尝试的重试次数
   */
  constructor(
    public readonly key: string,
    public readonly retryCount: number,
  ) {
    super(`Failed to acquire lock after ${retryCount} retries: ${key}`);
    this.name = 'LockAcquisitionError';
    Object.setPrototypeOf(this, LockAcquisitionError.prototype);
  }
}