/**
 * 日志位置捕获
 *
 * 通过解析调用栈来定位业务代码的调用位置（相对路径:行号）
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const StackTraceParser = require('stacktrace-parser');

interface StackFrame {
    fileName: string;
    lineNumber: number;
    columnNumber: number;
    methodName?: string;
}

const EXCLUDE_PATTERNS: RegExp[] = [/\/packages\/logger\/src\//, /\/node_modules\//, /node:/];

// Project root directory for stripping absolute paths
const PROJECT_ROOT = (() => {
    // Use process.cwd() as the project root (the directory containing packages/)
    const cwd = process.cwd().replace(/\\/g, '/');
    return cwd.endsWith('/') ? cwd : cwd + '/';
})();

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
     * 从当前调用栈中找到第一个业务代码帧，返回 "relativePath:line" 格式的字符串
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
                let fileName = frame.fileName;
                // Normalize to forward slashes for consistent path comparison
                fileName = fileName.replace(/\\/g, '/');
                // Strip project root to get relative path
                if (PROJECT_ROOT && fileName.startsWith(PROJECT_ROOT)) {
                    fileName = fileName.substring(PROJECT_ROOT.length);
                }
                // Return simplified format: relativePath:line
                return `${fileName}:${frame.lineNumber}`;
            }
        }

        const lastFrame = stack[stack.length - 1];
        if (lastFrame) {
            let fileName = lastFrame.file || '';
            if (PROJECT_ROOT && fileName.startsWith(PROJECT_ROOT)) {
                fileName = fileName.substring(PROJECT_ROOT.length);
            }
            return `${fileName}:${lastFrame.lineNumber || 0}`;
        }

        return 'unknown:0';
    }
}
