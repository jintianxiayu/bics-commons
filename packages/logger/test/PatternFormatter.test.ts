import type winston from 'winston';
import { createPatternFormatter } from '../src/formatters/PatternFormatter';

describe('PatternFormatter', () => {
    it('uses safe stringify for unexpected unsafe meta values', () => {
        const format = createPatternFormatter('%{level} %{message} %{meta}');
        const info = {
            level: 'info',
            message: 'event',
            timestamp: '2026-08-13T00:00:00.000Z',
            count: 1n,
        } as unknown as winston.Logform.TransformableInfo;

        const transformed = format.transform(info) as winston.Logform.TransformableInfo;

        expect(transformed[Symbol.for('message')]).toBe('INFO event {"count":"1"}');
    });

    it('does not invoke custom toJSON values', () => {
        let calls = 0;
        const format = createPatternFormatter('%{meta}');
        const info = {
            level: 'info',
            message: 'event',
            timestamp: '2026-08-13T00:00:00.000Z',
            data: {
                value: 1,
                toJSON(): never {
                    calls += 1;
                    throw new Error('must not run');
                },
            },
        } as unknown as winston.Logform.TransformableInfo;

        const transformed = format.transform(info) as winston.Logform.TransformableInfo;

        expect(transformed[Symbol.for('message')]).toBe('{"data":{"value":1,"toJSON":"[Function: toJSON]"}}');
        expect(calls).toBe(0);
    });

    it('preserves normal formatter metadata', () => {
        const format = createPatternFormatter('%{name} %{meta}');
        const info = {
            level: 'info',
            message: 'event',
            label: 'worker',
            timestamp: '2026-08-13T00:00:00.000Z',
            traceId: 'trace-1',
        } as unknown as winston.Logform.TransformableInfo;

        const transformed = format.transform(info) as winston.Logform.TransformableInfo;

        expect(transformed[Symbol.for('message')]).toBe('worker {"traceId":"trace-1"}');
    });
});
