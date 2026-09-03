import type { LoggerConfig, LoggerInterface, LogLevelName, ShutdownOptions } from '../types';
import { LEVEL_PRIORITY, LOGGER_PROFILE, type EffectiveLoggerProfile, type NormalizedLoggerConfig } from './model';
import { ConfigLoader } from './ConfigLoader';
import { LoggerContext } from './LoggerContext';
import { captureLogPosition } from './LogPosition';
import { normalizeMetadata } from './MetadataNormalizer';
import { SensitiveMasker } from './SensitiveMasker';
import { defaultDiagnosticWriter, diagnosticErrorType, type DiagnosticWriter } from './diagnostics';
import { LoggerLifecycleError } from './errors';
import { createWinstonRuntime, type WinstonRuntime } from '../transport/TransportFactory';
import { shutdownWinstonLogger } from './shutdown';

const DEFAULT_SHUTDOWN_TIMEOUT = 5_000;

type FactoryState = 'UNINITIALIZED' | 'ACTIVE' | 'CLOSING' | 'CLOSED';

/** 写入请求将命名日志器选择的策略一并传入共享运行时，避免运行期再次查找可变配置。 */
interface LogWriteRequest {
    readonly name: string;
    readonly profile: EffectiveLoggerProfile;
    readonly level: LogLevelName;
    readonly message: string;
    readonly metaArguments: readonly unknown[];
}

/** 测试或宿主应用可替换配置加载与兜底诊断，但日志工厂的生命周期语义保持不变。 */
export interface LoggerFactoryRuntimeOptions {
    readonly configLoader?: ConfigLoader;
    readonly diagnostics?: DiagnosticWriter;
}

/** 命名日志器保持稳定名称和策略，使业务模块共享底层运行时但仍能独立筛选与路由。 */
class NamedLogger implements LoggerInterface {
    constructor(
        private readonly factory: LoggerFactoryRuntime,
        private readonly loggerName: string,
        private readonly profile: EffectiveLoggerProfile
    ) {}

    /**
     * 将命名日志器的固定上下文封装进共享写入请求，避免各级别方法重复拼装。
     *
     * @param level 本次日志级别。
     * @param message 业务日志消息。
     * @param metaArguments 业务附加的元数据参数。
     * @returns 无返回值。
     * @throws {TypeError} 当消息不是字符串时由共享运行时抛出。
     */
    private write(level: LogLevelName, message: string, metaArguments: readonly unknown[]): void {
        this.factory.write({
            name: this.loggerName,
            profile: this.profile,
            level,
            message,
            metaArguments,
        });
    }

    debug(message: string, ...meta: unknown[]): void {
        this.write('debug', message, meta);
    }

    info(message: string, ...meta: unknown[]): void {
        this.write('info', message, meta);
    }

    warn(message: string, ...meta: unknown[]): void {
        this.write('warn', message, meta);
    }

    error(message: string, ...meta: unknown[]): void {
        this.write('error', message, meta);
    }
}

function shouldLog(profile: EffectiveLoggerProfile, level: LogLevelName): boolean {
    return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[profile.level];
}

/** 调用位置判断只消费传输配置，不接收难以辨识语义的布尔控制参数。 */
interface LogPositionTransportConfig {
    readonly enabled: boolean;
    readonly format: 'plain' | 'json';
    readonly pattern: string;
}

function transportNeedsLogPosition(transport: LogPositionTransportConfig): boolean {
    return transport.enabled && (transport.format === 'json' || transport.pattern.includes('%{log_position}'));
}

/**
 * 仅在至少一个有效输出确实消费调用位置时采集栈，避免每条日志承担无用开销。
 *
 * @param profile 当前命名日志器的完整输出策略。
 * @returns 本次写入是否需要捕获业务调用位置。
 * @throws 不主动抛出异常。
 */
function shouldCaptureLogPosition(profile: EffectiveLoggerProfile): boolean {
    if (!profile.captureLogPosition) {
        return false;
    }
    return transportNeedsLogPosition(profile.console) || transportNeedsLogPosition(profile.file);
}

/** 集中管理配置、缓存与关闭状态，避免命名日志器各自创建传输并产生重复输出或资源竞争。 */
export class LoggerFactoryRuntime {
    private readonly configLoader: ConfigLoader;
    private readonly diagnostics: DiagnosticWriter;
    /** 日志器缓存中 K 为去除首尾空白后的业务名称，V 为绑定稳定配置的命名日志器实例。 */
    private readonly namedLoggers = new Map<string, LoggerInterface>();
    private state: FactoryState = 'UNINITIALIZED';
    private config?: NormalizedLoggerConfig;
    private masker?: SensitiveMasker;
    private runtime?: WinstonRuntime;
    private shutdownPromise?: Promise<void>;

