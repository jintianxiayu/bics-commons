import type { LogFormatName, LogLevelName } from '../types';

/** 配置校验后供运行时读取的控制台策略，保持只读可避免初始化后发生配置漂移。 */
export interface EffectiveConsoleConfig {
    readonly enabled: boolean;
    readonly colors: boolean;
    readonly format: LogFormatName;
    readonly pattern: string;
}

/** 配置校验后供文件传输复用的轮转策略，保持只读可确保相同目标的行为一致。 */
export interface EffectiveFileConfig {
    readonly enabled: boolean;
    readonly format: LogFormatName;
    readonly pattern: string;
    readonly dirname: string;
    readonly filename: string;
    readonly datePattern: string;
    readonly maxSize: number | string;
    readonly maxFiles: number | string;
}

/** 根日志器与命名日志器最终使用的完整策略，避免写日志时重复合并用户配置。 */
export interface EffectiveLoggerProfile {
    readonly level: LogLevelName;
    readonly captureLogPosition: boolean;
    readonly console: EffectiveConsoleConfig;
    readonly file: EffectiveFileConfig;
}

/** 脱敏器实际执行的只读配置，确保所有输出通道遵循同一敏感字段规则。 */
export interface EffectiveMaskingConfig {
    readonly enabled: boolean;
    /** 脱敏字段映射中 K 为业务字段名，V 为已校验的掩码模板。 */
    readonly fields: Readonly<Record<string, string>>;
}

/** 应用需统一决定致命进程错误的记录与退出行为，因此将相关开关固化后交给 Winston。 */
export interface EffectiveProcessErrorConfig {
    readonly uncaughtException: boolean;
    readonly unhandledRejection: boolean;
    readonly exitOnError: boolean;
}

/** 初始化完成后的配置快照，供日志工厂和传输层共享且不允许运行期修改。 */
export interface NormalizedLoggerConfig {
    readonly root: EffectiveLoggerProfile;
    /** 命名日志器映射中 K 为规范化名称，V 为已继承根策略的完整只读配置。 */
    readonly loggers: ReadonlyMap<string, EffectiveLoggerProfile>;
    readonly masking: EffectiveMaskingConfig;
    readonly processErrors: EffectiveProcessErrorConfig;
}

/** 元数据完成规范化与脱敏后的安全日志事件，供纯文本和 JSON 渲染器共同消费。 */
export interface SafeLogEvent {
    readonly timestamp: string;
    readonly level: LogLevelName;
    readonly name: string;
    readonly message: string;
    readonly traceId?: string;
    readonly logPosition?: string;
    readonly meta?: unknown;
}

export const LOGGER_PROFILE = Symbol('logger-profile');

/** 日志优先级映射中 K 为日志级别，V 为用于阈值比较的数字优先级；数值越小表示级别越高。 */
export const LEVEL_PRIORITY: Readonly<Record<LogLevelName, number>> = Object.freeze({
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
});
