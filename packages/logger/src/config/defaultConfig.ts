import { Config, LogLevel } from '../types';

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