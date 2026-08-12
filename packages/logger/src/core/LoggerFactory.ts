/**
 * 日志工厂
 *
 * 提供 SLF4J 风格的 Logger 获取、初始化和优雅关闭功能
 */

import * as winston from 'winston';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DailyRotateFile = require('winston-daily-rotate-file');
import { ConfigLoader } from './ConfigLoader';
import { LogPosition } from './LogPosition';
import { LoggerContext } from './LoggerContext';
import { createMaskingPolicy, type MaskingPolicy } from './SensitiveMasker';
import { getDefaultConfig, DEFAULT_PATTERN } from '../config/defaultConfig';
import type { EffectiveLoggerConfig, LoggerInterface, ShutdownOptions } from '../types';

function serializeMeta(meta: unknown[], maskingPolicy: MaskingPolicy): unknown[] {
    return meta.map((m) => {
        if (m instanceof Error) {
            return { message: m.message, stack: m.stack };
        }
        if (m !== null && typeof m === 'object') {
            return maskingPolicy.mask(m);
        }
        return m;
    });
}

function createFormat(pattern: string): winston.Logform.Format {
    return winston.format.printf((info) => {
        const timestampStr = String(info.timestamp ?? '');
        const levelStr = String(info.level ?? '');
        const nameStr = String(info.name ?? '');
        const messageStr = String(info.message ?? '');
        const metaObj = info.meta as unknown;
        const metaStr = JSON.stringify(metaObj ?? {});

        const replacements: Record<string, string> = {
            '%{timestamp}': timestampStr,
            '%{level}': levelStr,
            '%{name}': nameStr,
            '%{message}': messageStr,
            '%{meta}': metaStr,
        };

        let result = pattern;

        if (pattern.includes('%{log_position}')) {
            replacements['%{log_position}'] = LogPosition.capture();
        }

        if (pattern.includes('%{traceId}')) {
            const store = LoggerContext.getStore();
            replacements['%{traceId}'] = store?.get('traceId') ?? '-';
        }

        for (const [key, value] of Object.entries(replacements)) {
            result = result.split(key).join(value);
        }

        return result;
    });
}

function createJsonFormat(): winston.Logform.Format {
    return winston.format.combine(
        winston.format((info) => {
            const store = LoggerContext.getStore();
            const traceId = store?.get('traceId');
            if (traceId !== undefined) {
                info.traceId = traceId;
            }
            return info;
        })(),
        winston.format.json()
    );
}

export class LoggerFactory {
    private static container: winston.Container | null = null;
    private static initialized = false;
    private static shutdownPromise: Promise<void> | null = null;
    private static shutdownHandlers = new Map<string, () => void>();
    private static wrapperCache = new Map<string, LoggerInterface>();

    private static assertAvailable(): void {
        if (this.shutdownPromise) {
            throw new Error('LoggerFactory is shutting down');
        }
    }

    // Reserved for future use
    private static ensureContainer(): winston.Container {
        if (!this.container) {
            this.container = new winston.Container();
        }
        return this.container;
    }

    private static lazyInit(): void {
        if (this.initialized) {
            return;
        }

        try {
            ConfigLoader.load();
            this.initialized = true;
        } catch (error) {
            console.warn(`[WARN] Logger config error: ${(error as Error).message}`);
            console.warn('[WARN] Using default config.');
            ConfigLoader.useDefaultConfig();
            this.initialized = true;
        }
    }

    /**
     * 初始化 LoggerFactory
     *
     * 显式加载并校验配置，配置错误时抛出异常
     */
    static init(): void {
        this.assertAvailable();
        ConfigLoader.load();
        this.initialized = true;
    }

    /**
     * 获取 Logger 实例
     *
     * @param name - Logger 名称
     * @returns Logger 实例
     */
    static getLogger(name: string): LoggerInterface {
        this.assertAvailable();
        this.lazyInit();

        const cached = this.wrapperCache.get(name);
        if (cached) {
            return cached;
        }

        let config: EffectiveLoggerConfig;

        const loggerConfig = ConfigLoader.getLoggerConfig(name);
        if (loggerConfig) {
            config = loggerConfig;
        } else {
            const rootConfig = ConfigLoader.getConfig() || getDefaultConfig();
            config = rootConfig;
        }

        if (!config.console.enabled && !config.file.enabled) {
            const noop: LoggerInterface = {
                debug(): void {},
                info(): void {},
                warn(): void {},
                error(): void {},
            };
            this.wrapperCache.set(name, noop);
            return noop;
        }

        const container = this.ensureContainer();
        if (!container.has(name)) {
            container.add(name, {
                level: config.level || 'info',
                transports: this.createTransports(config),
                defaultMeta: { name },
            } as winston.LoggerOptions);
        }

        const winstonLogger = container.get(name);
        const maskingPolicy = createMaskingPolicy(config.sensitiveMasking);

        const wrapper: LoggerInterface = {
            debug(message: string, ...meta: unknown[]): void {
                winstonLogger.debug(message, { meta: serializeMeta(meta, maskingPolicy) });
            },
            info(message: string, ...meta: unknown[]): void {
                winstonLogger.info(message, { meta: serializeMeta(meta, maskingPolicy) });
            },
            warn(message: string, ...meta: unknown[]): void {
                winstonLogger.warn(message, { meta: serializeMeta(meta, maskingPolicy) });
            },
            error(message: string, ...meta: unknown[]): void {
                winstonLogger.error(message, { meta: serializeMeta(meta, maskingPolicy) });
            },
        };

        this.wrapperCache.set(name, wrapper);
        return wrapper;
    }

