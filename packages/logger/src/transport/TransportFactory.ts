import { existsSync, unlinkSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import {
    LOGGER_PROFILE,
    type EffectiveFileConfig,
    type EffectiveLoggerProfile,
    type NormalizedLoggerConfig,
    type SafeLogEvent,
} from '../core/model';
import { LoggerConfigError } from '../core/errors';
import type { DiagnosticWriter } from '../core/diagnostics';
import { compilePlainPattern, type CompiledPlainPattern } from '../format/PlainFormat';
import { renderJson } from '../format/JsonFormat';

const MESSAGE = Symbol.for('message');

/** Windows 轮转删除可能受仍打开的文件流阻塞，因此在流关闭后补偿重试待删除文件。 */
class ReliableDailyRotateFile extends DailyRotateFile {
    private readonly pendingRemovalPaths = new Set<string>();

    /**
     * 监听轮转删除事件并记录可能需要补偿的路径，确保保留期策略最终生效。
     *
     * @param options Winston 每日轮转文件传输配置。
     * @returns 新的可靠轮转文件传输实例。
     * @throws 当 DailyRotateFile 无法使用给定配置初始化时透传异常。
     */
    constructor(options: DailyRotateFile.DailyRotateFileTransportOptions) {
        super(options);
        this.on('logRemoved', (entry: unknown) => {
            const removedPath =
                typeof entry === 'string'
                    ? entry
                    : entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
                      ? (entry as { name: string }).name
                      : undefined;
            if (removedPath) {
                this.pendingRemovalPaths.add(resolve(removedPath));
            }
        });
        // Windows 可能在轮转流关闭前拒绝删除旧文件，关闭后重试可兑现保留期配置。
        this.logStream.once('close', () => this.retryPendingRemovals());
    }

    /**
     * 在文件流关闭后重试受锁阻塞的旧日志删除，并限制目标始终位于日志目录内。
     *
     * @returns 无返回值。
     * @throws 不主动抛出异常；删除失败会通过传输 error 事件上报。
     */
    private retryPendingRemovals(): void {
        const root = resolve(this.dirname);
        for (const pendingPath of this.pendingRemovalPaths) {
            const relativePath = relative(root, pendingPath);
            if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
                continue;
            }
            try {
                if (existsSync(pendingPath)) {
                    unlinkSync(pendingPath);
                }
            } catch (error) {
                this.emit('error', error);
            }
        }
        this.pendingRemovalPaths.clear();
    }
}

/** Winston 格式管线需要携带路由策略和可选异常栈，因此扩展其信息对象供内部安全收窄。 */
type RoutedInfo = winston.Logform.TransformableInfo & {
    [LOGGER_PROFILE]?: EffectiveLoggerProfile;
    timestamp?: unknown;
    name?: unknown;
    traceId?: unknown;
    logPosition?: unknown;
    meta?: unknown;
    stack?: unknown;
};

interface FileSink {
    readonly key: string;
    readonly targetKey: string;
    readonly config: EffectiveFileConfig;
}

/** 日志工厂关闭时需要同时访问 Winston 实例和传输列表，因此将两者作为只读运行时快照返回。 */
export interface WinstonRuntime {
    readonly logger: winston.Logger;
    readonly transports: readonly winston.transport[];
}

/**
 * 确保轮转文件名包含日期占位符，同时保留调用方指定的扩展名位置。
 *
 * @param filename 用户配置的文件名。
 * @returns 可交给 DailyRotateFile 的轮转文件名。
 * @throws 不主动抛出异常。
 */
function rotatingFilename(filename: string): string {
    if (filename.includes('%DATE%')) {
        return filename;
    }
    const extension = extname(filename);
    if (!extension) {
        return `${filename}-%DATE%`;
    }
    return `${filename.slice(0, -extension.length)}-%DATE%${extension}`;
}

/**
 * 为轮转设置生成稳定标识，使多个命名日志器可以安全复用完全相同的文件目标。
 *
 * @param file 已归一化的文件传输配置。
 * @returns 覆盖物理目标和轮转策略的稳定键。
 * @throws 不主动抛出异常。
 */
export function fileSinkKey(file: EffectiveFileConfig): string {
    return JSON.stringify([
        file.dirname,
        rotatingFilename(file.filename),
        file.datePattern,
        file.maxSize,
        file.maxFiles,
    ]);
}

function fileTargetKey(file: EffectiveFileConfig): string {
    return JSON.stringify([file.dirname, rotatingFilename(file.filename)]);
}

function collectProfiles(config: NormalizedLoggerConfig): readonly EffectiveLoggerProfile[] {
    return [config.root, ...config.loggers.values()];
}

/**
 * 汇总可复用文件目标并拒绝冲突策略，避免多个传输争用同一物理文件。
 *
 * @param config 已归一化的完整日志配置。
 * @returns 去重后的文件输出目标列表。
 * @throws {LoggerConfigError} 当同一目标使用冲突的轮转设置或输出格式时抛出。
 */
