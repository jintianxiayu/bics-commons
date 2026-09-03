import assert from 'node:assert';
import { describe, test } from '@jest/globals';
import type { SafeLogEvent } from '../../src/core/model';
import { captureLogPosition } from '../../src/core/LogPosition';
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
    test('returns file:line without a column', () => {
        const position = captureLogPosition();
        assert.ok(position);
        // 正则说明：:\d+$ 要求捕获位置以至少一位行号结束，验证返回值满足 file:line 契约。
        assert.match(position, /:\d+$/);
        // 正则说明：:\d+:\d+$ 检测行号和列号双数字结尾，doesNotMatch 验证实现没有暴露列号。
        assert.doesNotMatch(position, /:\d+:\d+$/);
    });
});
