/**
 * Logger 配置加载器。
 *
 * 配置按“解析 → 校验/别名规范化 → root 合并 → 命名 logger 合并”处理，
 * 只有全部步骤成功后才会原子替换缓存。
 */

import { readFileSync } from 'fs';
import { parse as yamlParse } from 'yaml';
import { getDefaultConfig, mergeSensitiveFields } from '../config/defaultConfig';
import type { EffectiveLoggerConfig, LoggerConfig, SensitiveFieldConfig, SensitiveMaskingConfig } from '../types';

const CONFIG_ENV_KEY = 'LOGGER_CONFIG_PATH';
const DEFAULT_CONFIG_PATH = './logger.yaml';
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

interface ConfigSource {
    path: string;
    optional: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ConfigError extends Error {
    readonly path?: string;

    constructor(message: string, path?: string) {
        super(path ? `Invalid configuration at ${path}: ${message}` : message);
        this.name = 'ConfigError';
        this.path = path;
    }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
    if (!isObject(value)) {
        throw new ConfigError('expected an object', path);
    }
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
    const known = new Set(keys);
    for (const key of Object.keys(value)) {
        if (!known.has(key)) {
            throw new ConfigError('unknown field', `${path}.${key}`);
        }
    }
}

function assertBoolean(value: unknown, path: string): void {
    if (typeof value !== 'boolean') {
        throw new ConfigError(`expected boolean, received ${JSON.stringify(value)}`, path);
    }
}

function assertString(value: unknown, path: string, nonEmpty = false): void {
    if (typeof value !== 'string' || (nonEmpty && value.trim().length === 0)) {
        throw new ConfigError(nonEmpty ? 'expected a non-empty string' : 'expected a string', path);
    }
}

function validateConsoleConfig(value: unknown, path: string): void {
    assertObject(value, path);
    assertKnownKeys(value, ['enabled', 'colors', 'format'], path);
    if ('enabled' in value) assertBoolean(value.enabled, `${path}.enabled`);
    if ('colors' in value) assertBoolean(value.colors, `${path}.colors`);
    if ('format' in value && value.format !== 'plain' && value.format !== 'json') {
        throw new ConfigError('expected plain or json', `${path}.format`);
    }
}

function validateFileConfig(value: unknown, path: string): void {
    assertObject(value, path);
    assertKnownKeys(value, ['enabled', 'dirname', 'filename', 'datePattern', 'maxSize', 'maxFiles'], path);
    if ('enabled' in value) assertBoolean(value.enabled, `${path}.enabled`);
    for (const key of ['dirname', 'filename', 'datePattern', 'maxSize', 'maxFiles'] as const) {
        if (key in value) assertString(value[key], `${path}.${key}`);
    }
}

function validateSensitiveMaskingConfig(value: unknown, path: string): void {
    assertObject(value, path);
    assertKnownKeys(value, ['enabled', 'fields'], path);
    if ('enabled' in value) assertBoolean(value.enabled, `${path}.enabled`);
    if (!('fields' in value)) return;
    if (!Array.isArray(value.fields)) {
        throw new ConfigError('expected an array', `${path}.fields`);
    }

    const seen = new Set<string>();
    value.fields.forEach((field, index) => {
        const fieldPath = `${path}.fields[${index}]`;
        assertObject(field, fieldPath);
        assertKnownKeys(field, ['field', 'mask'], fieldPath);
        assertString(field.field, `${fieldPath}.field`, true);
        assertString(field.mask, `${fieldPath}.mask`, true);
        const name = field.field as string;
        if (seen.has(name)) {
            throw new ConfigError(`duplicate sensitive field ${JSON.stringify(name)}`, `${fieldPath}.field`);
        }
        seen.add(name);
    });
}

function validateAndNormalizeLoggerConfig(value: unknown, path: string): LoggerConfig {
    assertObject(value, path);
    assertKnownKeys(value, ['level', 'console', 'file', 'pattern', 'sensitiveMasking', 'sensitive-masking'], path);

    if ('sensitiveMasking' in value && 'sensitive-masking' in value) {
        throw new ConfigError('sensitiveMasking conflicts with sensitive-masking', path);
    }
    if ('level' in value && (typeof value.level !== 'string' || !LOG_LEVELS.includes(value.level as never))) {
        throw new ConfigError('expected debug, info, warn, or error', `${path}.level`);
    }
    if ('pattern' in value) assertString(value.pattern, `${path}.pattern`);
    if ('console' in value) validateConsoleConfig(value.console, `${path}.console`);
    if ('file' in value) validateFileConfig(value.file, `${path}.file`);

    const sensitiveValue = value.sensitiveMasking ?? value['sensitive-masking'];
    if (sensitiveValue !== undefined) {
        validateSensitiveMaskingConfig(sensitiveValue, `${path}.sensitiveMasking`);
    }

    const normalized: LoggerConfig = {};
    if ('level' in value) normalized.level = value.level as LoggerConfig['level'];
    if ('pattern' in value) normalized.pattern = value.pattern as string;
    if ('console' in value)
        normalized.console = { ...(value.console as unknown as NonNullable<LoggerConfig['console']>) };
    if ('file' in value) normalized.file = { ...(value.file as unknown as NonNullable<LoggerConfig['file']>) };
    if (sensitiveValue !== undefined) {
        const sensitive = sensitiveValue as unknown as SensitiveMaskingConfig;
        normalized.sensitiveMasking = {
            ...(sensitive.enabled !== undefined ? { enabled: sensitive.enabled } : {}),
            ...(sensitive.fields !== undefined
                ? { fields: sensitive.fields.map((field: SensitiveFieldConfig) => ({ ...field })) }
                : {}),
        };
    }
    return normalized;
}

function validateAndNormalizeConfig(value: unknown): { root: LoggerConfig; loggers: Record<string, LoggerConfig> } {
    if (!isObject(value)) {
        throw new ConfigError('Config is empty');
    }
    assertKnownKeys(value, ['root', 'loggers'], 'config');

    const root = value.root === undefined ? {} : validateAndNormalizeLoggerConfig(value.root, 'root');
    const loggers: Record<string, LoggerConfig> = Object.create(null) as Record<string, LoggerConfig>;
    if (value.loggers !== undefined) {
        assertObject(value.loggers, 'loggers');
        for (const [name, loggerConfig] of Object.entries(value.loggers)) {
            loggers[name] = validateAndNormalizeLoggerConfig(loggerConfig, `loggers.${name}`);
        }
    }
    return { root, loggers };
}

function mergeEffectiveConfig(base: EffectiveLoggerConfig, override: LoggerConfig): EffectiveLoggerConfig {
    return {
        level: override.level ?? base.level,
        pattern: override.pattern ?? base.pattern,
        console: { ...base.console, ...(override.console ?? {}) },
        file: { ...base.file, ...(override.file ?? {}) },
        sensitiveMasking: {
            enabled: override.sensitiveMasking?.enabled ?? base.sensitiveMasking.enabled,
            fields: mergeSensitiveFields(base.sensitiveMasking.fields, override.sensitiveMasking?.fields),
        },
    };
}

function loadYamlFile(source: ConfigSource): unknown {
    try {
        return yamlParse(readFileSync(source.path, 'utf-8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            if (source.optional) return undefined;
            throw new ConfigError(`Config file not found: ${source.path}`);
        }
        if (error instanceof Error && error.name === 'YAMLParseError') {
            throw new ConfigError(`Invalid YAML: ${error.message}`);
        }
        throw error;
    }
}

function resolveSource(configPath?: string): ConfigSource {
    if (configPath !== undefined) return { path: configPath, optional: false };
    const environmentPath = process.env[CONFIG_ENV_KEY];
    if (environmentPath !== undefined && environmentPath !== '') {
        return { path: environmentPath, optional: false };
    }
    return { path: DEFAULT_CONFIG_PATH, optional: true };
}

export class ConfigLoader {
    private static config: EffectiveLoggerConfig | null = null;
    private static loggerConfigs: Map<string, EffectiveLoggerConfig> = new Map();

    static getConfigPath(): string {
        return resolveSource().path;
    }

    static load(configPath?: string): EffectiveLoggerConfig {
        const source = resolveSource(configPath);
        const parsedValue = loadYamlFile(source);
        const normalized =
            parsedValue === undefined ? { root: {}, loggers: {} } : validateAndNormalizeConfig(parsedValue);
        const rootConfig = mergeEffectiveConfig(getDefaultConfig(), normalized.root);
        const nextLoggerConfigs = new Map<string, EffectiveLoggerConfig>();
        for (const [name, loggerConfig] of Object.entries(normalized.loggers)) {
            nextLoggerConfigs.set(name, mergeEffectiveConfig(rootConfig, loggerConfig));
        }

        this.config = rootConfig;
        this.loggerConfigs = nextLoggerConfigs;
        return rootConfig;
    }

    static useDefaultConfig(): EffectiveLoggerConfig {
        const config = getDefaultConfig();
        this.config = config;
        this.loggerConfigs.clear();
        return config;
    }

    static getConfig(): EffectiveLoggerConfig | null {
        return this.config;
    }

    static getLoggerConfig(name: string): EffectiveLoggerConfig | null {
        return this.loggerConfigs.get(name) ?? null;
    }

    static getLoggerNames(): string[] {
        return Array.from(this.loggerConfigs.keys());
    }

    static reset(): void {
        this.config = null;
        this.loggerConfigs.clear();
    }

    static getDefaultConfig(): EffectiveLoggerConfig {
        return getDefaultConfig();
    }

    static ConfigError = ConfigError;
}