function collectFileSinks(config: NormalizedLoggerConfig): readonly FileSink[] {
    /** 文件传输映射中 K 为完整轮转策略键，V 为可复用的物理文件输出定义。 */
    const sinks = new Map<string, FileSink>();
    /** 目标约束映射中 K 为物理目录与文件名，V 为该目标唯一允许的轮转键和输出格式。 */
    const targetSettings = new Map<string, { key: string; format: string }>();

    for (const profile of collectProfiles(config)) {
        if (!profile.file.enabled) {
            continue;
        }
        const key = fileSinkKey(profile.file);
        const targetKey = fileTargetKey(profile.file);
        const existingTarget = targetSettings.get(targetKey);
        // 同一路径若采用不同轮转或格式策略会互相争抢文件，必须在创建传输前拒绝配置。
        if (existingTarget && existingTarget.key !== key) {
            throw new LoggerConfigError('A log file target cannot use conflicting rotation settings');
        }
        if (existingTarget && existingTarget.format !== profile.file.format) {
            throw new LoggerConfigError('A log file target cannot mix plain and JSON formats');
        }
        targetSettings.set(targetKey, { key, format: profile.file.format });
        if (!sinks.has(key)) {
            sinks.set(key, { key, targetKey, config: profile.file });
        }
    }
    return [...sinks.values()];
}

function eventProfile(info: RoutedInfo, root: EffectiveLoggerProfile): EffectiveLoggerProfile {
    return info[LOGGER_PROFILE] ?? root;
}

/**
 * 将 Winston 的宽松信息对象收窄为渲染器契约，避免异常处理器字段绕过统一格式。
 *
 * @param info Winston 格式管线传入的日志信息。
 * @returns 字段已收窄并补齐安全默认值的日志事件。
 * @throws 不主动抛出异常。
 */
function toSafeEvent(info: RoutedInfo): SafeLogEvent {
    const timestamp = typeof info.timestamp === 'string' ? info.timestamp : new Date().toISOString();
    const level =
        info.level === 'debug' || info.level === 'info' || info.level === 'warn' || info.level === 'error'
            ? info.level
            : 'error';
    const message = typeof info.message === 'string' ? info.message : String(info.message ?? '');
    const name = typeof info.name === 'string' && info.name.length > 0 ? info.name : 'root';
    const traceId = typeof info.traceId === 'string' && info.traceId.length > 0 ? info.traceId : undefined;
    const logPosition = typeof info.logPosition === 'string' ? info.logPosition : undefined;
    const exceptionMeta =
        typeof info.stack === 'string' ? { error: { name: 'Error', message, stack: info.stack } } : undefined;
    const meta = info.meta ?? exceptionMeta;

    return {
        timestamp,
        level,
        name,
        message,
        ...(traceId !== undefined ? { traceId } : {}),
        ...(logPosition !== undefined ? { logPosition } : {}),
        ...(meta !== undefined ? { meta } : {}),
    };
}

/**
 * 创建控制台路由格式器，使共享 Winston 实例可以按命名日志器策略筛选和渲染。
 *
 * @param root 未携带命名策略时使用的根日志器配置。
 * @param consolePatterns 控制台模板映射；K 为完整日志器策略对象，V 为该策略预编译的纯文本模板。
 * @param diagnostics 独立于主日志链路的诊断写入器。
 * @returns 可交给 Winston Console 传输的格式器。
 * @throws 当 Winston 无法创建格式器时透传异常。
 */
function consoleRoutingFormat(
    root: EffectiveLoggerProfile,
    consolePatterns: ReadonlyMap<EffectiveLoggerProfile, CompiledPlainPattern>,
    diagnostics: DiagnosticWriter
): winston.Logform.Format {
    return winston.format((rawInfo) => {
        const info = rawInfo as RoutedInfo;
        const profile = eventProfile(info, root);
        // 所有命名日志器共享 Winston 实例，格式器返回 false 才能在传输层按各自配置完成路由。
        if (!profile.console.enabled) {
            return false;
        }

        const event = toSafeEvent(info);
        const message =
            profile.console.format === 'json'
                ? renderJson(event, (type) => diagnostics('LOGGER_SERIALIZATION_FAILED', type))
                : consolePatterns.get(profile)!.render(event, {
                      colors: profile.console.colors,
                      onError: (type) => diagnostics('LOGGER_SERIALIZATION_FAILED', type),
                  });
        (info as unknown as Record<symbol, unknown>)[MESSAGE] = message;
        return info;
    })();
}

/**
 * 创建单个文件目标的路由格式器，阻止其他命名日志器写入不属于自己的文件。
 *
 * @param root 未携带命名策略时使用的根日志器配置。
 * @param sink 当前格式器负责的文件输出目标。
 * @param filePatterns 文件模板映射；K 为完整日志器策略对象，V 为该策略预编译的纯文本模板。
 * @param diagnostics 独立于主日志链路的诊断写入器。
 * @returns 可交给对应文件传输的 Winston 格式器。
 * @throws 当 Winston 无法创建格式器时透传异常。
 */
