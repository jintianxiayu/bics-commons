/**
 * 日志位置捕获
 *
 * 通过解析调用栈来定位业务代码的调用位置（文件:行号:列号）
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const StackTraceParser = require('stacktrace-parser');

interface StackFrame {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
  methodName?: string;
}

const EXCLUDE_PATTERNS: RegExp[] = [
  /\/packages\/logger\/src\//,
  /\/node_modules\//,
  /node:/,
];

const EXCLUDE_METHOD_PREFIXES: string[] = [
  'Logger.',
  'LoggerFactory.',
  'Formatter.',
  'PatternFormatter.',
  'Transport.',
  'ConfigLoader.',
];

export class LogPosition {
  private static isInternalFrame(frame: StackFrame): boolean {
    let fileName = frame.fileName || '';
    // Normalize Windows backslashes to forward slashes for consistent pattern matching
    fileName = fileName.replace(/\\/g, '/');

    for (const pattern of EXCLUDE_PATTERNS) {
      if (pattern.test(fileName)) {
        return true;
      }
    }

    const methodName = frame.methodName || '';
    for (const prefix of EXCLUDE_METHOD_PREFIXES) {
      if (methodName.startsWith(prefix)) {
        return true;
      }
    }

    if (methodName === 'debug' || methodName === 'info' || methodName === 'warn' || methodName === 'error') {
      return true;
    }

    return false;
  }

  /**
   * 捕获调用位置
   *
   * 从当前调用栈中找到第一个业务代码帧，返回 "file:line:column" 格式的字符串
   */
  static capture(): string {
    const originalLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 200;
    const error = new Error();
    Error.stackTraceLimit = originalLimit;
    const stack = StackTraceParser.parse(error.stack || '');

    for (let i = 1; i < stack.length; i++) {
      const rawFrame = stack[i];
      const frame: StackFrame = {
        fileName: rawFrame.file || '',
        lineNumber: rawFrame.lineNumber || 0,
        columnNumber: rawFrame.column || 0,
        methodName: rawFrame.methodName,
      };

      if (!this.isInternalFrame(frame)) {
        return `${frame.fileName}:${frame.lineNumber}:${frame.columnNumber}`;
      }
    }

    const lastFrame = stack[stack.length - 1];
    if (lastFrame) {
      return `${lastFrame.file || ''}:${lastFrame.lineNumber || 0}:${lastFrame.column || 0}`;
    }

    return 'unknown:0:0';
  }
}