    /**
     * 创建独立日志运行时，便于测试或多实例宿主隔离配置和诊断通道。
     *
     * @param options 可替换的配置加载器与诊断写入器。
     * @returns 新的日志运行时实例。
     * @throws 不主动抛出异常。
     */
    constructor(options: LoggerFactoryRuntimeOptions = {}) {
        this.configLoader = options.configLoader ?? new ConfigLoader();
        this.diagnostics = options.diagnostics ?? defaultDiagnosticWriter;
    }

    /**
     * 原子初始化日志配置、脱敏器和 Winston 传输，防止暴露半初始化状态。
     *
     * @param source 显式配置对象或配置文件路径。
     * @returns 无返回值；已成功初始化时保持幂等。
     * @throws {LoggerLifecycleError} 当运行时正在关闭或已经关闭时抛出。
     * @throws {LoggerConfigError} 当配置来源或配置内容无效时由加载链路抛出。
     */
    init(source?: string | LoggerConfig): void {
        if (this.state === 'ACTIVE') {
            return;
        }
        if (this.state === 'CLOSING' || this.state === 'CLOSED') {
            throw new LoggerLifecycleError(`Cannot initialize logger factory while ${this.state.toLowerCase()}`);
        }

        // 所有依赖都构造成功后才切换为 ACTIVE，避免初始化异常留下可被使用的半成品状态。
        const config = this.configLoader.load(source);
        const masker = new SensitiveMasker(config.masking);
        const runtime = createWinstonRuntime(config, this.diagnostics);
        this.config = config;
        this.masker = masker;
        this.runtime = runtime;
        this.state = 'ACTIVE';
    }

    /**
     * 按规范化名称复用命名日志器，并在首次调用时延迟初始化默认配置。
     *
     * @param name 业务模块使用的日志器名称。
     * @returns 与规范化名称对应的稳定日志器实例。
     * @throws {TypeError} 当名称不是非空字符串时抛出。
     * @throws {LoggerLifecycleError} 当运行时正在关闭或已经关闭时抛出。
     * @throws {LoggerConfigError} 当延迟初始化读取到无效配置时由加载链路抛出。
     */
    getLogger(name: string): LoggerInterface {
        if (typeof name !== 'string') {
            throw new TypeError('Logger name must be a string');
        }
        const normalizedName = name.trim();
        if (normalizedName.length === 0) {
            throw new TypeError('Logger name must not be empty');
        }
        if (this.state === 'CLOSING' || this.state === 'CLOSED') {
            throw new LoggerLifecycleError(`Cannot get logger while factory is ${this.state.toLowerCase()}`);
        }
        if (this.state === 'UNINITIALIZED') {
            this.init();
        }

        const cached = this.namedLoggers.get(normalizedName);
        if (cached) {
            return cached;
        }

        const config = this.config!;
        const profile = config.loggers.get(normalizedName) ?? config.root;
        const logger = new NamedLogger(this, normalizedName, profile);
        this.namedLoggers.set(normalizedName, logger);
        return logger;
    }

