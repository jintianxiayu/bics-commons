import { existsSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import { ConfigError, ConfigLoader } from '../src/core/ConfigLoader';
import { LoggerFactory } from '../src/core/LoggerFactory';
import { LoggerContext } from '../src/core/LoggerContext';
import { createMaskingPolicy } from '../src/core/SensitiveMasker';
import { getDefaultConfig, mergeSensitiveFields } from '../src/config/defaultConfig';

const TEST_CONFIG_PATH = path.join(__dirname, 'test-security-config.yaml');

function writeConfig(yaml: string): void {
    writeFileSync(TEST_CONFIG_PATH, yaml);
}

function withConfig(yaml: string, fn: () => void): void {
    writeConfig(yaml);
    const original = process.env.LOGGER_CONFIG_PATH;
    process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
    try {
        fn();
    } finally {
        if (original === undefined) delete process.env.LOGGER_CONFIG_PATH;
        else process.env.LOGGER_CONFIG_PATH = original;
    }
}

function captureStdout(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const stream = (console as unknown as { _stdout: NodeJS.WriteStream })._stdout;
    const original = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array) => {
        const value = typeof chunk === 'string' ? chunk : chunk.toString();
        lines.push(...value.split(/\r?\n/).filter(Boolean));
        return true;
    }) as typeof stream.write;
    return { lines, restore: () => (stream.write = original) };
}

