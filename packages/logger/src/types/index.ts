/** 调用方通过统一的级别名称控制日志筛选，避免各业务模块自行约定不兼容的级别。 */
export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

/** 日志库同时服务可读控制台与结构化采集场景，因此由该类型约束可选输出格式。 */
export type LogFormatName = 'plain' | 'json';

/** 业务应用按运行环境决定是否输出控制台日志及其呈现方式时使用的配置。 */
export interface ConsoleConfig {
    enabled?: boolean;
    colors?: boolean;
    format?: LogFormatName;
    pattern?: string;
}

/** 业务应用需要持久化并轮转日志文件时使用的配置。 */
export interface FileConfig {
    enabled?: boolean;
    format?: LogFormatName;
    pattern?: string;
    dirname?: string;
    filename?: string;
    datePattern?: string;
    maxSize?: number | string;
    maxFiles?: number | string;
}

/** 根日志器与命名日志器共享同一配置结构，便于业务模块按名称覆盖默认策略。 */
export interface LoggerOptions {
    level?: LogLevelName;
    captureLogPosition?: boolean;
    console?: ConsoleConfig;
    file?: FileConfig;
}

/** 业务可以为自身敏感字段声明掩码模板；K 为字段名，V 为该字段使用的掩码模板。 */
export type SensitiveFieldConfig = Record<string, string>;

/** 业务日志可能携带凭证或个人信息，因此在进入任一输出通道前统一应用该保护配置。 */
export interface SensitiveMaskingConfig {
    enabled?: boolean;
    fields?: SensitiveFieldConfig;
}

/** 应用希望由 Winston 接管未捕获异常或未处理拒绝时使用的进程错误配置。 */
export interface ProcessErrorConfig {
    uncaughtException?: boolean;
    unhandledRejection?: boolean;
    exitOnError?: boolean;
}

/** 日志库初始化入口接受的完整配置，用于统一根策略、命名覆盖、脱敏与进程错误处理。 */
export interface LoggerConfig {
    root?: LoggerOptions;
    /** 命名日志器映射中 K 为业务日志器名称，V 为该日志器覆盖根策略的局部配置。 */
    loggers?: Record<string, LoggerOptions>;
    masking?: SensitiveMaskingConfig;
    processErrors?: ProcessErrorConfig;
}

/** 应用退出前等待日志刷新时使用的关闭配置。 */
export interface ShutdownOptions {
    timeout?: number;
}

/** 业务模块只依赖该最小日志接口，从而与底层 Winston 实例和传输实现解耦。 */
export interface LoggerInterface {
    /**
     * 记录仅用于开发诊断的细粒度信息，并由当前日志级别决定是否输出。
     *
     * @param message 业务日志消息。
     * @param meta 需要规范化和脱敏的附加元数据。
     * @returns 无返回值。
     * @throws {TypeError} 当消息不是字符串时抛出。
     */
    debug(message: string, ...meta: unknown[]): void;
    /**
     * 记录业务正常流程中的关键信息，供运行监控和问题追踪使用。
     *
     * @param message 业务日志消息。
     * @param meta 需要规范化和脱敏的附加元数据。
     * @returns 无返回值。
     * @throws {TypeError} 当消息不是字符串时抛出。
     */
    info(message: string, ...meta: unknown[]): void;
    /**
     * 记录业务仍可继续但需要关注的异常状态，便于告警系统区分严重程度。
     *
     * @param message 业务日志消息。
     * @param meta 需要规范化和脱敏的附加元数据。
     * @returns 无返回值。
     * @throws {TypeError} 当消息不是字符串时抛出。
     */
    warn(message: string, ...meta: unknown[]): void;
    /**
     * 记录导致业务失败的错误信息，供故障定位和告警处理使用。
     *
     * @param message 业务日志消息。
     * @param meta 需要规范化和脱敏的附加元数据。
     * @returns 无返回值。
     * @throws {TypeError} 当消息不是字符串时抛出。
     */
    error(message: string, ...meta: unknown[]): void;
}
