/**
 * Logger 包类型定义
 *
 * 定义 LoggerFactory 所需的配置、选项和接口类型
 */

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

export interface ConsoleConfig {
    enabled: boolean;
    colors?: boolean;
    format?: 'plain' | 'json';
}

export interface FileConfig {
    enabled: boolean;
    dirname?: string;
    filename?: string;
    datePattern?: string;
    maxSize?: string;
    maxFiles?: string;
}

export interface SensitiveFieldConfig {
    field: string;
    mask: string;
}

export interface SensitiveMaskingConfig {
    enabled?: boolean;
    fields?: SensitiveFieldConfig[];
}

export interface LoggerConfig {
    level?: LogLevelName;
    console?: ConsoleConfig;
    file?: FileConfig;
    pattern?: string;
    sensitiveMasking?: SensitiveMaskingConfig;
}

export interface LoggerOptions {
    name: string;
    level?: LogLevelName;
    console?: ConsoleConfig;
    file?: FileConfig;
    pattern?: string;
}

export interface ShutdownOptions {
    timeout?: number;
    onShutdown?: () => void;
    signals?: string[];
}

export interface LoggerInterface {
    debug(message: string, ...meta: unknown[]): void;
    info(message: string, ...meta: unknown[]): void;
    warn(message: string, ...meta: unknown[]): void;
    error(message: string, ...meta: unknown[]): void;
}

export { LogLevelName as Level };
