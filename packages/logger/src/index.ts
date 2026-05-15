/**
 * @bics/logger 包入口
 * 提供基于 Winston 的日志工厂，支持命名 logger、配置继承、YAML 配置文件加载
 */
export { LoggerFactory } from './core/LoggerFactory';
export { LogLevel, LogFormat } from './types';
export type { Config, LoggerConfig } from './types';