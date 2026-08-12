/** 敏感信息脱敏策略。每个 logger 持有独立实例，避免配置串扰。 */

import type { SensitiveFieldConfig, SensitiveMaskingConfig } from '../types';
import { DEFAULT_SENSITIVE_FIELDS, mergeSensitiveFields } from '../config/defaultConfig';
import { normalizeMeta } from './MetaSerializer';

export interface MaskFieldResult {
    readonly matched: boolean;
    readonly value: string;
}

export interface MaskingPolicy {
    readonly enabled: boolean;
    maskField(field: string, value: unknown): MaskFieldResult;
    mask(obj: unknown): unknown;
}

interface RenderContext {
    fieldLookup: Map<string, SensitiveFieldConfig>;
    rendererCache: Map<string, (value: string) => string>;
}

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
    try {
        const strValue = value === null ? 'null' : value === undefined ? 'undefined' : String(value);
        return createRenderer(context, config.mask)(strValue);
    } catch {
        return '********';
    }
}

export function createMaskingPolicy(config?: SensitiveMaskingConfig): MaskingPolicy {
    const enabled = config?.enabled !== false;
    const fields = mergeSensitiveFields(DEFAULT_SENSITIVE_FIELDS, config?.fields);
    const context: RenderContext = {
        fieldLookup: new Map(fields.map((field) => [field.field, { ...field }])),
        rendererCache: new Map(),
    };

    const policy: MaskingPolicy = {
        enabled,
        maskField(field: string, value: unknown): MaskFieldResult {
            if (!enabled) return { matched: false, value: '' };
            const fieldConfig = context.fieldLookup.get(field);
            if (!fieldConfig) return { matched: false, value: '' };
            return { matched: true, value: maskValue(context, value, fieldConfig) };
        },
        mask(obj: unknown): unknown {
            return normalizeMeta(obj, policy);
        },
    };
    return Object.freeze(policy);
}
