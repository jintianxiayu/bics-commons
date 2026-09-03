/** 配置错误需要与运行期故障区分，便于应用在启动阶段快速失败并定位配置来源。 */
export class LoggerConfigError extends Error {
    readonly cause: unknown;

    constructor(message: string, options?: { readonly cause?: unknown }) {
        super(message);
        this.name = 'LoggerConfigError';
        this.cause = options?.cause;
    }
}

/** 生命周期错误用于阻止应用在关闭期间重新初始化或获取日志器。 */
export class LoggerLifecycleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LoggerLifecycleError';
    }
}

/** 关闭超时需要携带原始等待时长，便于应用决定退出策略并记录诊断信息。 */
export class LoggerShutdownTimeoutError extends Error {
    readonly timeout: number;

    constructor(timeout: number) {
        super(`Logger shutdown timed out after ${timeout}ms`);
        this.name = 'LoggerShutdownTimeoutError';
        this.timeout = timeout;
    }
}
