/**
 * Logger 默认配置
 *
 * 当未提供配置文件或配置缺失时使用的默认值
 */

import type { EffectiveLoggerConfig, SensitiveFieldConfig } from '../types';

export const DEFAULT_SENSITIVE_FIELDS: SensitiveFieldConfig[] = [
    { field: 'password', mask: '********' },
    { field: 'passwd', mask: '********' },
    { field: 'pwd', mask: '********' },
    { field: 'token', mask: '********' },
    { field: 'apiKey', mask: '********' },
    { field: 'api_key', mask: '********' },
    { field: 'secretKey', mask: '********' },
    { field: 'accessToken', mask: '********' },
    { field: 'refreshToken', mask: '********' },
    { field: 'phone', mask: '*** *** {last4}' },
    { field: 'mobile', mask: '*** *** {last4}' },
    { field: 'mobileNo', mask: '*** *** {last4}' },
    { field: 'creditCard', mask: '**** **** **** {last4}' },
    { field: 'cardNo', mask: '**** **** **** {last4}' },
    { field: 'bankAccount', mask: '**** **** **** {last4}' },
    { field: 'idCard', mask: '**************{last4}' },
    { field: 'idNumber', mask: '**************{last4}' },
    { field: 'email', mask: '{first2}***@{domain}' },
];

export const DEFAULT_PATTERN = '%{timestamp} %{level} [%{name}] [%{traceId}] %{log_position}: %{message} %{meta}';

export const DEFAULT_LOG_LEVEL = 'info' as const;

export const defaultConfig: EffectiveLoggerConfig = {
    level: DEFAULT_LOG_LEVEL,
    pattern: DEFAULT_PATTERN,
    console: {
        enabled: true,
        colors: true,
        format: 'plain',
    },
    file: {
        enabled: false,
        dirname: './logs',
        filename: 'app.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '7d',
    },
    sensitiveMasking: {
        enabled: true,
        fields: DEFAULT_SENSITIVE_FIELDS,
    },
};

export function cloneSensitiveFields(fields: SensitiveFieldConfig[]): SensitiveFieldConfig[] {
    return fields.map((field) => ({ ...field }));
}

export function mergeSensitiveFields(
    ...layers: Array<readonly SensitiveFieldConfig[] | undefined>
): SensitiveFieldConfig[] {
    const result: SensitiveFieldConfig[] = [];
    const indexes = new Map<string, number>();

    for (const fields of layers) {
        for (const field of fields ?? []) {
            const cloned = { ...field };
            const index = indexes.get(field.field);
            if (index === undefined) {
                indexes.set(field.field, result.length);
                result.push(cloned);
            } else {
                result[index] = cloned;
            }
        }
    }

    return result;
}

export function getDefaultConfig(): EffectiveLoggerConfig {
    return {
        ...defaultConfig,
        console: { ...defaultConfig.console },
        file: { ...defaultConfig.file },
        sensitiveMasking: {
            enabled: defaultConfig.sensitiveMasking.enabled,
            fields: cloneSensitiveFields(defaultConfig.sensitiveMasking.fields),
        },
    };
}
