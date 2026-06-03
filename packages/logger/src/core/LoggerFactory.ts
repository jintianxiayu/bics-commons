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
import { SensitiveMasker } from './SensitiveMasker';
import { getDefaultConfig, DEFAULT_PATTERN } from '../config/defaultConfig';
import type { LoggerConfig, ShutdownOptions } from '../types';

interface LoggerInterface {
    debug(message: string, ...meta: unknown[]): void;
    info(message: string, ...meta: unknown[]): void;
    warn(message: string, ...meta: unknown[]): void;
    error(message: string, ...meta: unknown[]): void;
}

function serializeMeta(meta: unknown[]): unknown[] {
    return meta.map((m) => {
        if (m instanceof Error) {
            return { message: m.message, stack: m.stack };
        }
        if (m !== null && typeof m === 'object') {
            return SensitiveMasker.mask(m);
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
    private static isShuttingDown = false;
    private static wrapperCache = new Map<string, LoggerInterface>();

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
            this.initialized = true;
        }
    }

    /**
     * 初始化 LoggerFactory
     *
     * 显式加载并校验配置，配置错误时抛出异常
     */
    static init(): void {
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
        this.lazyInit();

        const cached = this.wrapperCache.get(name);
        if (cached) {
            return cached;
        }

        const container = this.ensureContainer();
        let config: LoggerConfig;

        const loggerConfig = ConfigLoader.getLoggerConfig(name);
        if (loggerConfig) {
            config = loggerConfig;
        } else {
            const rootConfig = ConfigLoader.getConfig() || getDefaultConfig();
            config = rootConfig;
        }

        if (!container.has(name)) {
            container.add(name, {
                level: config.level || 'info',
                transports: this.createTransports(config),
                defaultMeta: { name },
            } as winston.LoggerOptions);
        }

        const winstonLogger = container.get(name);

        const wrapper: LoggerInterface = {
            debug(message: string, ...meta: unknown[]): void {
                winstonLogger.debug(message, { meta: serializeMeta(meta) });
            },
            info(message: string, ...meta: unknown[]): void {
                winstonLogger.info(message, { meta: serializeMeta(meta) });
            },
            warn(message: string, ...meta: unknown[]): void {
                winstonLogger.warn(message, { meta: serializeMeta(meta) });
            },
            error(message: string, ...meta: unknown[]): void {
                winstonLogger.error(message, { meta: serializeMeta(meta) });
            },
        };

        this.wrapperCache.set(name, wrapper);
        return wrapper;
    }

    private static createTransports(config: LoggerConfig): winston.transport[] {
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
    static async shutdown(options?: ShutdownOptions): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;
        const timeoutMs = options?.timeout ?? 5000;

        await Promise.race([
            this.container?.close() ?? Promise.resolve(),
            new Promise((resolve) => setTimeout(resolve, timeoutMs)),
        ]);

        options?.onShutdown?.();
        this.container = null;
        this.initialized = false;
        this.isShuttingDown = false;
    }

    /**
     * 注册进程信号处理
     *
     * 自动在进程收到 SIGTERM/SIGINT 时调用 shutdown
     */
    static setupShutdownHandlers(options?: ShutdownOptions): void {
        const signals = options?.signals || ['SIGTERM', 'SIGINT'];
        const timeout = options?.timeout ?? 5000;

        for (const signal of signals) {
            process.on(signal, async () => {
                await this.shutdown({ timeout, onShutdown: () => process.exit(0) });
            });
        }
    }

    /**
     * 重置状态（用于测试）
     */
    static reset(): void {
        this.container = null;
        this.initialized = false;
        this.isShuttingDown = false;
        this.wrapperCache.clear();
        ConfigLoader.reset();
        SensitiveMasker.reset();
    }
}
