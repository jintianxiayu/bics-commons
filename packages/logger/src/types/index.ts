export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export type LogFormat = 'plain' | 'json';

export interface ConsoleConfig {
  enabled: boolean;
}

export interface FileConfig {
  enabled: boolean;
  dirname?: string;
  filename?: string;
  datePattern?: string;
  maxSize?: string;
  maxFiles?: string | number;
}

export interface RootConfig {
  level: LogLevel;
  format: LogFormat;
  pattern: string;
  console: ConsoleConfig;
  file: FileConfig;
}

export interface LoggerConfig extends Partial<RootConfig> {
  name: string;
}

export interface Config {
  root: RootConfig;
  loggers: Record<string, LoggerConfig>;
}

export interface LogMessage {
  timestamp: string;
  level: string;
  name: string;
  message: string;
  meta?: unknown[];
  log_position?: string;
}