    /**
     * 规范化、脱敏并路由单条日志，确保所有输出通道共享同一安全处理链路。
     *
     * @param request 命名日志器生成的完整写入请求。
     * @returns 无返回值；运行时不可写或日志被过滤时直接返回。
     * @throws {TypeError} 当日志消息不是字符串时抛出。
     * @throws 当底层 Winston 同步写入失败时透传对应异常。
     */
    write({ name, profile, level, message, metaArguments }: LogWriteRequest): void {
        if (this.state !== 'ACTIVE') {
            return;
        }
        if (typeof message !== 'string') {
            throw new TypeError('Log message must be a string');
        }
        if (!shouldLog(profile, level)) {
            return;
        }
        if (!profile.console.enabled && !profile.file.enabled) {
            return;
        }

        // 先把异常、循环引用等值规范化，再执行脱敏，确保任何输出通道都不会绕过敏感字段策略。
        const normalized = normalizeMetadata(metaArguments);
        if (normalized.issue) {
            this.diagnostics('LOGGER_METADATA_SERIALIZATION_FAILED', normalized.issue);
        }

        let meta: unknown;
        if (normalized.meta !== undefined) {
            try {
                meta = this.masker!.mask(normalized.meta);
            } catch (error) {
                this.diagnostics('LOGGER_METADATA_SERIALIZATION_FAILED', diagnosticErrorType(error));
                meta = { serializationError: '[Unserializable metadata]' };
            }
        }

        const contextTraceId = LoggerContext.get('traceId');
        const traceId = typeof contextTraceId === 'string' && contextTraceId.length > 0 ? contextTraceId : undefined;
        const logPosition = shouldCaptureLogPosition(profile) ? (captureLogPosition() ?? '-') : undefined;
        /** Winston 信息对象中 K 为标准日志字段或内部路由 Symbol，V 为完成规范化和脱敏后的字段值。 */
        const info: Record<string | symbol, unknown> = {
            timestamp: new Date().toISOString(),
            level,
            name,
            message,
            ...(traceId !== undefined ? { traceId } : {}),
            ...(logPosition !== undefined ? { logPosition } : {}),
            ...(meta !== undefined ? { meta } : {}),
        };
        // 使用 Symbol 携带路由策略，既供传输层选择输出目标，又不会被序列化到业务日志中。
        info[LOGGER_PROFILE] = profile;
        this.runtime!.logger.log(info as never);
    }

    /**
     * 幂等关闭共享 Winston 运行时并等待已接收日志刷新，供多个应用退出钩子安全复用。
     *
     * @param options 关闭等待时间配置。
     * @returns 所有传输完成关闭后的 Promise。
     * @throws 返回的 Promise 会在超时无效、刷新超时或底层流失败时拒绝。
     */
    shutdown(options: ShutdownOptions = {}): Promise<void> {
        // 复用同一 Promise，让多个应用关闭钩子不会重复结束 Winston 流或产生竞态。
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }
        const timeout = options.timeout ?? DEFAULT_SHUTDOWN_TIMEOUT;
        if (!Number.isSafeInteger(timeout) || timeout <= 0) {
            return Promise.reject(new TypeError('Logger shutdown timeout must be a positive integer'));
        }
        if (this.state === 'UNINITIALIZED') {
            this.state = 'CLOSED';
            this.shutdownPromise = Promise.resolve();
            return this.shutdownPromise;
        }
        if (this.state === 'CLOSED') {
            return Promise.resolve();
        }

        this.state = 'CLOSING';
        const runtime = this.runtime!;
        this.shutdownPromise = shutdownWinstonLogger(runtime.logger, runtime.transports, timeout).finally(() => {
            try {
                // Winston 的异常处理器是进程级资源；仅结束传输不会自动移除这两个监听器。
                runtime.logger.exceptions.unhandle();
                runtime.logger.rejections.unhandle();
            } finally {
                this.state = 'CLOSED';
            }
        });
        return this.shutdownPromise;
    }
}

const defaultFactory = new LoggerFactoryRuntime();

/** 提供进程级日志入口，使业务模块共享一次初始化和统一的关闭流程。 */
export class LoggerFactory {
    private constructor() {}

    /**
     * 初始化默认进程级日志工厂，重复调用不会切换已经生效的配置。
     *
     * @param source 显式配置对象或配置文件路径。
     * @returns 无返回值。
     * @throws {LoggerLifecycleError} 当默认工厂正在关闭或已经关闭时抛出。
     * @throws {LoggerConfigError} 当配置来源或配置内容无效时由加载链路抛出。
     */
    static init(source?: string | LoggerConfig): void {
        defaultFactory.init(source);
    }

    /**
     * 获取默认工厂中的命名日志器，让业务模块共享统一配置和传输资源。
     *
     * @param name 业务模块使用的日志器名称。
     * @returns 与规范化名称对应的日志器实例。
     * @throws {TypeError} 当名称不是非空字符串时抛出。
     * @throws {LoggerLifecycleError} 当默认工厂正在关闭或已经关闭时抛出。
     * @throws {LoggerConfigError} 当延迟初始化读取到无效配置时由加载链路抛出。
     */
    static getLogger(name: string): LoggerInterface {
        return defaultFactory.getLogger(name);
    }

    /**
     * 关闭默认日志工厂，便于应用在退出前显式等待日志刷新。
     *
     * @param options 关闭等待时间配置。
     * @returns 默认工厂完成关闭后的 Promise。
     * @throws 返回的 Promise 会在超时无效、刷新超时或底层流失败时拒绝。
     */
    static shutdown(options?: ShutdownOptions): Promise<void> {
        return defaultFactory.shutdown(options);
    }
}
