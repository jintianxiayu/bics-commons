import { Config } from '../types';

export const defaultConfig: Config = {
  root: {
    level: 'info',
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