import assert from 'node:assert/strict';
import { describe, test } from '@jest/globals';
import { LoggerContext } from '../../src/core/LoggerContext';

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('LoggerContext', () => {
    test('exposes only withContext and get as context operations', () => {
        const methods = Object.getOwnPropertyNames(LoggerContext);
        assert.ok(methods.includes('withContext'));
        assert.ok(methods.includes('get'));
        assert.ok(!methods.includes('set'));
        assert.ok(!methods.includes('clear'));
        assert.ok(!methods.includes('getStore'));
    });

    test('returns values and restores nested context', () => {
        assert.equal(LoggerContext.get('traceId'), undefined);

        const result = LoggerContext.withContext({ traceId: 'outer', tenant: 'a' }, () => {
            assert.equal(LoggerContext.get('traceId'), 'outer');
            return LoggerContext.withContext({ traceId: 'inner' }, () => {
                assert.equal(LoggerContext.get('traceId'), 'inner');
                assert.equal(LoggerContext.get('tenant'), 'a');
                return 42;
            });
        });

        assert.equal(result, 42);
        assert.equal(LoggerContext.get('traceId'), undefined);
    });

    test('restores context after throw and rejection', async () => {
        assert.throws(
            () =>
                LoggerContext.withContext({ traceId: 'throwing' }, () => {
                    throw new Error('boom');
                }),
            // 正则说明：固定文本 boom 验证同步回调异常按原始错误透传，不依赖完整堆栈格式。
            /boom/
        );
        assert.equal(LoggerContext.get('traceId'), undefined);

        await assert.rejects(
            LoggerContext.withContext({ traceId: 'rejecting' }, async () => {
                await delay(1);
                throw new Error('rejected');
            }),
            // 正则说明：固定文本 rejected 验证异步回调拒绝原因按原样透传，不依赖 Promise 包装细节。
            /rejected/
        );
        assert.equal(LoggerContext.get('traceId'), undefined);
    });

    test('isolates concurrent asynchronous request chains', async () => {
        const observed = await Promise.all(
            ['request-a', 'request-b'].map((traceId, index) =>
                LoggerContext.withContext({ traceId }, async () => {
                    await delay(index === 0 ? 8 : 2);
                    const first = LoggerContext.get('traceId');
                    await delay(index === 0 ? 1 : 8);
                    const second = LoggerContext.get('traceId');
                    return [first, second];
                })
            )
        );

        assert.deepEqual(observed, [
            ['request-a', 'request-a'],
            ['request-b', 'request-b'],
        ]);
    });
});