function fileRoutingFormat(
    root: EffectiveLoggerProfile,
    sink: FileSink,
    filePatterns: ReadonlyMap<EffectiveLoggerProfile, CompiledPlainPattern>,
    diagnostics: DiagnosticWriter
): winston.Logform.Format {
    return winston.format((rawInfo) => {
        const info = rawInfo as RoutedInfo;
        const profile = eventProfile(info, root);
        if (!profile.file.enabled || fileSinkKey(profile.file) !== sink.key) {
            return false;
        }

        const event = toSafeEvent(info);
        const message =
            profile.file.format === 'json'
                ? renderJson(event, (type) => diagnostics('LOGGER_SERIALIZATION_FAILED', type))
                : filePatterns.get(profile)!.render(event, {
                      colors: false,
                      onError: (type) => diagnostics('LOGGER_SERIALIZATION_FAILED', type),
                  });
        (info as unknown as Record<symbol, unknown>)[MESSAGE] = message;
        return info;
    })();
}

/**
 * 创建共享 Winston 运行时，避免每个命名日志器重复占用文件句柄并分散进程错误处理。
 *
 * 详细设计：
 * 1. 汇总根与命名日志器策略，先校验并去重文件目标，再为使用纯文本格式的策略预编译模板。
 * 2. 控制台只创建一个共享传输；文件按完整轮转键各创建一个传输，格式器依据隐藏的日志器策略完成逐条路由。
 * 3. 只有根传输接管进程级异常和拒绝，所有 logger/transport 错误统一转入独立诊断通道，避免递归写日志。
 * 4. 返回冻结的传输快照供关闭流程同时观察 Winston finish 与底层文件流 close。
 *
 * @param config 已校验和归一化的完整日志配置。
 * @param diagnostics 独立于主日志链路的诊断写入器。
 * @returns 包含 Winston 日志器与只读传输列表的运行时快照。
 * @throws {LoggerConfigError} 当文件目标使用冲突策略时抛出。
 * @throws 当 Winston 或文件传输无法按配置初始化时透传异常。
 */
export function createWinstonRuntime(config: NormalizedLoggerConfig, diagnostics: DiagnosticWriter): WinstonRuntime {
    const profiles = collectProfiles(config);
    const fileSinks = collectFileSinks(config);
    /** 控制台模板映射中 K 为完整日志器策略对象，V 为该策略预编译的纯文本模板。 */
    const consolePatterns = new Map<EffectiveLoggerProfile, CompiledPlainPattern>();
    /** 文件模板映射中 K 为完整日志器策略对象，V 为该策略预编译的纯文本模板。 */
    const filePatterns = new Map<EffectiveLoggerProfile, CompiledPlainPattern>();
    for (const profile of profiles) {
        if (profile.console.format === 'plain') {
            consolePatterns.set(profile, compilePlainPattern(profile.console.pattern));
        }
        if (profile.file.format === 'plain') {
            filePatterns.set(profile, compilePlainPattern(profile.file.pattern));
        }
    }

    const createdTransports: winston.transport[] = [];
    if (profiles.some((profile) => profile.console.enabled)) {
        createdTransports.push(
            new winston.transports.Console({
                level: 'debug',
                format: consoleRoutingFormat(config.root, consolePatterns, diagnostics),
                handleExceptions: config.root.console.enabled && config.processErrors.uncaughtException,
                handleRejections: config.root.console.enabled && config.processErrors.unhandledRejection,
            })
        );
    }

    const rootFileKey = config.root.file.enabled ? fileSinkKey(config.root.file) : undefined;
    for (const sink of fileSinks) {
        const filename = rotatingFilename(sink.config.filename);
        // 正则说明：否定字符类保留跨平台安全的字母、数字、下划线、点和连字符，g 标志替换文件名中的全部其他字符，避免审计文件路径包含分隔符或控制字符。
        const auditName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
        createdTransports.push(
            new ReliableDailyRotateFile({
                level: 'debug',
                dirname: sink.config.dirname,
                filename,
                datePattern: sink.config.datePattern,
                maxSize: sink.config.maxSize,
                maxFiles: sink.config.maxFiles,
                auditFile: `${sink.config.dirname}/.${auditName}-audit.json`,
                format: fileRoutingFormat(config.root, sink, filePatterns, diagnostics),
                handleExceptions: sink.key === rootFileKey && config.processErrors.uncaughtException,
                handleRejections: sink.key === rootFileKey && config.processErrors.unhandledRejection,
            })
        );
    }

    for (const transport of createdTransports) {
        transport.on('error', (error: unknown) => {
            diagnostics('LOGGER_TRANSPORT_ERROR', error instanceof Error ? error.name : 'UnknownError');
        });
    }

    const logger = winston.createLogger({
        level: 'debug',
        transports: createdTransports,
        exitOnError: config.processErrors.exitOnError,
    });
    logger.on('error', (error: unknown) => {
        diagnostics('LOGGER_ERROR', error instanceof Error ? error.name : 'UnknownError');
    });

    return Object.freeze({
        logger,
        transports: Object.freeze([...createdTransports]),
    });
}
