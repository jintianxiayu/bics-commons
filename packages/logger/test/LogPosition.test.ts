/**
 * LogPosition 单元测试
 */

import { LogPosition } from '../src/core/LogPosition';

describe('LogPosition', () => {
    describe('capture', () => {
        it('should capture caller position from stack', () => {
            const position = LogPosition.capture();

            expect(position).toMatch(/^.+:\d+$/);
        });

        it('should return valid relativePath:line format', () => {
            const position = LogPosition.capture();
            // On Windows, paths contain drive letter like D:\, so we check format differently
            const parts = position.split(':');
            // Windows paths have drive letter, so we get at least 3 parts: D, \path, line
            // Or on Unix we get 2 parts: /path/to/file, line

            if (parts.length >= 2) {
                // Last part should be a number (line)
                expect(parseInt(parts[parts.length - 1]!)).toBeGreaterThan(0);
            } else {
                fail('Position should have at least 2 parts when split by :');
            }
        });

        it('should skip internal logger frames', () => {
            const captureInTest = (): string => {
                return LogPosition.capture();
            };

            const position = captureInTest();

            // The result should not point to stacktrace-parser internals
            expect(position).not.toContain('node_modules\\stacktrace-parser');
            expect(position).not.toContain('node_modules/stacktrace-parser');
        });
    });
});
