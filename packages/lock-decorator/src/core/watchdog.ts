import { LockProvider } from './lock-provider';

/** 看门狗配置 */
interface WatchdogConfig {
    provider: LockProvider;
    key: string;
    token: string;
    ttl: number;
    interval: number;
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
        this.timer = setInterval(async () => {
            const { provider, key, token, ttl } = this.config;
            const ok = await provider.renew(key, token, ttl);
            if (!ok) {
                this.stop();
            }
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
