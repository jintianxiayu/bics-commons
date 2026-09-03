import type winston from 'winston';
import { LoggerShutdownTimeoutError } from './errors';

interface FlushableStream extends NodeJS.EventEmitter {
    readonly closed?: boolean;
}

interface TransportWithFlushStream extends winston.transport {
    readonly logStream?: FlushableStream;
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error('Unknown logger shutdown error');
}

/**
 * 等待 Winston 及底层文件流完成刷新，使应用退出时已接收的日志不会静默丢失。
 *
 * 详细设计：
 * 1. 启动时收集仍打开的底层文件流，因为 Winston 的 finish 事件可能早于轮转流真正 close。
 * 2. 同时监听日志器、传输和文件流的完成或错误信号，并以 loggerFinished 与 pendingStreams 作为联合完成条件。
 * 3. 所有成功、错误和超时路径都经过单次 settle，先清理计时器与监听器再结算 Promise，避免竞态重复回调和资源泄漏。
 *
 * @param logger 待关闭的 Winston 日志器。
 * @param transports 需要同步观察错误和文件流状态的传输列表。
 * @param timeout 允许刷新和关闭的最长毫秒数。
 * @returns 日志器和底层流均完成关闭后的 Promise。
 * @throws 返回的 Promise 会在超时、日志器错误、传输错误或同步关闭失败时拒绝。
 */
export function shutdownWinstonLogger(
    logger: winston.Logger,
    transports: readonly winston.transport[],
    timeout: number
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        let loggerFinished = false;
        const pendingStreams = new Set<FlushableStream>();

        // logger 的 finish 早于部分轮转文件流 close，因此两类信号都完成后才能安全退出。
        for (const transport of transports as readonly TransportWithFlushStream[]) {
            if (transport.logStream && !transport.logStream.closed) {
                pendingStreams.add(transport.logStream);
            }
        }

        /**
         * 移除本次关闭流程注册的监听器和计时器，避免幂等关闭后残留资源。
         *
         * @returns 无返回值。
         * @throws 不主动抛出异常。
         */
        const cleanup = (): void => {
            if (timer) {
                clearTimeout(timer);
            }
            logger.removeListener('finish', onFinish);
            logger.removeListener('error', onError);
            for (const transport of transports) {
                transport.removeListener('error', onError);
            }
            for (const stream of pendingStreams) {
                stream.removeListener('close', onStreamClose);
                stream.removeListener('error', onError);
            }
        };

        /**
         * 只结算一次关闭 Promise，防止 finish、close、error 与 timeout 竞态重复回调。
         *
         * @param error 导致关闭失败的可选异常。
         * @returns 无返回值。
         * @throws 不主动抛出异常。
         */
        const settle = (error?: Error): void => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        const tryFinish = (): void => {
            if (loggerFinished && pendingStreams.size === 0) {
                settle();
            }
        };

        const onFinish = (): void => {
            loggerFinished = true;
            tryFinish();
        };
        const onError = (error: unknown): void => settle(asError(error));
        const onStreamClose = function (this: FlushableStream): void {
            this.removeListener('error', onError);
            pendingStreams.delete(this);
            tryFinish();
        };

        logger.once('finish', onFinish);
        logger.once('error', onError);
        for (const transport of transports) {
            transport.once('error', onError);
        }
        for (const stream of pendingStreams) {
            stream.once('close', onStreamClose);
            stream.once('error', onError);
        }
        const timer = setTimeout(() => settle(new LoggerShutdownTimeoutError(timeout)), timeout);

        try {
            logger.end();
        } catch (error) {
            settle(asError(error));
        }
    });
}
