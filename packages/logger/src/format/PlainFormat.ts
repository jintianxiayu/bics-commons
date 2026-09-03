import type { SafeLogEvent } from '../core/model';
import { LoggerConfigError } from '../core/errors';

const SUPPORTED_PLACEHOLDERS = new Set(['timestamp', 'level', 'name', 'traceId', 'log_position', 'message', 'meta']);

type PatternPart =
    | { readonly kind: 'literal'; readonly value: string }
    | { readonly kind: 'placeholder'; readonly value: string };

/**
 * 渲染失败通过独立诊断回调上报，避免格式化器再次调用日志器形成递归。
 *
 * @param errorType 不包含原始异常内容的错误类型名称。
 * @returns 无返回值。
 * @throws 回调实现可以在诊断通道写入失败时抛出异常。
 */
export type SerializationDiagnostic = (errorType: string) => void;

/**
 * 将元数据序列化失败降级为稳定占位对象，避免纯文本日志整条丢失。
 *
 * @param meta 已规范化和脱敏的日志元数据。
 * @param onError 可选的独立序列化诊断回调。
 * @returns JSON 文本或不可序列化占位文本。
 * @throws 不主动抛出异常；序列化错误会被捕获并降级。
 */
function safeMetaJson(meta: unknown, onError?: SerializationDiagnostic): string {
    try {
        return JSON.stringify(meta);
    } catch (error) {
        onError?.(error instanceof Error ? error.name : 'UnknownError');
        return JSON.stringify({ serializationError: '[Unserializable metadata]' });
    }
}

/**
 * 仅为已知日志级别添加 ANSI 颜色，避免未知级别产生不可预测的终端控制码。
 *
 * @param level 待呈现的日志级别。
 * @returns 带颜色控制码的已知级别或原始级别文本。
 * @throws 不主动抛出异常。
 */
function colorizeLevel(level: string): string {
    /** 颜色映射中 K 为支持的日志级别，V 为该级别对应的 ANSI 前景色代码。 */
    const colors: Readonly<Record<string, number>> = {
        debug: 36,
        info: 32,
        warn: 33,
        error: 31,
    };
    const color = colors[level];
    return color ? `\u001b[${color}m${level}\u001b[39m` : level;
}

/** 预编译后的纯文本模板可被高频日志写入复用，避免每次输出都重新解析占位符。 */
export interface CompiledPlainPattern {
    readonly usesLogPosition: boolean;
    /**
     * 使用已编译片段渲染单条安全日志事件，避免写入时再次解析模板。
     *
     * @param event 已规范化和脱敏的日志事件。
     * @param options 颜色策略和可选的独立序列化诊断回调。
     * @returns 可直接交给传输层的纯文本日志。
     * @throws 不主动抛出异常；元数据序列化错误会被降级。
     */
    render(event: SafeLogEvent, options: PlainRenderOptions): string;
}

/** 纯文本渲染行为集中在具名选项中，避免调用点出现语义不明的布尔参数。 */
export interface PlainRenderOptions {
    readonly colors: boolean;
    readonly onError?: SerializationDiagnostic;
}

/**
 * 启动时校验并编译纯文本模板，使占位符错误在业务流量进入前即可被发现。
 *
 * 详细设计：
 * 1. 使用全局令牌正则按顺序切分字面量和占位符，并在切分时拒绝不受支持的字段名称。
 * 2. 扫描剩余字面量中的 `%{`，补足正则无法识别未闭合占位符的边界，确保错误模板不会静默通过。
 * 3. 预计算是否消费调用位置，并返回基于不可变片段的渲染器；写入时只映射字段和拼接文本，不再解析模板。
 *
 * @param pattern 用户配置的纯文本日志模板。
 * @returns 可在高频写入中复用的已编译模板。
 * @throws {LoggerConfigError} 当模板为空、占位符未知或语法未闭合时抛出。
 */
export function compilePlainPattern(pattern: string): CompiledPlainPattern {
    if (pattern.length === 0) {
        throw new LoggerConfigError('Plain pattern must not be empty');
    }

    const parts: PatternPart[] = [];
    // 正则说明：%\{ 和 \} 匹配字面量边界；([^}]+) 捕获至少一个非右花括号字符作为占位符名；g 标志按模板顺序扫描全部占位符并保留中间字面量。
    const tokenPattern = /%\{([^}]+)\}/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(pattern)) !== null) {
        if (match.index > cursor) {
            parts.push({
                kind: 'literal',
                value: pattern.slice(cursor, match.index),
            });
        }
        const placeholder = match[1];
        if (!placeholder || !SUPPORTED_PLACEHOLDERS.has(placeholder)) {
            throw new LoggerConfigError(`Unknown plain pattern placeholder: ${placeholder ?? ''}`);
        }
        parts.push({ kind: 'placeholder', value: placeholder });
        cursor = tokenPattern.lastIndex;
    }

    if (cursor < pattern.length) {
        parts.push({ kind: 'literal', value: pattern.slice(cursor) });
    }
    const literalRemainder = parts
        .filter((part): part is Extract<PatternPart, { kind: 'literal' }> => part.kind === 'literal')
        .map((part) => part.value)
        .join('');
    // 未闭合的占位符不会被正则捕获，单独检查可防止错误模板被静默当作普通文本。
    if (literalRemainder.includes('%{')) {
        throw new LoggerConfigError(`Malformed plain pattern: ${pattern}`);
    }

    const usesLogPosition = parts.some((part) => part.kind === 'placeholder' && part.value === 'log_position');

    return Object.freeze({
        usesLogPosition,
        /**
         * 按预编译片段拼接日志字段，确保每个传输遵循自己的模板和颜色策略。
         *
         * @param event 已规范化和脱敏的日志事件。
         * @param options 颜色策略和可选的独立序列化诊断回调。
         * @returns 完成占位符替换的纯文本日志。
         * @throws 不主动抛出异常；元数据序列化错误会被降级。
         */
        render(event: SafeLogEvent, options: PlainRenderOptions): string {
            return parts
                .map((part) => {
                    if (part.kind === 'literal') {
                        return part.value;
                    }
                    switch (part.value) {
                        case 'timestamp':
                            return event.timestamp;
                        case 'level':
                            return options.colors ? colorizeLevel(event.level) : event.level;
                        case 'name':
                            return event.name;
                        case 'traceId':
                            return event.traceId ?? '-';
                        case 'log_position':
                            return event.logPosition ?? '-';
                        case 'message':
                            return event.message;
                        case 'meta':
                            return event.meta === undefined ? '-' : safeMetaJson(event.meta, options.onError);
                        default:
                            return '-';
                    }
                })
                .join('');
        },
    });
}

/**
 * 配置加载阶段复用编译规则验证模板，保证实际渲染时使用同一套语法约束。
 *
 * @param pattern 待验证的纯文本日志模板。
 * @returns 无返回值。
 * @throws {LoggerConfigError} 当模板为空、占位符未知或语法未闭合时抛出。
 */
export function validatePlainPattern(pattern: string): void {
    compilePlainPattern(pattern);
}