    private static createTransports(config: EffectiveLoggerConfig): winston.transport[] {
        const transports: winston.transport[] = [];

        if (config.console?.enabled !== false) {
            const useJson = config.console?.format === 'json';
            const baseFormats: winston.Logform.Format[] = [winston.format.timestamp()];

            if (!useJson && config.console?.colors !== false) {
                baseFormats.push(winston.format.colorize({ all: true }));
            }

            const consoleFormat = winston.format.combine(
                ...baseFormats,
                useJson ? createJsonFormat() : createFormat(config.pattern || DEFAULT_PATTERN)
            );

            transports.push(
                new winston.transports.Console({
                    format: consoleFormat,
                })
            );
        }

        if (config.file?.enabled) {
            const fileFormat = winston.format.combine(
                winston.format.timestamp(),
                createFormat(config.pattern || DEFAULT_PATTERN)
            );

            transports.push(
                new DailyRotateFile({
                    dirname: config.file.dirname || './logs',
                    filename: config.file.filename || 'app',
                    datePattern: config.file.datePattern || 'YYYY-MM-DD',
                    maxSize: config.file.maxSize || '10m',
                    maxFiles: config.file.maxFiles || '7d',
                    format: fileFormat,
                })
            );
        }

        return transports;
    }

    /**
     * 关闭 LoggerFactory
     *
     * 等待所有日志写入完成后关闭
     */
    static shutdown(options?: ShutdownOptions): Promise<void> {
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }

        const container = this.container;
        const timeoutMs = options?.timeout ?? 5000;
        const onShutdown = options?.onShutdown;
        const round = this.performShutdown(container, timeoutMs, onShutdown);
        const shared = round.finally(() => {
            if (this.shutdownPromise === shared) {
                this.shutdownPromise = null;
            }
        });
        this.shutdownPromise = shared;
        return shared;
    }

    private static async performShutdown(
        container: winston.Container | null,
        timeoutMs: number,
        onShutdown?: () => void
    ): Promise<void> {
        let closeFailed = false;
        let closeError: unknown;

        try {
            await this.waitForContainerClose(container, timeoutMs);
        } catch (error) {
            closeFailed = true;
            closeError = error;
        }

        this.resetRuntimeState();

        let callbackFailed = false;
        let callbackError: unknown;
        try {
            onShutdown?.();
        } catch (error) {
            callbackFailed = true;
            callbackError = error;
        }

        if (closeFailed) {
            if (callbackFailed && closeError instanceof Error) {
                Object.defineProperty(closeError, 'shutdownCallbackError', {
                    configurable: true,
                    value: callbackError,
                });
            }
            throw closeError;
        }
        if (callbackFailed) {
            throw callbackError;
        }
    }

    private static async waitForContainerClose(
        container: winston.Container | null,
        timeoutMs: number
    ): Promise<void> {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const closePromise = Promise.resolve().then(() => container?.close());

        // Promise.race 会观察 close 的拒绝；额外 observer 明确保证 timeout
        // 先结束后，迟到的 close rejection 也不会成为 unhandled rejection。
        void closePromise.catch(() => undefined);

        const timeoutPromise = new Promise<void>((resolve) => {
            timeoutHandle = setTimeout(resolve, Math.max(0, timeoutMs));
        });

        try {
            await Promise.race([closePromise, timeoutPromise]);
        } finally {
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    private static resetRuntimeState(): void {
        this.container = null;
        this.initialized = false;
        this.wrapperCache.clear();
        ConfigLoader.reset();
    }

    /**
     * 注册进程信号处理
     *
     * 自动在进程收到 SIGTERM/SIGINT 时调用 shutdown
     */
    static setupShutdownHandlers(options?: ShutdownOptions): void {
        const signals = options?.signals ?? ['SIGTERM', 'SIGINT'];
        const timeout = options?.timeout ?? 5000;
        const onShutdown = options?.onShutdown;

        for (const signal of signals) {
            if (this.shutdownHandlers.has(signal)) {
                continue;
            }

            const handler = (): void => {
                this.removeShutdownHandlers();
                void this.shutdown({ timeout, onShutdown }).then(
                    () => process.exit(0),
                    () => process.exit(1)
                );
            };
            this.shutdownHandlers.set(signal, handler);
            process.on(signal, handler);
        }
    }

    private static removeShutdownHandlers(): void {
        for (const [signal, handler] of this.shutdownHandlers) {
            process.off(signal, handler);
        }
        this.shutdownHandlers.clear();
    }

    /**
     * 重置状态（用于测试）
     */
    static reset(): void {
        this.removeShutdownHandlers();
        this.resetRuntimeState();
        this.shutdownPromise = null;
    }
}
