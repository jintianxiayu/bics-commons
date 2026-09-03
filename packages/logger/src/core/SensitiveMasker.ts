import type { EffectiveMaskingConfig } from './model';
import { LoggerConfigError } from './errors';

const FULL_MASK = '********';

type TemplateSegment =
    | { readonly kind: 'literal'; readonly value: string }
    | { readonly kind: 'first' | 'last'; readonly count: number }
    | { readonly kind: 'domain' };

type MaskPolicy = (value: unknown) => string;

/** 高频递归脱敏共享一次构造完成的不可变策略快照。 */
interface MaskingRuntime {
    readonly policies: ReadonlyMap<string, MaskPolicy>;
    readonly enabled: boolean;
}

const COMPLETE_FIELDS = [
    'password',
    'passwd',
    'pwd',
    'token',
    'accessToken',
    'refreshToken',
    'apiKey',
    'api_key',
    'secretKey',
    'clientSecret',
    'authorization',
    'auth',
    'cookie',
    'set-cookie',
] as const;

const LAST_FOUR_FIELDS = [
    'phone',
    'mobile',
    'mobileNo',
    'creditCard',
    'cardNo',
    'bankAccount',
    'idCard',
    'idNumber',
] as const;

function normalizeFieldName(field: string): string {
    return field.toLowerCase();
}

/**
 * 只允许稳定的原始值参与局部保留掩码，复杂对象统一改为完整掩码以避免泄露。
 *
 * @param value 待转换的敏感字段值。
 * @returns 可参与掩码计算的字符串；复杂值返回 undefined。
 * @throws 不主动抛出异常。
 */
function valueToMaskableString(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return String(value);
    }
    return undefined;
}

/**
 * 保留可识别号码的末四位，同时对过短值完整遮盖以防止反推原值。
 *
 * @param value 待脱敏的号码类字段值。
 * @returns 末四位可见的掩码文本或完整掩码。
 * @throws 不主动抛出异常。
 */
function maskLastFour(value: unknown): string {
    const text = valueToMaskableString(value);
    if (!text || text.length <= 4) {
        return FULL_MASK;
    }
    return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

/**
 * 仅保留邮箱前缀的最少字符和域名，兼顾排查归属与个人信息保护。
 *
 * @param value 待脱敏的邮箱字段值。
 * @returns 局部可见的邮箱掩码或完整掩码。
 * @throws 不主动抛出异常。
 */
function maskEmail(value: unknown): string {
    const text = valueToMaskableString(value);
    if (!text) {
        return FULL_MASK;
    }

    const separator = text.lastIndexOf('@');
    if (separator <= 2 || separator === text.length - 1) {
        return FULL_MASK;
    }
    return `${text.slice(0, 2)}***@${text.slice(separator + 1)}`;
}

/**
 * 将用户脱敏模板拆分为受支持的静态和动态片段，防止未知令牌静默泄露原值。
 *
 * @param template 用户配置的脱敏模板。
 * @returns 冻结后的模板片段列表。
 * @throws {LoggerConfigError} 当模板为空、令牌无效或包含未知括号表达式时抛出。
 */
function parseTemplate(template: string): readonly TemplateSegment[] {
    if (template.length === 0) {
        throw new LoggerConfigError('Masking template must not be empty');
    }

    const segments: TemplateSegment[] = [];
    // 正则说明：第一个分支匹配 {firstN}/{lastN}，捕获策略名和正整数位数；第二个分支匹配固定 {domain}；g 标志按出现顺序扫描全部令牌以保留模板片段顺序。
    const tokenPattern = /\{(first|last)(\d+)\}|\{domain\}/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(template)) !== null) {
        if (match.index > cursor) {
            segments.push({
                kind: 'literal',
                value: template.slice(cursor, match.index),
            });
        }

        if (match[0] === '{domain}') {
            segments.push({ kind: 'domain' });
        } else {
            const count = Number(match[2]);
            if (!Number.isSafeInteger(count) || count <= 0) {
                throw new LoggerConfigError(`Invalid masking token: ${match[0]}`);
            }
            segments.push({ kind: match[1] as 'first' | 'last', count });
        }
        cursor = tokenPattern.lastIndex;
    }

    if (cursor < template.length) {
        segments.push({ kind: 'literal', value: template.slice(cursor) });
    }

    const unparsed = segments
        .filter((segment): segment is Extract<TemplateSegment, { kind: 'literal' }> => segment.kind === 'literal')
        .map((segment) => segment.value)
        .join('');
    // 正则只识别合法令牌，额外检查括号可阻止拼写错误被当作普通文本并泄露原值。
    if (unparsed.includes('{') || unparsed.includes('}')) {
        throw new LoggerConfigError(`Unknown masking token in template: ${template}`);
    }

    return Object.freeze(segments);
}

