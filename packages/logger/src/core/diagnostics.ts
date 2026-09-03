/**
 * 日志主链路失败时通过独立诊断通道报告错误类型，避免递归调用日志器。
 *
 * @param code 稳定的日志库诊断代码。
 * @param errorType 不包含原始异常内容的错误类型名称。
 * @returns 无返回值。
 * @throws 实现可以在诊断通道写入失败时抛出异常。
 */
export type DiagnosticWriter = (code: string, errorType: string) => void;

function safeErrorType(errorType: string): string {
    // 正则说明：否定字符类保留字母、数字、下划线、点和连字符，g 标志替换全部其他字符，防止诊断名称注入空白或控制字符。
    const normalized = errorType.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return normalized || 'UnknownError';
}

/**
 * 默认诊断直接写入标准错误流，使日志传输故障仍能被进程管理平台观察到。
 *
 * @param code 稳定的日志库诊断代码。
 * @param errorType 已清理的错误类型名称。
 * @returns 无返回值。
 * @throws 当进程标准错误流同步写入失败时透传异常。
 */
export const defaultDiagnosticWriter: DiagnosticWriter = (code, errorType) => {
    process.stderr.write(`[${code}] ${safeErrorType(errorType)}\n`);
};

/**
 * 诊断信息只暴露稳定的错误类型，避免把可能含敏感数据的原始异常写入兜底通道。
 *
 * @param error 待归类的未知异常值。
 * @returns Error 实例名称；其他值返回 UnknownError。
 * @throws 不主动抛出异常。
 */
export function diagnosticErrorType(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError';
}
