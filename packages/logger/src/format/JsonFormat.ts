import type { SafeLogEvent } from '../core/model';
import type { SerializationDiagnostic } from './PlainFormat';

/**
 * 将安全日志事件渲染为单行 JSON，供日志采集系统稳定解析并在异常元数据上安全降级。
 *
 * @param event 已规范化和脱敏的日志事件。
 * @param onError 可选的独立序列化诊断回调。
 * @returns 可直接交给传输层的单行 JSON。
 * @throws 不主动抛出异常；元数据序列化错误会被捕获并降级。
 */
export function renderJson(event: SafeLogEvent, onError?: SerializationDiagnostic): string {
    /** JSON 输出映射中 K 为稳定日志字段名，V 为已规范化和脱敏、可供采集系统解析的字段值。 */
    const output: Record<string, unknown> = {
        timestamp: event.timestamp,
        level: event.level,
        name: event.name,
        message: event.message,
    };
    if (event.traceId !== undefined) {
        output.traceId = event.traceId;
    }
    if (event.logPosition !== undefined) {
        output.logPosition = event.logPosition;
    }
    if (event.meta !== undefined) {
        output.meta = event.meta;
    }

    try {
        return JSON.stringify(output);
    } catch (error) {
        // 降级时只替换可能不可序列化的元数据，保留检索日志所需的时间、级别、名称与消息。
        onError?.(error instanceof Error ? error.name : 'UnknownError');
        output.meta = { serializationError: '[Unserializable metadata]' };
        return JSON.stringify(output);
    }
}
