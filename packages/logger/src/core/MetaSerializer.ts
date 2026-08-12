import type { MaskingPolicy } from './SensitiveMasker';

export type JsonSafeValue = null | boolean | number | string | JsonSafeValue[] | { [key: string]: JsonSafeValue };

export const MAX_META_DEPTH = 5;
export const CIRCULAR_PLACEHOLDER = '[Circular]';
export const MAX_DEPTH_PLACEHOLDER = '[MAX_DEPTH_EXCEEDED]';
export const INVALID_DATE_PLACEHOLDER = '[Invalid Date]';
export const PROPERTY_ACCESS_ERROR_PLACEHOLDER = '[Property Access Error]';
export const UNSERIALIZABLE_PLACEHOLDER = '[Unserializable]';
export const UNDEFINED_PLACEHOLDER = '[Undefined]';

const ERROR_STANDARD_FIELDS = new Set(['name', 'message', 'stack', 'cause']);

type ReadResult = { ok: true; value: unknown } | { ok: false };

function safeRead(target: object, key: string): ReadResult {
    try {
        return { ok: true, value: (target as Record<string, unknown>)[key] };
    } catch {
        return { ok: false };
    }
}

function safeKeys(value: object): string[] | null {
    try {
        return Object.keys(value);
    } catch {
        return null;
    }
}

function safeString(value: unknown, fallback: string): string {
    try {
        return String(value);
    } catch {
        return fallback;
    }
}

function normalizeFunction(value: object): string {
    const name = safeRead(value, 'name');
    const renderedName = name.ok && typeof name.value === 'string' && name.value !== '' ? name.value : 'anonymous';
    return `[Function: ${renderedName}]`;
}

function normalizeProperty(
    source: object,
    key: string,
    policy: MaskingPolicy,
    depth: number,
    path: Set<object>
): JsonSafeValue {
    const read = safeRead(source, key);
    if (!read.ok) return PROPERTY_ACCESS_ERROR_PLACEHOLDER;

    const masked = policy.maskField(key, read.value);
    if (masked.matched) return masked.value;
    return normalizeValue(read.value, policy, depth, path);
}

function normalizeError(error: Error, policy: MaskingPolicy, depth: number, path: Set<object>): JsonSafeValue {
    const keys = safeKeys(error);
    if (keys === null) return UNSERIALIZABLE_PLACEHOLDER;

    const result: { [key: string]: JsonSafeValue } = Object.create(null) as {
        [key: string]: JsonSafeValue;
    };
    const name = safeRead(error, 'name');
    const message = safeRead(error, 'message');
    const maskedName = name.ok ? policy.maskField('name', name.value) : null;
    const maskedMessage = message.ok ? policy.maskField('message', message.value) : null;
    result.name = !name.ok
        ? PROPERTY_ACCESS_ERROR_PLACEHOLDER
        : maskedName?.matched
          ? maskedName.value
          : safeString(name.value, UNSERIALIZABLE_PLACEHOLDER);
    result.message = !message.ok
        ? PROPERTY_ACCESS_ERROR_PLACEHOLDER
        : maskedMessage?.matched
          ? maskedMessage.value
          : safeString(message.value, UNSERIALIZABLE_PLACEHOLDER);

    const stack = safeRead(error, 'stack');
    if (!stack.ok) result.stack = PROPERTY_ACCESS_ERROR_PLACEHOLDER;
    else if (stack.value !== undefined) {
        const maskedStack = policy.maskField('stack', stack.value);
        result.stack = maskedStack.matched ? maskedStack.value : normalizeValue(stack.value, policy, depth + 1, path);
    }

    const cause = safeRead(error, 'cause');
    if (!cause.ok) result.cause = PROPERTY_ACCESS_ERROR_PLACEHOLDER;
    else if (cause.value !== undefined) {
        const maskedCause = policy.maskField('cause', cause.value);
        result.cause = maskedCause.matched ? maskedCause.value : normalizeValue(cause.value, policy, depth + 1, path);
    }

    for (const key of keys) {
        if (!ERROR_STANDARD_FIELDS.has(key)) {
            result[key] = normalizeProperty(error, key, policy, depth + 1, path);
        }
    }
    return result;
}

function normalizeObject(value: object, policy: MaskingPolicy, depth: number, path: Set<object>): JsonSafeValue {
    const keys = safeKeys(value);
    if (keys === null) return UNSERIALIZABLE_PLACEHOLDER;

    const result: { [key: string]: JsonSafeValue } = Object.create(null) as {
        [key: string]: JsonSafeValue;
    };
    for (const key of keys) {
        result[key] = normalizeProperty(value, key, policy, depth + 1, path);
    }
    return result;
}

function normalizeComposite(value: object, policy: MaskingPolicy, depth: number, path: Set<object>): JsonSafeValue {
    if (path.has(value)) return CIRCULAR_PLACEHOLDER;
    if (depth > MAX_META_DEPTH) return MAX_DEPTH_PLACEHOLDER;

    path.add(value);
    try {
        if (value instanceof Date) {
            try {
                const time = Date.prototype.getTime.call(value) as number;
                return Number.isNaN(time) ? INVALID_DATE_PLACEHOLDER : new Date(time).toISOString();
            } catch {
                return UNSERIALIZABLE_PLACEHOLDER;
            }
        }
        if (value instanceof Error) return normalizeError(value, policy, depth, path);
        if (Array.isArray(value)) {
            return Array.from({ length: value.length }, (_, index) =>
                normalizeProperty(value, String(index), policy, depth + 1, path)
            );
        }
        return normalizeObject(value, policy, depth, path);
    } catch {
        return UNSERIALIZABLE_PLACEHOLDER;
    } finally {
        path.delete(value);
    }
}

function normalizeValue(value: unknown, policy: MaskingPolicy, depth: number, path: Set<object>): JsonSafeValue {
    if (value === null) return null;

    switch (typeof value) {
        case 'string':
        case 'boolean':
            return value;
        case 'number':
            if (Number.isNaN(value)) return 'NaN';
            if (value === Infinity) return 'Infinity';
            if (value === -Infinity) return '-Infinity';
            return value;
        case 'bigint':
            return value.toString(10);
        case 'undefined':
            return UNDEFINED_PLACEHOLDER;
        case 'symbol':
            return safeString(value, UNSERIALIZABLE_PLACEHOLDER);
        case 'function':
            return normalizeFunction(value);
        case 'object':
            return normalizeComposite(value, policy, depth, path);
        default:
            return UNSERIALIZABLE_PLACEHOLDER;
    }
}

export function normalizeMeta(value: unknown, maskingPolicy: MaskingPolicy): JsonSafeValue {
    try {
        return normalizeValue(value, maskingPolicy, 0, new Set<object>());
    } catch {
        return UNSERIALIZABLE_PLACEHOLDER;
    }
}

export function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? JSON.stringify(UNSERIALIZABLE_PLACEHOLDER);
    } catch {
        return JSON.stringify(UNSERIALIZABLE_PLACEHOLDER);
    }
}
