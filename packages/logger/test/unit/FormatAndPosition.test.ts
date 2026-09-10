import assert from 'node:assert';
import type { SafeLogEvent } from '../../src/core/model';
import { captureLogPosition, formatLogPositionPath, parseLogPositionStack } from '../../src/core/LogPosition';
import { LoggerConfigError } from '../../src/core/errors';
import { compilePlainPattern } from '../../src/format/PlainFormat';
import { renderJson } from '../../src/format/JsonFormat';

const event: SafeLogEvent = {
    timestamp: '2026-08-17T00:00:00.000Z',
    level: 'info',
    name: 'http',
    message: 'request completed',
    traceId: 'request-1',
    logPosition: 'handler.ts:42',
    meta: { statusCode: 200 },
};

describe('output formats', () => {
    test('renders all plain placeholders without re-parsing message content', () => {
        const pattern = compilePlainPattern(
            '%{timestamp}|%{level}|%{name}|%{traceId}|%{log_position}|%{message}|%{meta}'
        );
        const output = pattern.render({ ...event, message: '%{level}' }, { colors: false });

        assert.equal(output, '2026-08-17T00:00:00.000Z|info|http|request-1|handler.ts:42|%{level}|{"statusCode":200}');
    });

    test('uses stable missing values and confines ANSI color to plain mode', () => {
        const pattern = compilePlainPattern('%{level} %{traceId} %{log_position} %{meta}');
        const plain = pattern.render(
            { timestamp: event.timestamp, level: 'warn', name: 'x', message: 'm' },
            { colors: false }
        );
        const colored = pattern.render(event, { colors: true });

        assert.equal(plain, 'warn - - -');
        assert.ok(colored.includes('\u001b[32minfo\u001b[39m'));
    });

    test('does not output log position when the plain pattern omits the placeholder', () => {
        const pattern = compilePlainPattern('%{level}|%{message}');

        assert.equal(pattern.render(event, { colors: false }), 'info|request completed');
        assert.equal(
            pattern.render(
                {
                    timestamp: event.timestamp,
                    level: 'info',
                    name: 'http',
                    message: 'without position',
                },
                { colors: false }
            ),
            'info|without position'
        );
    });

    test('rejects unknown and malformed placeholders', () => {
        assert.throws(() => compilePlainPattern('%{unknown}'), LoggerConfigError);
        assert.throws(() => compilePlainPattern('%{message'), LoggerConfigError);
    });

    test('renders one valid JSON object without ANSI codes', () => {
        const output = renderJson(event);
        assert.deepEqual(JSON.parse(output), {
            timestamp: event.timestamp,
            level: 'info',
            name: 'http',
            message: 'request completed',
            traceId: 'request-1',
            logPosition: 'handler.ts:42',
            meta: { statusCode: 200 },
        });
        assert.ok(!output.includes('\u001b'));
        assert.ok(!output.includes('\n'));

        /** 最小事件映射中 K 为 JSON 日志字段名，V 为未提供可选字段时仍应保留的基础字段值。 */
        const minimal = JSON.parse(
            renderJson({
                timestamp: event.timestamp,
                level: 'info',
                name: 'http',
                message: 'minimal',
            })
        ) as Record<string, unknown>;
        assert.ok(!Object.prototype.hasOwnProperty.call(minimal, 'traceId'));
        assert.ok(!Object.prototype.hasOwnProperty.call(minimal, 'logPosition'));
        assert.ok(!Object.prototype.hasOwnProperty.call(minimal, 'meta'));
    });
});

