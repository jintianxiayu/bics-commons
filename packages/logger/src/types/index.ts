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

/**
 * 配置加载完成后供 LoggerFactory 使用的配置。
 * 所有基础项均已补齐，敏感字段规则也已完成继承与合并。
 */
export interface EffectiveLoggerConfig {
    level: LogLevelName;
    console: ConsoleConfig;
    file: FileConfig;
    pattern: string;
    sensitiveMasking: Required<SensitiveMaskingConfig>;
}

/** YAML 兼容层接受的历史脱敏配置键。 */
export interface CompatibleLoggerConfig extends LoggerConfig {
    'sensitive-masking'?: SensitiveMaskingConfig;
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
