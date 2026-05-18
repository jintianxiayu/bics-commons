/**
 * @bics/logger - SLF4J 风格的日志工厂
 *
 * 基于 Winston 的生产级日志库，支持：
 * - YAML 配置文件
 * - 命名 Logger
 * - 配置继承
 * - %{log_position} 占位符自动捕获调用位置
 * - 优雅关闭
 *
 * @example
 * ```typescript
 * import { LoggerFactory } from '@bics/logger';
 *
 * const logger = LoggerFactory.getLogger('database');
 * logger.info('connection opened');
 * ```
 */

import { LoggerFactory } from './core/LoggerFactory';
import { ConfigLoader } from './core/ConfigLoader';
import { LogPosition } from './core/LogPosition';
import type {
  LoggerOptions,
  LoggerConfig,
  LogLevelName,
  ConsoleConfig,
  FileConfig,
  ShutdownOptions,
} from './types';

/**
 * 导出 LoggerFactory、ConfigLoader、LogPosition
 */
export { LoggerFactory, ConfigLoader, LogPosition };

/**
 * 导出类型定义
 */
export type {
  LoggerOptions,
  LoggerConfig,
  LogLevelName,
  ConsoleConfig,
  FileConfig,
  ShutdownOptions,
};

/**
 * 创建 Logger 实例（已弃用，请使用 LoggerFactory.getLogger）
 *
 * @deprecated 使用 LoggerFactory.getLogger(name) 替代
 * @param options - 可选配置项
 * @param options.name - Logger 名称，默认为 'default'
 * @returns Logger 实例
 */
export function createLogger(options?: { name?: string }): ReturnType<typeof LoggerFactory.getLogger> {
  const name = options?.name || 'default';
  return LoggerFactory.getLogger(name);
}