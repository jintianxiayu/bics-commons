/**
 * SensitiveMasker - 敏感信息脱敏模块
 *
 * 提供基于字段名的敏感信息脱敏能力，支持模板化脱敏规则、递归脱敏处理
 */

import type { SensitiveFieldConfig, SensitiveMaskingConfig } from '../types';
import { DEFAULT_SENSITIVE_FIELDS } from '../config/defaultConfig';

interface RenderContext {
    masks: Map<string, string>;
    fieldSet: Set<string>;
    fieldLookup: Map<string, SensitiveFieldConfig>;
    rendererCache: Map<string, (value: string) => string>;
    enabled: boolean;
}

const MAX_DEPTH = 5;

let context: RenderContext | null = null;

function compileTemplate(template: string): (value: string) => string {
    return (value: string): string => {
        return renderMask(value, template);
    };
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
        if (atIndex === -1) return '********';
        return value.slice(atIndex + 1);
    }

    return placeholder;
}

function renderMask(value: string, template: string): string {
    let result = template;

    const placeholderRegex = /\{last\d+\}|\{first\d+\}|\{domain\}/g;
    const placeholders = result.match(placeholderRegex);

    if (placeholders) {
        for (const ph of placeholders) {
            result = result.replace(ph, applyPlaceholder(value, ph));
        }
    }

    result = result.replace(/\*/g, '*');

    return result;
}

function maskValue(value: unknown, config: SensitiveFieldConfig): string {
    let strValue: string;
    if (value === null) {
        strValue = 'null';
    } else if (value === undefined) {
        strValue = 'undefined';
    } else {
        strValue = String(value);
    }

    try {
        const renderer = getRenderer(config.mask);
        return renderer(strValue);
    } catch {
        return '*'.repeat(Math.min(strValue.length, 12));
    }
}

function getRenderer(template: string): (value: string) => string {
    if (!context) {
        throw new Error('SensitiveMasker not initialized');
    }

    if (!context.rendererCache.has(template)) {
        context.rendererCache.set(template, compileTemplate(template));
    }

    return context.rendererCache.get(template)!;
}

function maskObject(obj: unknown, depth: number = 0): unknown {
    if (depth > MAX_DEPTH) {
        return '[MAX_DEPTH_EXCEEDED]';
    }

    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map((item) => maskObject(item, depth + 1));
    }

    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(obj)) {
            if (context?.fieldSet.has(key)) {
                const config = context!.fieldLookup.get(key);
                if (config) {
                    result[key] = maskValue(value, config);
                    continue;
                }
            }

            if (value !== null && typeof value === 'object') {
                result[key] = maskObject(value, depth + 1);
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    return obj;
}

function init(config?: SensitiveMaskingConfig): void {
    const enabled = config?.enabled !== false;
    const fields = config?.fields?.length ? config.fields : DEFAULT_SENSITIVE_FIELDS;

    const fieldLookup = new Map<string, SensitiveFieldConfig>();
    const fieldSet = new Set<string>();

    for (const fieldConfig of fields) {
        fieldLookup.set(fieldConfig.field, fieldConfig);
        fieldSet.add(fieldConfig.field);
    }

    context = {
        masks: new Map(fields.map((f) => [f.field, f.mask])),
        fieldSet,
        fieldLookup,
        rendererCache: new Map(),
        enabled,
    };
}

function isInitialized(): boolean {
    return context !== null;
}

function reset(): void {
    context = null;
}

function mask(obj: unknown): unknown {
    if (!context) {
        init();
    }

    if (context && !context.enabled) {
        return obj;
    }

    return maskObject(obj, 0);
}

export const SensitiveMasker = {
    init,
    isInitialized,
    reset,
    mask,
};
