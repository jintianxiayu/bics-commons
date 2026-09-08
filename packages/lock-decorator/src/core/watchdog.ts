import { LockProvider } from './lock-provider';
import { logLockEvent } from './lock-logger';

/** 看门狗配置 */
interface WatchdogConfig {
    provider: LockProvider;
    key: string;
    token: string;
    ttl: number;
    interval: number;
}

/**
 * 在定时器 Promise 边界内收敛一次续期结果，避免 Provider rejection 成为未处理拒绝。
 * @param config 当前 Watchdog 使用的锁与时间配置。
 * @param stop 停止后续续期的回调。
 */
async function renewLock(config: WatchdogConfig, stop: () => void): Promise<void> {
    const { provider, key, token, ttl, interval } = config;
    try {
        const renewed = await provider.renew(key, token, ttl);
        if (renewed) {
            logLockEvent('lock.renewed', { ttlMs: ttl, renewIntervalMs: interval });
            return;
        }
        logLockEvent('lock.ownership_lost', {
            ttlMs: ttl,
            renewIntervalMs: interval,
            phase: 'renew',
        });
        stop();
    } catch (error) {
        logLockEvent('lock.operation_failed', {
            ttlMs: ttl,
            renewIntervalMs: interval,
            operation: 'renew',
            error,
        });
        stop();
    }
}

/**
 * 看门狗自动续期线程
 * 独立线程定期调用 LockProvider.renew() 续期，防止锁超时
 */
export class Watchdog {
    private timer: NodeJS.Timeout | null = null;

    constructor(private config: WatchdogConfig) {}

    /** 启动看门狗续期 */
    start(): void {
        this.timer = setInterval(() => {
            void renewLock(this.config, () => this.stop());
        }, this.config.interval);
    }

    /** 停止看门狗续期 */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
