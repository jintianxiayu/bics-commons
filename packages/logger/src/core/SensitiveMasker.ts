/** 敏感信息脱敏策略。每个 logger 持有独立实例，避免配置串扰。 */

import type { SensitiveFieldConfig, SensitiveMaskingConfig } from '../types';
import { DEFAULT_SENSITIVE_FIELDS, mergeSensitiveFields } from '../config/defaultConfig';

export interface MaskingPolicy {
    readonly enabled: boolean;
    mask(obj: unknown): unknown;
}

interface RenderContext {
    fieldLookup: Map<string, SensitiveFieldConfig>;
    rendererCache: Map<string, (value: string) => string>;
}

const MAX_DEPTH = 5;

function applyPlaceholder(value: string, placeholder: string): string {
    if (value === '') return '';

    if (placeholder.startsWith('{last')) {
        const n = parseInt(placeholder.slice(5, -1), 10);
        if (isNaN(n) || n <= 0) return placeholder;
        if (value.length <= n) return '*'.repeat(n - value.length) + value;
        return value.slice(-n);
    }

    if (placeholder.startsWith('{first')) {
        const n = parseInt(placeholder.slice(6, -1), 10);
        if (isNaN(n) || n <= 0) return placeholder;
        if (value.length <= n) return value + '*'.repeat(n - value.length);
        return value.slice(0, n);
    }

    if (placeholder === '{domain}') {
        const atIndex = value.indexOf('@');
        return atIndex === -1 ? '********' : value.slice(atIndex + 1);
    }

    return placeholder;
}

function renderMask(value: string, template: string): string {
    let result = template;
    for (const placeholder of result.match(/\{last\d+\}|\{first\d+\}|\{domain\}/g) ?? []) {
        result = result.replace(placeholder, applyPlaceholder(value, placeholder));
    }
    return result;
}

function createRenderer(context: RenderContext, template: string): (value: string) => string {
    let renderer = context.rendererCache.get(template);
    if (!renderer) {
        renderer = (value) => renderMask(value, template);
        context.rendererCache.set(template, renderer);
    }
    return renderer;
}

function maskValue(context: RenderContext, value: unknown, config: SensitiveFieldConfig): string {
    const strValue = value === null ? 'null' : value === undefined ? 'undefined' : String(value);
    try {
        return createRenderer(context, config.mask)(strValue);
    } catch {
        return '*'.repeat(Math.min(strValue.length, 12));
    }
}

function maskObject(context: RenderContext, obj: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) return '[MAX_DEPTH_EXCEEDED]';
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
    if (Array.isArray(obj)) return obj.map((item) => maskObject(context, item, depth + 1));

    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            const fieldConfig = context.fieldLookup.get(key);
            if (fieldConfig) {
                result[key] = maskValue(context, value, fieldConfig);
            } else if (value !== null && typeof value === 'object') {
                result[key] = maskObject(context, value, depth + 1);
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    return obj;
}

export function createMaskingPolicy(config?: SensitiveMaskingConfig): MaskingPolicy {
    const enabled = config?.enabled !== false;
    const fields = mergeSensitiveFields(DEFAULT_SENSITIVE_FIELDS, config?.fields);
    const context: RenderContext = {
        fieldLookup: new Map(fields.map((field) => [field.field, { ...field }])),
        rendererCache: new Map(),
    };

    return Object.freeze({
        enabled,
        mask(obj: unknown): unknown {
            return enabled ? maskObject(context, obj) : obj;
        },
    });
}