describe('LogPosition', () => {
    test('normalizes project, file URL, and dependency paths', () => {
        const cases = [
            {
                file: 'D:\\app\\src\\modules\\order\\service.js',
                projectRoot: 'D:\\app',
                expected: 'src/modules/order/service.js',
            },
            {
                file: 'd:\\APP\\src\\modules\\order\\service.js',
                projectRoot: 'D:\\app',
                expected: 'src/modules/order/service.js',
            },
            {
                file: '/srv/app/src/modules/order/service.js',
                projectRoot: '/srv/app',
                expected: 'src/modules/order/service.js',
            },
            {
                file: 'file:///D:/app/src/%E8%AE%A2%E5%8D%95%20%E6%A8%A1%E5%9D%97/service.js',
                projectRoot: 'D:/app',
                expected: 'src/订单 模块/service.js',
            },
            {
                file: 'D:/app/node_modules/@jintianxiayu/http-client-decorator/dist/middlewares/debug.js',
                projectRoot: 'D:/app',
                expected: '@jintianxiayu/http-client-decorator/dist/middlewares/debug.js',
            },
            {
                file: '/srv/app/node_modules/axios/lib/core/Axios.js',
                projectRoot: '/srv/app',
                expected: 'axios/lib/core/Axios.js',
            },
            {
                file: 'D:/app/node_modules/.pnpm/@scope+pkg@1.2.0/node_modules/@scope/pkg/dist/index.js',
                projectRoot: 'D:/app',
                expected: '@scope/pkg/dist/index.js',
            },
            {
                file: '/srv/app/node_modules/a/node_modules/b/lib/index.js',
                projectRoot: '/srv/app',
                expected: 'b/lib/index.js',
            },
            {
                file: '/srv/app/src/node_modules-mock/index.js',
                projectRoot: '/srv/app',
                expected: 'src/node_modules-mock/index.js',
            },
            {
                file: '\\\\server\\share\\app\\src\\index.js',
                projectRoot: '\\\\SERVER\\SHARE\\app',
                expected: 'src/index.js',
            },
        ] as const;

        for (const { file, projectRoot, expected } of cases) {
            assert.equal(formatLogPositionPath(file, projectRoot), expected);
        }
    });

    test('compresses only paths above the soft limit with removable segments', () => {
        const prefix = 'src/modules/order/';
        const suffix = '/services/handler.js';
        const atLimit = `${prefix}${'a'.repeat(120 - prefix.length - suffix.length)}${suffix}`;
        const aboveLimit = `${prefix}${'a'.repeat(121 - prefix.length - suffix.length)}${suffix}`;

        assert.equal(atLimit.length, 120);
        assert.equal(formatLogPositionPath(atLimit, '/unrelated'), atLimit);
        assert.equal(formatLogPositionPath(aboveLimit, '/unrelated'), 'src/modules/order/.../services/handler.js');

        const longSegmentPath = `@scope/package/${'a'.repeat(121)}/handler.js`;
        assert.equal(formatLogPositionPath(longSegmentPath, '/unrelated'), longSegmentPath);
        assert.equal(formatLogPositionPath('C:/shared/common/logger.js', 'D:/app'), 'C:/shared/common/logger.js');
    });

    test('allows compressed paths to collide without adding a hash', () => {
        const first = `src/modules/order/${'create'.repeat(20)}/workflow/services/handler.js`;
        const second = `src/modules/order/${'cancel'.repeat(20)}/workflow/services/handler.js`;

        assert.equal(formatLogPositionPath(first, '/unrelated'), 'src/modules/order/.../services/handler.js');
        assert.equal(formatLogPositionPath(second, '/unrelated'), 'src/modules/order/.../services/handler.js');
    });

    test('parses the first external frame and returns undefined without one', () => {
        const stack = [
            'Error',
            '    at write (D:\\app\\node_modules\\@jintianxiayu\\logger\\dist\\core\\LoggerFactory.js:231:29)',
            '    at handle (D:\\app\\src\\modules\\order\\service.js:42:9)',
        ].join('\n');

        assert.equal(parseLogPositionStack(stack, 'D:/app'), 'src/modules/order/service.js:42');
        assert.equal(
            parseLogPositionStack('Error\n    at node:internal/process/task_queues:95:5', 'D:/app'),
            undefined
        );
    });

    test('returns file:line without a column', () => {
        const position = captureLogPosition(process.cwd());
        assert.ok(position);
        assert.ok(!position.includes(process.cwd().replaceAll('\\', '/')));
        // 正则说明：:\d+$ 要求捕获位置以至少一位行号结束，验证返回值满足 file:line 契约。
        assert.match(position, /:\d+$/);
        // 正则说明：:\d+:\d+$ 检测行号和列号双数字结尾，doesNotMatch 验证实现没有暴露列号。
        assert.doesNotMatch(position, /:\d+:\d+$/);
    });
});
