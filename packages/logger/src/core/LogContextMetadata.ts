/** 仅在 logger 内部传递调用时捕获的上下文；Symbol 不会进入 JSON 输出。 */
export const LOG_CONTEXT_SYMBOL = Symbol.for('@jintianxiayu/logger/log-context');

export interface CapturedLogContext {
    captured: true;
    traceId?: string;
}

export interface LogContextMetadata {
    [LOG_CONTEXT_SYMBOL]?: CapturedLogContext;
}

export function readLogContext(value: unknown): CapturedLogContext | undefined {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    const context = (value as LogContextMetadata)[LOG_CONTEXT_SYMBOL];
    if (context?.captured !== true) return undefined;
    if (context.traceId !== undefined && typeof context.traceId !== 'string') return undefined;
    return context;
}