/**
 * 预编译脱敏模板为字段策略，避免高频日志写入时重复解析配置。
 *
 * @param template 已配置的脱敏模板。
 * @returns 可复用的字段掩码函数。
 * @throws {LoggerConfigError} 当模板语法无效时抛出。
 */
function compileTemplate(template: string): MaskPolicy {
    const segments = parseTemplate(template);
    const hasDynamicSegment = segments.some((segment) => segment.kind !== 'literal');

    return (value: unknown): string => {
        if (!hasDynamicSegment) {
            return template;
        }

        const text = valueToMaskableString(value);
        if (!text) {
            return FULL_MASK;
        }

        const emailSeparator = text.lastIndexOf('@');
        const rendered: string[] = [];

        for (const segment of segments) {
            if (segment.kind === 'literal') {
                rendered.push(segment.value);
                continue;
            }
            if (segment.kind === 'domain') {
                if (emailSeparator <= 0 || emailSeparator === text.length - 1) {
                    return FULL_MASK;
                }
                rendered.push(text.slice(emailSeparator + 1));
                continue;
            }
            if (text.length <= segment.count) {
                return FULL_MASK;
            }
            rendered.push(segment.kind === 'first' ? text.slice(0, segment.count) : text.slice(-segment.count));
        }
        return rendered.join('');
    };
}

/**
 * 在应用启动阶段验证脱敏模板，避免首条敏感日志到来时才暴露配置错误。
 *
 * @param template 待验证的脱敏模板。
 * @returns 无返回值。
 * @throws {LoggerConfigError} 当模板语法无效时抛出。
 */
export function validateMaskTemplate(template: string): void {
    compileTemplate(template);
}

/**
 * 递归复制并按字段策略替换敏感值，保证原业务对象不被日志处理修改。
 *
 * @param value 当前待复制和脱敏的值。
 * @param runtime 已编译策略及是否启用掩码的不可变运行时配置。
 * @param ancestors 当前递归路径上的对象集合。
 * @returns 完成复制、循环降级和字段脱敏后的值。
 * @throws 当业务对象的属性读取或数组遍历自身抛出异常时透传。
 */
function cloneValue(value: unknown, runtime: MaskingRuntime, ancestors: WeakSet<object>): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (ancestors.has(value)) {
        return '[Circular]';
    }

    // 仅跟踪当前递归链可以截断循环引用，同时保留跨分支复用对象的完整结构。
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item) => cloneValue(item, runtime, ancestors));
        }

        /** 脱敏结果映射中 K 为原始字段名，V 为已应用掩码或递归复制后的安全值。 */
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            const policy = runtime.enabled ? runtime.policies.get(normalizeFieldName(key)) : undefined;
            const propertyValue = (value as Record<string, unknown>)[key];
            result[key] = policy ? policy(propertyValue) : cloneValue(propertyValue, runtime, ancestors);
        }
        return result;
    } finally {
        ancestors.delete(value);
    }
}

/** 在日志离开进程前递归复制并脱敏元数据，避免修改业务对象或泄露敏感字段。 */
export class SensitiveMasker {
    private readonly runtime: MaskingRuntime;

    /**
     * 合并内置敏感字段与业务自定义模板，建立大小写无关的字段策略表。
     *
     * @param config 已校验并冻结的脱敏配置。
     * @returns 新的脱敏器实例。
     * @throws {LoggerConfigError} 当自定义模板无法编译时抛出。
     */
    constructor(config: EffectiveMaskingConfig) {
        /** 可变构建映射中 K 为小写字段名，V 为编译中的掩码函数；构造完成后以只读接口保存。 */
        const policies = new Map<string, MaskPolicy>();
        for (const field of COMPLETE_FIELDS) {
            policies.set(normalizeFieldName(field), () => FULL_MASK);
        }
        for (const field of LAST_FOUR_FIELDS) {
            policies.set(normalizeFieldName(field), maskLastFour);
        }
        policies.set('email', maskEmail);

        for (const [field, template] of Object.entries(config.fields)) {
            policies.set(normalizeFieldName(field), compileTemplate(template));
        }
        this.runtime = Object.freeze({
            policies,
            enabled: config.enabled,
        });
    }

    /**
     * 生成业务元数据的脱敏副本，使后续格式化不会接触原始敏感值。
     *
     * @param value 待处理的业务元数据。
     * @returns 完成递归复制和字段脱敏后的值。
     * @throws 当业务对象的属性读取或遍历自身抛出异常时透传。
     */
    mask(value: unknown): unknown {
        return cloneValue(value, this.runtime, new WeakSet<object>());
    }
}
