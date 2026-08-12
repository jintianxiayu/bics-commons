import {
    LogPosition,
    UNKNOWN_LOG_POSITION,
    __logPositionInternals,
    type LogPositionStackFrame,
} from '../src/core/LogPosition';

const {
    capturePosition,
    decodeFileName,
    formatFramePath,
    isInternalFrame,
    normalizeFrame,
    renderPosition,
    safeInteger,
    selectCallerFrame,
} = __logPositionInternals;

function frame(
    file: string | null,
    lineNumber: number | null = 10,
    column: number | null = 20,
    methodName = 'call'
): { file: string | null; lineNumber: number | null; column: number | null; methodName: string } {
    return { file, lineNumber, column, methodName };
}

describe('LogPosition', () => {
    describe('frame normalization and rendering', () => {
        it.each([
            ['positive integer', 12, 12],
            ['fraction', 12.8, 12],
            ['negative', -1, 0],
            ['NaN', Number.NaN, 0],
            ['Infinity', Infinity, 0],
            ['missing', null, 0],
        ])('normalizes %s coordinates', (_label, value, expected) => {
            expect(safeInteger(value)).toBe(expected);
        });

        it('renders path, line, and column with missing values set to zero', () => {
            expect(normalizeFrame(frame('/workspace/src/app.ts', null, null))).toEqual({
                fileName: '/workspace/src/app.ts',
                lineNumber: 0,
                columnNumber: 0,
                methodName: 'call',
            });
            expect(
                renderPosition({ fileName: '/workspace/src/app.ts', lineNumber: 7, columnNumber: 0 }, '/workspace')
            ).toBe('src/app.ts:7:0');
        });

        it('captures a real external caller using path:line:column format', () => {
            const position = LogPosition.capture();

            expect(position).toMatch(/^.+:\d+:\d+$/);
            expect(position).toContain('test/LogPosition.test.ts');
            expect(position).not.toContain('LogPosition.ts:');
        });
    });

    describe('external frame selection', () => {
        it.each([
            '/repo/packages/logger/src/core/LogPosition.ts',
            '/repo/packages/logger/src/core/LoggerFactory.js',
            '/repo/packages/logger/src/formatters/PatternFormatter.ts',
            '/repo/packages/logger/dist/core/LogPosition.js',
            '/app/node_modules/@jintianxiayu/logger/dist/core/LoggerFactory.cjs',
            '/repo/node_modules/winston/lib/winston/logger.js',
            '/repo/node_modules/winston-transport/modern.js',
            '/repo/node_modules/logform/printf.js',
            '/repo/node_modules/stacktrace-parser/dist/stack-trace-parser.cjs.js',
            'node:internal/process/task_queues',
        ])('identifies infrastructure frame %s', (fileName) => {
            expect(isInternalFrame({ fileName, lineNumber: 1, columnNumber: 1 })).toBe(true);
        });

        it('selects the first business frame after logger infrastructure', () => {
            const selected = selectCallerFrame([
                frame('/repo/packages/logger/src/core/LogPosition.ts'),
                frame('/repo/node_modules/winston/lib/winston/logger.js'),
                frame('/repo/services/orders/handler.ts', 42, 9, 'handle'),
                frame('/repo/services/orders/other.ts'),
            ]);

            expect(selected).toMatchObject({
                fileName: '/repo/services/orders/handler.ts',
                lineNumber: 42,
                columnNumber: 9,
            });
        });

        it('keeps non-infrastructure node_modules and business log-level method names', () => {
            expect(selectCallerFrame([frame('/repo/node_modules/acme-sdk/index.js', 5, 7, 'info')])).toMatchObject({
                fileName: '/repo/node_modules/acme-sdk/index.js',
                methodName: 'info',
            });
            expect(selectCallerFrame([frame('/repo/src/service.ts', 5, 7, 'error')])).toMatchObject({
                fileName: '/repo/src/service.ts',
                methodName: 'error',
            });
        });

        it('returns null for missing, unsupported, or entirely internal frames', () => {
            expect(
                selectCallerFrame([
                    frame(null),
                    frame('https://example.com/bundle.js'),
                    frame('node:internal/modules/cjs/loader'),
                    frame('/repo/packages/logger/dist/core/LoggerFactory.js'),
                ])
            ).toBeNull();
        });
    });

    describe('cross-platform safe paths', () => {
        it.each([
            ['POSIX project path', '/work/app/src/a.ts', '/work/app', 'src/a.ts'],
            ['POSIX prefix collision', '/work/app-other/a.ts', '/work/app', 'a.ts'],
            ['POSIX outside path', '/Users/private/service.ts', '/work/app', 'service.ts'],
            ['Windows project path', 'C:\\Work\\App\\src\\a.ts', 'c:\\work\\app', 'src/a.ts'],
            ['Windows outside drive', 'D:\\Users\\private\\a.ts', 'C:\\Work\\App', 'a.ts'],
            ['relative path', './src/a.ts', '/work/app', 'src/a.ts'],
            ['file URL', 'file:///work/app/src/a%20b.ts', '/work/app', 'src/a b.ts'],
            ['Windows file URL', 'file:///C:/Work/App/src/a.ts', 'c:\\work\\app', 'src/a.ts'],
        ])('formats %s', (_label, fileName, cwd, expected) => {
            expect(formatFramePath(fileName, cwd)).toBe(expected);
        });

        it.each(['https://host/app.ts', 'webpack://bundle/app.ts', 'file:///bad%ZZ/path.ts', '[eval]', ''])(
            'rejects unsafe file representation %s',
            (fileName) => {
                expect(decodeFileName(fileName)).toBeNull();
            }
        );

        it('does not leak absolute directories, drive letters, home paths, or file URL prefixes', () => {
            const outputs = [
                formatFramePath('/Users/alice/private/service.ts', '/work/app'),
                formatFramePath('D:\\Users\\alice\\private\\service.ts', 'C:\\work\\app'),
                formatFramePath('file:///Users/alice/private/service.ts', '/work/app'),
            ];

            expect(outputs).toEqual(['service.ts', 'service.ts', 'service.ts']);
            expect(outputs.join('|')).not.toMatch(/Users|alice|[A-Z]:|file:\/\//i);
        });

        it('uses the cwd supplied at capture time', () => {
            const dependencies = {
                createStack: () => 'stack',
                parseStack: () => [frame('/new/root/src/job.ts', 8, 3)],
                cwd: () => '/new/root',
            };

            expect(capturePosition(dependencies)).toBe('src/job.ts:8:3');
        });
    });

    describe('safe capture boundary', () => {
        it.each([
            [
                'stack creation',
                {
                    createStack: () => {
                        throw new Error('create');
                    },
                },
            ],
            [
                'parser',
                {
                    parseStack: () => {
                        throw new Error('parse');
                    },
                },
            ],
            [
                'cwd',
                {
                    cwd: () => {
                        throw new Error('cwd');
                    },
                },
            ],
        ])('falls back when %s fails', (_label, override) => {
            const dependencies = {
                createStack: () => 'stack',
                parseStack: () => [frame('/work/app.ts')],
                cwd: () => '/work',
                ...override,
            };

            expect(capturePosition(dependencies)).toBe(UNKNOWN_LOG_POSITION);
        });

        it.each([
            ['empty stack', () => '', () => [frame('/work/app.ts')]],
            ['empty parser result', () => 'stack', () => []],
            ['internal frames only', () => 'stack', () => [frame('/repo/packages/logger/src/core/LogPosition.ts')]],
        ])('falls back for %s', (_label, createStack, parseStack) => {
            expect(capturePosition({ createStack, parseStack, cwd: () => '/work' })).toBe(UNKNOWN_LOG_POSITION);
        });

        it('never changes Error.stackTraceLimit across repeated captures', () => {
            const original = Error.stackTraceLimit;
            Error.stackTraceLimit = 37;
            try {
                for (let index = 0; index < 100; index += 1) LogPosition.capture();
                expect(Error.stackTraceLimit).toBe(37);
            } finally {
                Error.stackTraceLimit = original;
            }
        });

        it('renders unknown when frame path cannot be formatted', () => {
            const unsafe = { fileName: 'https://example.com/app.ts', lineNumber: 1, columnNumber: 2 };
            expect(renderPosition(unsafe as LogPositionStackFrame, '/work')).toBe(UNKNOWN_LOG_POSITION);
        });
    });
});
