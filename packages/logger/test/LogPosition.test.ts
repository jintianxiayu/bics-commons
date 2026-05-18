/**
 * LogPosition 单元测试
 */

import { LogPosition } from '../src/core/LogPosition';

describe('LogPosition', () => {
  describe('capture', () => {
    it('should capture caller position from stack', () => {
      const position = LogPosition.capture();

      expect(position).toMatch(/^.+:\d+:\d+$/);
    });

    it('should return valid file:line:column format', () => {
      const position = LogPosition.capture();
      // On Windows, paths contain drive letter like D:\, so we check format differently
      const parts = position.split(':');
      // Windows paths have drive letter, so we get 4 parts: D, \path, line, column
      // Or on Unix we get 3 parts: /path/to/file, line, column

      if (parts.length >= 3) {
        // Last two parts should be numbers (line and column)
        expect(parseInt(parts[parts.length - 2])).toBeGreaterThan(0);
        expect(parseInt(parts[parts.length - 1])).toBeGreaterThanOrEqual(0);
      } else {
        fail('Position should have at least 3 parts when split by :');
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