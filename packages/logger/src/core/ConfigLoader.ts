import fs from 'fs';
import YAML from 'yaml';
import { Config, LogLevel } from '../types';
import { defaultConfig } from '../config/defaultConfig';

let cachedConfig: Config | null = null;

/**
 * 解析布尔值配置，支持 boolean 和字符串形式
 */
const parseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return false;
};

/**
 * 解析 YAML 配置为 Config 对象
 */
const parseConfig = (data: unknown): Config => {
  const config = data as Record<string, unknown>;

  const root = config.root as Record<string, unknown> || {};
  const loggers = (config.loggers as Record<string, Record<string, unknown>>) || {};

  const parseFileConfig = (file: unknown): typeof defaultConfig.root.file => {
    if (!file || typeof file !== 'object') return defaultConfig.root.file;
    const f = file as Record<string, unknown>;
    return {
      enabled: parseBoolean(f.enabled),
      dirname: (f.dirname as string) || './logs',
      filename: (f.filename as string) || 'app.log',
      datePattern: (f.datePattern as string) || 'YYYY-MM-DD',
      maxSize: (f.maxSize as string) || '10m',
      maxFiles: (f.maxFiles as string) || '7d',
    };
  };

  return {
    root: {
      level: (root.level as LogLevel) || defaultConfig.root.level,
      format: (root.format as 'plain' | 'json') || defaultConfig.root.format,
      pattern: (root.pattern as string) || defaultConfig.root.pattern,
      console: {
        enabled: parseBoolean(root.console && (root.console as Record<string, unknown>).enabled),
      },
      file: parseFileConfig(root.file),
    },
    loggers: Object.entries(loggers).reduce((acc, [name, loggerConfig]) => {
      acc[name] = { name, ...loggerConfig } as typeof defaultConfig.loggers[string];
      return acc;
    }, {} as Record<string, typeof defaultConfig.loggers[string]>),
  };
};

/**
 * 加载日志配置
 * @param configPath - YAML 配置文件路径，未提供则使用内置默认配置
 * @returns 解析后的 Config 对象，结果会被缓存
 */
export const loadConfig = (configPath?: string): Config => {
  if (cachedConfig) return cachedConfig;

  if (!configPath) {
    cachedConfig = defaultConfig;
    return cachedConfig;
  }

  if (!fs.existsSync(configPath)) {
    cachedConfig = defaultConfig;
    return cachedConfig;
  }

  const fileContent = fs.readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(fileContent);
  cachedConfig = parseConfig(parsed);
  return cachedConfig;
};

/**
 * 重置配置缓存，用于测试或配置热更新
 */
export const resetConfig = (): void => {
  cachedConfig = null;
};
