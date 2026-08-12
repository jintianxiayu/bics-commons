/** 仅在 logger 内部传递预捕获位置；Symbol 不会进入 JSON 输出。 */
export const LOG_POSITION_SYMBOL = Symbol.for('@jintianxiayu/logger/log-position');

export interface LogPositionMetadata {
    [LOG_POSITION_SYMBOL]?: string;
}

export function readLogPosition(value: unknown): string | undefined {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    const position = (value as LogPositionMetadata)[LOG_POSITION_SYMBOL];
    return typeof position === 'string' ? position : undefined;
}
