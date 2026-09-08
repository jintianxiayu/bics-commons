import { LoggerFactory, type LoggerInterface } from '@jintianxiayu/logger';

const LOCK_LOGGER_NAME = '@jintianxiayu/lock-decorator';

export type LockLogEvent =
    | 'lock.acquire_started'
    | 'lock.acquire_retry'
    | 'lock.acquired'
    | 'lock.watchdog_started'
    | 'lock.watchdog_skipped'
    | 'lock.renewed'
    | 'lock.execution_started'
    | 'lock.execution_completed'
    | 'lock.release_started'
    | 'lock.released'
    | 'lock.acquire_exhausted'
    | 'lock.ownership_lost'
    | 'lock.operation_failed';

type LockLogLevel = 'debug' | 'warn' | 'error';

interface LockLogDefinition {
    readonly level: LockLogLevel;
    readonly message: string;
}

/** 分布式锁日志只接受稳定的编排字段，避免锁标识、token 与业务数据进入输出。 */
export interface LockLogContext {
    readonly className?: string;
    readonly methodName?: string;
    readonly attempt?: number;
    readonly maxAttempts?: number;
    readonly ttlMs?: number;
    readonly renewIntervalMs?: number;
    readonly retryDelayMs?: number;
    readonly durationMs?: number;
    readonly operation?: 'provider_resolution' | 'key_resolution' | 'acquire' | 'renew' | 'release';
    readonly phase?: 'renew' | 'release';
    readonly reason?: 'resolver_error' | 'watchdog_disabled';
    readonly outcome?: 'success' | 'business_error';
    readonly error?: unknown;
}

const LOCK_LOG_CONTEXT_FIELDS = [
    'className',
    'methodName',
    'attempt',
    'maxAttempts',
    'ttlMs',
    'renewIntervalMs',
    'retryDelayMs',
    'durationMs',
    'operation',
    'phase',
    'reason',
    'outcome',
    'error',
] as const satisfies readonly (keyof LockLogContext)[];

const LOCK_LOG_DEFINITIONS: Readonly<Record<LockLogEvent, LockLogDefinition>> = {
    'lock.acquire_started': { level: 'debug', message: 'Distributed lock acquisition started' },
    'lock.acquire_retry': { level: 'debug', message: 'Distributed lock acquisition retry scheduled' },
    'lock.acquired': { level: 'debug', message: 'Distributed lock acquired' },
    'lock.watchdog_started': { level: 'debug', message: 'Distributed lock watchdog started' },
    'lock.watchdog_skipped': { level: 'debug', message: 'Distributed lock watchdog skipped' },
    'lock.renewed': { level: 'debug', message: 'Distributed lock renewed' },
    'lock.execution_started': { level: 'debug', message: 'Distributed lock execution started' },
    'lock.execution_completed': { level: 'debug', message: 'Distributed lock execution completed' },
    'lock.release_started': { level: 'debug', message: 'Distributed lock release started' },
    'lock.released': { level: 'debug', message: 'Distributed lock released' },
    'lock.acquire_exhausted': { level: 'warn', message: 'Distributed lock acquisition exhausted' },
    'lock.ownership_lost': { level: 'warn', message: 'Distributed lock ownership lost' },
    'lock.operation_failed': { level: 'error', message: 'Distributed lock operation failed' },
};

let lockLogger: LoggerInterface | undefined;

function getLockLogger(): LoggerInterface {
    if (lockLogger) {
        return lockLogger;
    }
    const logger = LoggerFactory.getLogger(LOCK_LOGGER_NAME);
    lockLogger = logger;
    return logger;
}

/**
 * 从调用点上下文复制已声明字段，并由门面最终写入不可覆盖的事件名。
 * @param event 当前稳定事件名。
 * @param context 调用点提供的白名单字段。
 * @returns 可交给统一 Logger 处理的结构化元数据。
 */
function createMetadata(
    event: LockLogEvent,
    context: LockLogContext
): LockLogContext & { readonly event: LockLogEvent } {
    const metadata: LockLogContext & { readonly event: LockLogEvent } = { event };
    for (const field of LOCK_LOG_CONTEXT_FIELDS) {
        const value = context[field];
        if (value !== undefined) {
            Object.assign(metadata, { [field]: value });
        }
    }
    return metadata;
}

/**
 * 使用事件固定的 level 和 message 写日志；刻意不提供 info 分支。
 * @param logger 应用共享的 lock 命名 Logger。
 * @param definition 当前事件的固定定义。
 * @param metadata 已经过滤的锁编排元数据。
 */
function writeLockLog(
    logger: LoggerInterface,
    definition: LockLogDefinition,
    metadata: LockLogContext & { readonly event: LockLogEvent }
): void {
    if (definition.level === 'debug') {
        logger.debug(definition.message, metadata);
        return;
    }
    if (definition.level === 'warn') {
        logger.warn(definition.message, metadata);
        return;
    }
    logger.error(definition.message, metadata);
}

/**
 * 提交一条不会影响锁或业务结果的结构化日志。
 * @param event 决定固定 message 与 level 的锁事件。
 * @param context 不包含 key、token 或业务数据的锁编排上下文。
 */
export function logLockEvent(event: LockLogEvent, context: LockLogContext = {}): void {
    try {
        writeLockLog(getLockLogger(), LOCK_LOG_DEFINITIONS[event], createMetadata(event, context));
    } catch (_error) {
        return;
    }
}
