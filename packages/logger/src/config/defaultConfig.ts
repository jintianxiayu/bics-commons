/**
 * Logger 默认配置
 *
 * 当未提供配置文件或配置缺失时使用的默认值
 */

import type { LoggerConfig } from '../types';

export const DEFAULT_PATTERN = '%{timestamp} %{level} [%{name}] %{log_position}: %{message} %{meta}';

export const DEFAULT_LOG_LEVEL: 'info' = 'info';

export const defaultConfig: LoggerConfig = {
  level: DEFAULT_LOG_LEVEL,
  pattern: DEFAULT_PATTERN,
  console: {
    enabled: true,
    colors: true,
  },
  file: {
    enabled: false,
    dirname: './logs',
    filename: 'app.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '10m',
    maxFiles: '7d',
  },
};

export function getDefaultConfig(): LoggerConfig {
  return { ...defaultConfig };
}