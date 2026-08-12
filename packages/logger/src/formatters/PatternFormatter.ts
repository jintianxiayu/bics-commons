import winston from 'winston';
import { LoggerContext } from '../core/LoggerContext';
import { readLogContext } from '../core/LogContextMetadata';
import { LogPosition } from '../core/LogPosition';
import { readLogPosition } from '../core/LogPositionMetadata';
import { normalizeMeta, safeStringify } from '../core/MetaSerializer';
import { createMaskingPolicy } from '../core/SensitiveMasker';

const NORMALIZATION_ONLY_POLICY = createMaskingPolicy({ enabled: false });

/**
 * Pattern 占位符解析器映射
 * 每个占位符对应一个函数，接收 winston info 对象并返回替换值
 */
const PLACEHOLDERS = {
    timestamp: (info: winston.Logform.TransformableInfo) => info.timestamp as string,
    level: (info: winston.Logform.TransformableInfo) => info.level.toUpperCase(),
    name: (info: winston.Logform.TransformableInfo) => info.label || '',
    message: (info: winston.Logform.TransformableInfo) => info.message as string,
    meta: (info: winston.Logform.TransformableInfo) => {
        const meta: Record<string, unknown> = {};
        for (const key of Object.keys(info)) {
            if (!['timestamp', 'level', 'message', 'label'].includes(key)) {
                meta[key] = info[key];
            }
        }
        const metaStr = safeStringify(normalizeMeta(meta, NORMALIZATION_ONLY_POLICY));
        return metaStr === '{}' ? '' : metaStr;
    },
};

/**
 * 创建基于 pattern 的格式化器
 * @param pattern - 格式化模板，支持 %{timestamp}, %{level}, %{name}, %{message}, %{meta}, %{log_position}
 */
export const createPatternFormatter = (pattern: string): winston.Logform.Format => {
    const needsLogPosition = pattern.includes('%{log_position}');
    const needsTraceId = pattern.includes('%{traceId}');
    return winston.format.printf((info) => {
        let result = pattern;
        for (const [key, resolver] of Object.entries(PLACEHOLDERS)) {
            const placeholder = `%{${key}}`;
            if (result.includes(placeholder)) {
                result = result.replaceAll(placeholder, resolver(info)?.toString() || '');
            }
        }
        if (needsLogPosition) {
            result = result.replaceAll('%{log_position}', readLogPosition(info) ?? LogPosition.capture());
        }
        if (needsTraceId) {
            const capturedContext = readLogContext(info);
            const traceId = capturedContext?.traceId ?? (capturedContext ? undefined : LoggerContext.get('traceId'));
            result = result.replaceAll('%{traceId}', traceId ?? '-');
        }
        return result;
    });
};
