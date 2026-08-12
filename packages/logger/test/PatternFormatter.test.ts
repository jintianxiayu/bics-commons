import type winston from 'winston';
import { createPatternFormatter } from '../src/formatters/PatternFormatter';
import { LogPosition } from '../src/core/LogPosition';
import { LOG_POSITION_SYMBOL } from '../src/core/LogPositionMetadata';

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

    it('captures once and reuses the value for repeated position placeholders', () => {
        const capture = jest.spyOn(LogPosition, 'capture').mockReturnValue('src/caller.ts:10:20');
        const format = createPatternFormatter('%{log_position} %{message} %{log_position}');
        const info = {
            level: 'info',
            message: 'event',
            timestamp: '2026-08-13T00:00:00.000Z',
        } as unknown as winston.Logform.TransformableInfo;

        const transformed = format.transform(info) as winston.Logform.TransformableInfo;

        expect(transformed[Symbol.for('message')]).toBe('src/caller.ts:10:20 event src/caller.ts:10:20');
        expect(capture).toHaveBeenCalledTimes(1);
        capture.mockRestore();
    });

    it('reuses a pre-captured position without capturing again', () => {
        const capture = jest.spyOn(LogPosition, 'capture');
        const format = createPatternFormatter('%{log_position} %{message} %{log_position}');
        const info = {
            level: 'info',
            message: 'event',
            timestamp: '2026-08-13T00:00:00.000Z',
            [LOG_POSITION_SYMBOL]: 'src/pre-captured.ts:3:4',
        } as unknown as winston.Logform.TransformableInfo;

        const transformed = format.transform(info) as winston.Logform.TransformableInfo;

        expect(transformed[Symbol.for('message')]).toBe('src/pre-captured.ts:3:4 event src/pre-captured.ts:3:4');
        expect(capture).not.toHaveBeenCalled();
        capture.mockRestore();
    });

    it('does not capture when the pattern has no position placeholder', () => {
        const capture = jest.spyOn(LogPosition, 'capture');
        const format = createPatternFormatter('%{level} %{message}');
        const info = {
            level: 'info',
            message: 'event',
            timestamp: '2026-08-13T00:00:00.000Z',
        } as unknown as winston.Logform.TransformableInfo;

        for (let index = 0; index < 100; index += 1) format.transform({ ...info });

        expect(capture).not.toHaveBeenCalled();
        capture.mockRestore();
    });

    it('replaces position with the stable fallback', () => {
        const capture = jest.spyOn(LogPosition, 'capture').mockReturnValue('unknown:0:0');
        const format = createPatternFormatter('%{message} %{log_position}');
        const info = {
            level: 'warn',
            message: 'event',
            timestamp: '2026-08-13T00:00:00.000Z',
        } as unknown as winston.Logform.TransformableInfo;

        const transformed = format.transform(info) as winston.Logform.TransformableInfo;

        expect(transformed[Symbol.for('message')]).toBe('event unknown:0:0');
        expect(capture).toHaveBeenCalledTimes(1);
        capture.mockRestore();
    });
});