describe('logger security configuration', () => {
    beforeEach(() => {
        LoggerFactory.reset();
    });

    afterEach(async () => {
        await LoggerFactory.shutdown({ timeout: 0 });
        LoggerContext.clear();
        delete process.env.LOGGER_CONFIG_PATH;
        if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH);
    });

    describe('default isolation and field merging', () => {
        it('returns deeply isolated default configuration', () => {
            const first = getDefaultConfig();
            first.console.enabled = false;
            first.file.dirname = '/changed';
            first.sensitiveMasking.fields[0]!.mask = 'changed';

            const second = getDefaultConfig();
            expect(second.console.enabled).toBe(true);
            expect(second.file.dirname).toBe('./logs');
            expect(second.sensitiveMasking.fields[0]!.mask).toBe('********');
        });

        it('stably overrides and appends fields', () => {
            const merged = mergeSensitiveFields(
                [
                    { field: 'password', mask: 'default' },
                    { field: 'token', mask: 'token-mask' },
                ],
                [
                    { field: 'password', mask: 'root' },
                    { field: 'customSecret', mask: 'custom' },
                ],
                [{ field: 'password', mask: 'named' }]
            );
            expect(merged).toEqual([
                { field: 'password', mask: 'named' },
                { field: 'token', mask: 'token-mask' },
                { field: 'customSecret', mask: 'custom' },
            ]);
        });
    });

    describe('strict validation', () => {
        it.each([
            ['root.level', 'root:\n  level: verbose\n', 'root.level'],
            ['named level', 'loggers:\n  database:\n    level: verbose\n', 'loggers.database.level'],
            ['boolean', 'root:\n  console:\n    enabled: "yes"\n', 'root.console.enabled'],
            ['format', 'root:\n  console:\n    format: xml\n', 'root.console.format'],
            ['unknown', 'root:\n  console:\n    colours: true\n', 'root.console.colours'],
            ['file type', 'root:\n  file:\n    maxSize: 10\n', 'root.file.maxSize'],
        ])('rejects invalid %s at the exact path', (_label, yaml, expectedPath) => {
            writeConfig(yaml);
            expect(() => ConfigLoader.load(TEST_CONFIG_PATH)).toThrow(ConfigError);
            expect(() => ConfigLoader.load(TEST_CONFIG_PATH)).toThrow(expectedPath);
        });

        it.each([
            ['non-array fields', 'root:\n  sensitiveMasking:\n    fields: invalid\n', 'root.sensitiveMasking.fields'],
            [
                'empty field',
                'root:\n  sensitiveMasking:\n    fields:\n      - field: ""\n        mask: "****"\n',
                'root.sensitiveMasking.fields[0].field',
            ],
            [
                'empty mask',
                'root:\n  sensitiveMasking:\n    fields:\n      - field: secret\n        mask: ""\n',
                'root.sensitiveMasking.fields[0].mask',
            ],
            [
                'duplicate field',
                'root:\n  sensitiveMasking:\n    fields:\n      - field: secret\n        mask: one\n      - field: secret\n        mask: two\n',
                'root.sensitiveMasking.fields[1].field',
            ],
        ])('rejects %s', (_label, yaml, expectedPath) => {
            writeConfig(yaml);
            expect(() => ConfigLoader.load(TEST_CONFIG_PATH)).toThrow(expectedPath);
        });

        it('does not replace cached config after a failed load', () => {
            writeConfig('root:\n  level: warn\n');
            ConfigLoader.load(TEST_CONFIG_PATH);
            writeConfig('root:\n  level: verbose\n');
            expect(() => ConfigLoader.load(TEST_CONFIG_PATH)).toThrow();
            expect(ConfigLoader.getConfig()?.level).toBe('warn');
        });
    });

    describe('aliases and config source', () => {
        it.each(['sensitiveMasking', 'sensitive-masking'])('normalizes %s', (key) => {
            writeConfig(`root:\n  ${key}:\n    enabled: false\n`);
            expect(ConfigLoader.load(TEST_CONFIG_PATH).sensitiveMasking.enabled).toBe(false);
        });

        it('rejects both aliases at the same level', () => {
            writeConfig('root:\n  sensitiveMasking:\n    enabled: true\n  sensitive-masking:\n    enabled: false\n');
            expect(() => ConfigLoader.load(TEST_CONFIG_PATH)).toThrow('Invalid configuration at root');
        });

        it('quietly loads defaults without an environment path', () => {
            delete process.env.LOGGER_CONFIG_PATH;
            const warn = jest.spyOn(console, 'warn').mockImplementation();
            expect(LoggerFactory.getLogger('default')).toBeDefined();
            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
        });

        it('rejects a missing explicit environment path in strict mode', () => {
            process.env.LOGGER_CONFIG_PATH = `${TEST_CONFIG_PATH}.missing`;
            expect(() => LoggerFactory.init()).toThrow('Config file not found');
        });

        it('warns and completely falls back in lazy mode', () => {
            writeConfig('root:\n  level: debug\n  console:\n    format: xml\n');
            process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
            const warn = jest.spyOn(console, 'warn').mockImplementation();
            expect(LoggerFactory.getLogger('fallback')).toBeDefined();
            expect(ConfigLoader.getConfig()?.level).toBe('info');
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('root.console.format'));
            warn.mockRestore();
        });
    });

    describe('isolated masking policies', () => {
        it('keeps policies independent in either creation order', () => {
            const first = createMaskingPolicy({ fields: [{ field: 'password', mask: 'AAAA' }] });
            const second = createMaskingPolicy({ fields: [{ field: 'password', mask: 'BBBB' }] });
            expect(first.mask({ password: 'secret' })).toEqual({ password: 'AAAA' });
            expect(second.mask({ password: 'secret' })).toEqual({ password: 'BBBB' });

            const disabled = createMaskingPolicy({ enabled: false });
            expect(disabled.mask({ password: 'secret' })).toEqual({ password: 'secret' });
            expect(first.mask({ password: 'secret' })).toEqual({ password: 'AAAA' });
        });

        it('uses exact case-sensitive field names', () => {
            const policy = createMaskingPolicy();
            expect(policy.mask({ password: 'secret', Password: 'visible' })).toEqual({
                password: '********',
                Password: 'visible',
            });
        });
    });

    describe('YAML to output integration', () => {
        it('applies default, override, and appended rules to plain output', () => {
            withConfig(
                `root:\n  pattern: '%{message} %{meta}'\n  console:\n    enabled: true\n    colors: false\n    format: plain\n  file:\n    enabled: false\n  sensitiveMasking:\n    fields:\n      - field: password\n        mask: 'ROOT'\n      - field: customSecret\n        mask: 'CUSTOM'\n`,
                () => {
                    const output = captureStdout();
                    try {
                        LoggerFactory.getLogger('app').info('secure', {
                            password: 'secret',
                            token: 'token-value',
                            customSecret: 'custom-value',
                        });
                        expect(output.lines[0]).toContain('"password":"ROOT"');
                        expect(output.lines[0]).toContain('"token":"********"');
                        expect(output.lines[0]).toContain('"customSecret":"CUSTOM"');
                    } finally {
                        output.restore();
                    }
                }
            );
        });

        it.each(['sensitiveMasking', 'sensitive-masking'])('applies %s in JSON output and preserves traceId', (key) => {
            withConfig(
                `root:\n  console:\n    enabled: true\n    colors: true\n    format: json\n  file:\n    enabled: false\n  ${key}:\n    fields:\n      - field: customSecret\n        mask: 'CUSTOM'\n`,
                () => {
                    const output = captureStdout();
                    try {
                        LoggerContext.withContext({ traceId: 'trace-security' }, () => {
                            LoggerFactory.getLogger('json').info('secure', { customSecret: 'value' });
                        });
                        const parsed = JSON.parse(output.lines[0]!) as {
                            traceId: string;
                            meta: Array<Record<string, string>>;
                        };
                        expect(parsed.traceId).toBe('trace-security');
                        expect(parsed.meta[0]?.customSecret).toBe('CUSTOM');
                    } finally {
                        output.restore();
                    }
                }
            );
        });

        it('isolates named logger overrides, empty fields, and disabled masking', () => {
            withConfig(
                `root:\n  pattern: '%{name} %{meta}'\n  console:\n    enabled: true\n    colors: false\n  file:\n    enabled: false\n  sensitiveMasking:\n    fields:\n      - field: password\n        mask: 'ROOT'\nloggers:\n  named:\n    sensitiveMasking:\n      fields:\n        - field: password\n          mask: 'NAMED'\n  inherited:\n    sensitiveMasking:\n      fields: []\n  visible:\n    sensitiveMasking:\n      enabled: false\n`,
                () => {
                    const output = captureStdout();
                    try {
                        LoggerFactory.getLogger('visible').info('x', { password: 'secret' });
                        LoggerFactory.getLogger('named').info('x', { password: 'secret' });
                        LoggerFactory.getLogger('inherited').info('x', { password: 'secret' });
                        expect(output.lines[0]).toContain('"password":"secret"');
                        expect(output.lines[1]).toContain('"password":"NAMED"');
                        expect(output.lines[2]).toContain('"password":"ROOT"');
                    } finally {
                        output.restore();
                    }
                }
            );
        });

        it('returns a cached silent logger when all transports are disabled', () => {
            withConfig('root:\n  console:\n    enabled: false\n  file:\n    enabled: false\n', () => {
                const warn = jest.spyOn(console, 'warn').mockImplementation();
                const output = captureStdout();
                try {
                    const first = LoggerFactory.getLogger('silent');
                    const second = LoggerFactory.getLogger('silent');
                    expect(first).toBe(second);
                    expect(() => {
                        first.debug('debug');
                        first.info('info');
                        first.warn('warn');
                        first.error('error');
                    }).not.toThrow();
                    expect(output.lines).toHaveLength(0);
                    expect(warn).not.toHaveBeenCalled();
                } finally {
                    output.restore();
                    warn.mockRestore();
                }
            });
        });
    });
});
