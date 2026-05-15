/**
 * 日志级别枚举，对应 Winston 的标准日志级别
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/** 日志输出格式：plain 为格式化文本，json 为 JSON 序列化 */
export type LogFormat = 'plain' | 'json';

/** 控制台输出配置 */
export interface ConsoleConfig {
  enabled: boolean;
}

/** 文件输出配置，支持按天轮转 */
export interface FileConfig {
  enabled: boolean;
  dirname?: string;
  filename?: string;
  datePattern?: string;
  maxSize?: string;
  maxFiles?: string | number;
}

/** 根日志配置，所有命名 logger 的默认继承来源 */
export interface RootConfig {
  level: LogLevel;
  format: LogFormat;
  pattern: string;
  console: ConsoleConfig;
  file: FileConfig;
}

/** 命名日志配置，可覆盖 root 的任意配置项 */
export interface LoggerConfig extends Partial<RootConfig> {
  name: string;
}

/** 完整的日志配置结构，包含 root 配置和所有命名 logger */
export interface Config {
  root: RootConfig;
  loggers: Record<string, LoggerConfig>;
}

/** 日志消息结构，用于 JSON 格式输出 */
export interface LogMessage {
  timestamp: string;
  level: string;
  name: string;
  message: string;
  meta?: unknown[];
  log_position?: string;
}