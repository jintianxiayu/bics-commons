/**
 * Logger 默认配置
 *
 * 当未提供配置文件或配置缺失时使用的默认值
 */

import type { LoggerConfig, SensitiveFieldConfig } from '../types';

export const DEFAULT_SENSITIVE_FIELDS: SensitiveFieldConfig[] = [
  { field: 'password',       mask: '********' },
  { field: 'passwd',         mask: '********' },
  { field: 'pwd',            mask: '********' },
  { field: 'token',          mask: '********' },
  { field: 'apiKey',         mask: '********' },
  { field: 'api_key',        mask: '********' },
  { field: 'secretKey',      mask: '********' },
  { field: 'accessToken',    mask: '********' },
  { field: 'refreshToken',   mask: '********' },
  { field: 'phone',          mask: '*** *** {last4}' },
  { field: 'mobile',         mask: '*** *** {last4}' },
  { field: 'mobileNo',       mask: '*** *** {last4}' },
  { field: 'creditCard',     mask: '**** **** **** {last4}' },
  { field: 'cardNo',         mask: '**** **** **** {last4}' },
  { field: 'bankAccount',    mask: '**** **** **** {last4}' },
  { field: 'idCard',         mask: '**************{last4}' },
  { field: 'idNumber',       mask: '**************{last4}' },
  { field: 'email',          mask: '{first2}***@{domain}' },
];

export const DEFAULT_PATTERN = '%{timestamp} %{level} [%{name}] [%{traceId}] %{log_position}: %{message} %{meta}';

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