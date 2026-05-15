import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { loadConfig, resetConfig } from './ConfigLoader';
import { createPatternFormatter } from '../formatters/PatternFormatter';
import { LogFormat, Config, LogLevel } from '../types';

const container = new winston.Container();

const createTransports = (config: Config['root'], name: string) => {
  const transports: winston.transport[] = [];

  if (config.console.enabled) {
    const consoleFormat = config.format === 'json'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          createPatternFormatter(config.pattern)
        );

    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          consoleFormat
        ),
      })
    );
  }

  if (config.file.enabled) {
    const fileFormat = config.format === 'json'
      ? winston.format.json()
      : createPatternFormatter(config.pattern);

    transports.push(
      new (DailyRotateFile)({
        dirname: config.file.dirname,
        filename: config.file.filename,
        datePattern: config.file.datePattern,
        maxSize: config.file.maxSize,
        maxFiles: config.file.maxFiles,
        format: winston.format.combine(
          winston.format.timestamp(),
          fileFormat
        ),
        level: config.level,
      })
    );
  }

  return transports;
};

const createLoggerConfig = (config: Config['root'], loggerConfig: Config['loggers'][string]) => {
  const level = loggerConfig.level || config.level;
  const format = loggerConfig.format || config.format;
  const pattern = loggerConfig.pattern || config.pattern;

  // 合并配置（root 的未覆盖项 + logger 的覆盖项）
  const mergedConfig = {
    level,
    format,
    pattern,
    console: config.console,
    file: config.file,
  };

  return {
    level,
    format: format as LogFormat,
    pattern,
    transports: createTransports(
      { ...mergedConfig, ...loggerConfig } as Config['root'],
      loggerConfig.name
    ),
  };
};

export const LoggerFactory = {
  getLogger(name: string): winston.Logger {
    const config = loadConfig(process.env.LOGGER_CONFIG_PATH);

    let loggerConfig = config.loggers[name];

    // 如果没有命名配置，创建一个继承 root 的
    if (!loggerConfig) {
      loggerConfig = { name };
    }

    const loggerOptions = createLoggerConfig(config.root, loggerConfig);

    // 使用 container 获取或创建 logger
    let logger = container.get(name);

    if (!logger) {
      logger = container.add(name, {
        level: loggerOptions.level,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.label({ label: name }),
          loggerOptions.format === 'json'
            ? winston.format.json()
            : createPatternFormatter(loggerOptions.pattern)
        ),
        transports: loggerOptions.transports,
      });
    }

    return logger;
  },

  reset(): void {
    resetConfig();
    // 清除所有 logger
    container.close();
  },
};