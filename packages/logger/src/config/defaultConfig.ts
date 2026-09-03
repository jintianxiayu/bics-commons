import type { EffectiveLoggerProfile, EffectiveMaskingConfig, EffectiveProcessErrorConfig } from '../core/model';

export const DEFAULT_PATTERN = '%{timestamp} %{level} [%{name}] [%{traceId}] %{log_position}: %{message} %{meta}';

export const DEFAULT_LOGGER_PROFILE: EffectiveLoggerProfile = Object.freeze({
    level: 'info',
    captureLogPosition: true,
    console: Object.freeze({
        enabled: true,
        colors: false,
        format: 'plain',
        pattern: DEFAULT_PATTERN,
    }),
    file: Object.freeze({
        enabled: false,
        format: 'json',
        pattern: DEFAULT_PATTERN,
        dirname: './logs',
        filename: 'app.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '7d',
    }),
});

export const DEFAULT_MASKING_CONFIG: EffectiveMaskingConfig = Object.freeze({
    enabled: true,
    fields: Object.freeze({}),
});

export const DEFAULT_PROCESS_ERROR_CONFIG: EffectiveProcessErrorConfig = Object.freeze({
    uncaughtException: true,
    unhandledRejection: true,
    exitOnError: true,
});
