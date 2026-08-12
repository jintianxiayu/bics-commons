/**
 * LoggerFactory 单元测试
 */

import { LoggerFactory } from '../src/core/LoggerFactory';
import { LoggerContext } from '../src/core/LoggerContext';
import { getDefaultConfig } from '../src/config/defaultConfig';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import * as path from 'path';

const TEST_CONFIG_PATH = path.join(__dirname, 'test-logger-factory-config.yaml');

describe('LoggerFactory', () => {
    beforeEach(() => {
        LoggerFactory.reset();
    });

    afterEach(async () => {
        await LoggerFactory.shutdown();
        if (existsSync(TEST_CONFIG_PATH)) {
            try {
                unlinkSync(TEST_CONFIG_PATH);
            } catch {
                // ignore cleanup errors
            }
        }
    });

    describe('init', () => {
        it('should initialize with valid config when env var is set', () => {
            const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            const originalPath = process.env.LOGGER_CONFIG_PATH;
            process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
            try {
                expect(() => LoggerFactory.init()).not.toThrow();
            } finally {
                if (originalPath !== undefined) {
                    process.env.LOGGER_CONFIG_PATH = originalPath;
                } else {
                    delete process.env.LOGGER_CONFIG_PATH;
                }
            }
        });

        it('should throw on invalid config', () => {
            const yaml = `
root:
  level: invalid
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            const originalPath = process.env.LOGGER_CONFIG_PATH;
            process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
            try {
                expect(() => LoggerFactory.init()).toThrow();
            } finally {
                if (originalPath !== undefined) {
                    process.env.LOGGER_CONFIG_PATH = originalPath;
                } else {
                    delete process.env.LOGGER_CONFIG_PATH;
                }
            }
        });

        it('should quietly use defaults when the optional default file does not exist', () => {
            const originalPath = process.env.LOGGER_CONFIG_PATH;
            delete process.env.LOGGER_CONFIG_PATH;
            LoggerFactory.reset();
            try {
                expect(() => LoggerFactory.init()).not.toThrow();
            } finally {
                if (originalPath !== undefined) {
                    process.env.LOGGER_CONFIG_PATH = originalPath;
                }
            }
        });
    });

    describe('getLogger', () => {
        it('should return logger instance with all log methods', () => {
            const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            const logger = LoggerFactory.getLogger('test');

            expect(logger).toBeDefined();
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
        });

        it('should return logger that can be used multiple times', () => {
            const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            const logger = LoggerFactory.getLogger('multi-use');

            // Should not throw when called multiple times
            expect(() => logger.info('message 1')).not.toThrow();
            expect(() => logger.info('message 2')).not.toThrow();
        });

        it('should return different loggers for different names', () => {
            const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            const logger1 = LoggerFactory.getLogger('logger1');
            const logger2 = LoggerFactory.getLogger('logger2');

            // They should be different references (different objects)
            expect(logger1).not.toBe(logger2);
        });
    });

    describe('shutdown', () => {
        it('should complete without error', async () => {
            const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            LoggerFactory.getLogger('test');

            await expect(LoggerFactory.shutdown()).resolves.not.toThrow();
        });

        it('should handle multiple calls gracefully', async () => {
            const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            LoggerFactory.getLogger('test');

            await LoggerFactory.shutdown();
            // Second call should also not throw
            await expect(LoggerFactory.shutdown()).resolves.not.toThrow();
        });
    });

    describe('setupShutdownHandlers', () => {
        it('should register signal handlers without error', () => {
            expect(() => LoggerFactory.setupShutdownHandlers()).not.toThrow();
        });
    });

    describe('reset', () => {
        it('should clear internal state', () => {
            LoggerFactory.reset();
            // After reset, getting a logger should reinitialize
            expect(() => LoggerFactory.getLogger('after-reset')).not.toThrow();
        });
    });

    describe('console.format', () => {
        function captureStdout(): { lines: string[]; restore: () => void } {
            const lines: string[] = [];
            const stream = (
                console as unknown as {
                    _stdout: { write: (chunk: string | Uint8Array, ...args: unknown[]) => boolean };
                }
            )._stdout;
            const original = stream.write.bind(stream);
            const spy = ((chunk: string | Uint8Array, ..._args: unknown[]) => {
                const text = typeof chunk === 'string' ? chunk : chunk.toString();
                for (const line of text.split(/\r?\n/)) {
                    if (line.length > 0) {
                        lines.push(line);
                    }
                }
                return true;
            }) as typeof stream.write;
            stream.write = spy;
            return {
                lines,
                restore: () => {
                    stream.write = original;
                },
            };
        }

        function buildYaml(formatValue: string | null): string {
            const formatLine = formatValue === null ? '' : `    format: ${formatValue}\n`;
            return `
root:
  level: info
  pattern: '%{level} [%{name}] %{message}'
  console:
    enabled: true
    colors: false
${formatLine}  file:
    enabled: false
`;
        }

        function withYaml(yaml: string, fn: () => void): void {
            writeFileSync(TEST_CONFIG_PATH, yaml);
            const original = process.env.LOGGER_CONFIG_PATH;
            process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
            try {
                fn();
            } finally {
                if (original !== undefined) {
                    process.env.LOGGER_CONFIG_PATH = original;
                } else {
                    delete process.env.LOGGER_CONFIG_PATH;
                }
            }
        }

        it('should default to plain format when format is not configured', () => {
            withYaml(buildYaml(null), () => {
                const cap = captureStdout();
                try {
                    const logger = LoggerFactory.getLogger('default-format');
                    logger.info('hello');
                    const raw = cap.lines[0] ?? '';
                    expect(raw).toContain('info');
                    expect(raw).toContain('default-format');
                    expect(raw).toContain('hello');
                    expect(() => JSON.parse(raw)).toThrow();
                } finally {
                    cap.restore();
                }
            });
        });

        it('should output plain text when format is plain', () => {
            withYaml(buildYaml('plain'), () => {
                const cap = captureStdout();
                try {
                    const logger = LoggerFactory.getLogger('plain-format');
                    logger.info('plain message');
                    const raw = cap.lines[0] ?? '';
                    expect(raw).toContain('info');
                    expect(raw).toContain('plain-format');
                    expect(raw).toContain('plain message');
                    expect(() => JSON.parse(raw)).toThrow();
                } finally {
                    cap.restore();
                }
            });
        });

        it('should output valid JSON when format is json', () => {
            withYaml(buildYaml('json'), () => {
                const cap = captureStdout();
                try {
                    const logger = LoggerFactory.getLogger('json-format');
                    logger.info('json message');
                    const raw = cap.lines[0] ?? '';
                    const parsed = JSON.parse(raw) as Record<string, unknown>;
                    expect(parsed.level).toBe('info');
                    expect(parsed.message).toBe('json message');
                    expect(parsed.timestamp).toBeDefined();
                } finally {
                    cap.restore();
                }
            });
        });

        it('should inject traceId into json output when context is set', () => {
            withYaml(buildYaml('json'), () => {
                const cap = captureStdout();
                try {
                    LoggerContext.withContext({ traceId: 'trace-abc-123' }, () => {
                        const logger = LoggerFactory.getLogger('json-trace');
                        logger.info('with trace');
                    });
                    const raw = cap.lines[0] ?? '';
                    const parsed = JSON.parse(raw) as Record<string, unknown>;
                    expect(parsed.traceId).toBe('trace-abc-123');
                } finally {
                    cap.restore();
                }
            });
        });

        it('should not include traceId field in json output when no context is set', () => {
            withYaml(buildYaml('json'), () => {
                const cap = captureStdout();
                try {
                    const logger = LoggerFactory.getLogger('json-no-trace');
                    logger.info('no trace');
                    const raw = cap.lines[0] ?? '';
                    const parsed = JSON.parse(raw) as Record<string, unknown>;
                    expect(parsed.traceId).toBeUndefined();
                } finally {
                    cap.restore();
                }
            });
        });

        it('should not include ANSI color sequences in json output', () => {
            withYaml(buildYaml('json'), () => {
                const cap = captureStdout();
                try {
                    const logger = LoggerFactory.getLogger('json-no-ansi');
                    logger.info('clean json');
                    const raw = cap.lines[0] ?? '';
                    // eslint-disable-next-line no-control-regex
                    expect(raw).not.toMatch(/\x1b\[[0-9;]*m/);
                } finally {
                    cap.restore();
                }
            });
        });

        it('should include ANSI color sequences in plain output when colors enabled', () => {
            const yaml = `
root:
  level: info
  pattern: '%{level} %{message}'
  console:
    enabled: true
    colors: true
    format: plain
  file:
    enabled: false
`;
            withYaml(yaml, () => {
                const cap = captureStdout();
                try {
                    const logger = LoggerFactory.getLogger('plain-colors');
                    logger.info('colored');
                    const raw = cap.lines[0] ?? '';
                    // eslint-disable-next-line no-control-regex
                    expect(raw).toMatch(/\x1b\[[0-9;]*m/);
                } finally {
                    cap.restore();
                }
            });
        });

        it('should not include ANSI color sequences in plain output when colors disabled', () => {
            const yaml = `
root:
  level: info
  pattern: '%{level} %{message}'
  console:
    enabled: true
    colors: false
    format: plain
  file:
    enabled: false
`;
            withYaml(yaml, () => {
                const cap = captureStdout();
                try {
                    const logger = LoggerFactory.getLogger('plain-no-colors');
                    logger.info('plain');
                    const raw = cap.lines[0] ?? '';
                    // eslint-disable-next-line no-control-regex
                    expect(raw).not.toMatch(/\x1b\[[0-9;]*m/);
                } finally {
                    cap.restore();
                }
            });
        });
    });

    describe('defaultConfig', () => {
        it('should explicitly declare format as plain in default console config', () => {
            const config = getDefaultConfig();
            expect(config.console?.format).toBe('plain');
        });
    });
});
