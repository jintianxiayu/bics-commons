import { Config, LogLevel } from '../types';

/**
 * 内置默认日志配置
 * 当环境变量 LOGGER_CONFIG_PATH 未设置时使用此配置
 */
export const defaultConfig: Config = {
  root: {
    level: LogLevel.INFO,
    format: 'plain',
    pattern: '%{timestamp} %{level} %{name} %{log_position}: %{message}',
    console: {
      enabled: true,
    },
    file: {
      enabled: false,
    },
  },
  loggers: {},
};