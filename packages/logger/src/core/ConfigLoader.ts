/**
 * 配置加载器
 *
 * 负责从 YAML 文件加载配置，支持递归合并和配置校验
 */

import { readFileSync } from 'fs';
import { parse as yamlParse } from 'yaml';
import { getDefaultConfig } from '../config/defaultConfig';
import type { LoggerConfig } from '../types';

const CONFIG_ENV_KEY = 'LOGGER_CONFIG_PATH';
const DEFAULT_CONFIG_PATH = './logger.yaml';

interface ParsedConfig {
  root?: Partial<LoggerConfig>;
  loggers?: Record<string, Partial<LoggerConfig>>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 递归合并配置（JSON Merge Patch 风格）
 */
function mergeConfig(target: Partial<LoggerConfig>, source: Partial<LoggerConfig>): Partial<LoggerConfig> {
  if (!isObject(target) || !isObject(source)) {
    return source;
  }

  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const targetValue = (target as Record<string, unknown>)[key];
    const sourceValue = (source as Record<string, unknown>)[key];

    if (isObject(targetValue) && isObject(sourceValue)) {
      result[key] = mergeConfig(targetValue as Partial<LoggerConfig>, sourceValue as Partial<LoggerConfig>);
    } else {
      result[key] = sourceValue;
    }
  }

  return result as Partial<LoggerConfig>;
}

function validateConfigValue(value: unknown, path: string): void {
  if (value === undefined) return;

  if (path === 'root.level' || path === 'loggers.*.level') {
    if (typeof value !== 'string' || !['debug', 'info', 'warn', 'error'].includes(value)) {
      throw new Error(`Invalid log level at ${path}: ${value}`);
    }
  }

  if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      validateConfigValue(v, `${path}.${k}`);
    }
  }
}

class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * 加载并解析 YAML 配置文件
 */
function loadYamlFile(filePath: string): Partial<ParsedConfig> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return yamlParse(content) as Partial<ParsedConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigError(`Config file not found: ${filePath}`);
    }
    if (error instanceof Error && error.name === 'YAMLParseError') {
      throw new ConfigError(`Invalid YAML: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 校验配置结构
 */
function validateConfig(config: Partial<ParsedConfig>): void {
  if (!config) {
    throw new ConfigError('Config is empty');
  }

  if (config.root) {
    validateConfigValue(config.root, 'root');
  }

  if (config.loggers) {
    for (const [name, loggerConfig] of Object.entries(config.loggers)) {
      if (typeof name !== 'string') {
        throw new ConfigError('Logger name must be a string');
      }
      if (loggerConfig) {
        validateConfigValue(loggerConfig, `loggers.${name}`);
      }
    }
  }
}

export class ConfigLoader {
  private static config: LoggerConfig | null = null;
  private static loggerConfigs: Map<string, LoggerConfig> = new Map();

  /**
   * 获取配置文件路径
   */
  static getConfigPath(): string {
    return process.env[CONFIG_ENV_KEY] || DEFAULT_CONFIG_PATH;
  }

  /**
   * 加载并校验配置
   */
  static load(configPath?: string): LoggerConfig {
    const path = configPath || this.getConfigPath();

    const parsed = loadYamlFile(path);
    validateConfig(parsed);

    const rootConfig = mergeConfig(getDefaultConfig(), parsed.root || {});

    this.config = rootConfig;
    this.loggerConfigs.clear();

    if (parsed.loggers) {
      for (const [name, loggerPartial] of Object.entries(parsed.loggers)) {
        const merged = mergeConfig(rootConfig, loggerPartial);
        this.loggerConfigs.set(name, merged as LoggerConfig);
      }
    }

    return this.config;
  }

  /**
   * 获取已缓存的配置
   */
  static getConfig(): LoggerConfig | null {
    return this.config;
  }

  /**
   * 获取命名 Logger 的配置（已合并 root 配置）
   */
  static getLoggerConfig(name: string): LoggerConfig | null {
    return this.loggerConfigs.get(name) || null;
  }

  /**
   * 获取所有已注册的 Logger 名称
   */
  static getLoggerNames(): string[] {
    return Array.from(this.loggerConfigs.keys());
  }

  /**
   * 清除缓存的配置（用于测试）
   */
  static reset(): void {
    this.config = null;
    this.loggerConfigs.clear();
  }

  /**
   * 获取默认配置
   */
  static getDefaultConfig(): LoggerConfig {
    return getDefaultConfig();
  }

  static ConfigError = ConfigError;
}