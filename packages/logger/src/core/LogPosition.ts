/**
 * 日志位置捕获
 *
 * 通过解析调用栈定位第一个外部调用帧，并返回安全的“路径:行:列”。
 */

import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const StackTraceParser = require('stacktrace-parser') as {
    parse(stack: string): RawStackFrame[];
};

interface RawStackFrame {
    file?: string | null;
    lineNumber?: number | null;
    column?: number | null;
    methodName?: string | null;
}

export interface LogPositionStackFrame {
    fileName: string;
    lineNumber: number;
    columnNumber: number;
    methodName?: string;
}

interface CaptureDependencies {
    createStack(): string;
    parseStack(stack: string): RawStackFrame[];
    cwd(): string;
}

export const UNKNOWN_LOG_POSITION = 'unknown:0:0';

const LOGGER_FRAME_PATTERN =
    /(?:^|\/)(?:(?:packages\/logger)|(?:node_modules\/@jintianxiayu\/logger))\/(?:src|dist)\/(?:core\/(?:LogPosition|LoggerFactory)|formatters\/PatternFormatter)(?:\.[cm]?[jt]s)?$/i;
const INFRASTRUCTURE_FRAME_PATTERNS = [
    /(?:^|\/)node_modules\/stacktrace-parser\//i,
    /(?:^|\/)node_modules\/winston\//i,
    /(?:^|\/)node_modules\/winston-transport\//i,
    /(?:^|\/)node_modules\/logform\//i,
];
const WINDOWS_DRIVE_PATTERN = /^[a-z]:\//i;
const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

function safeInteger(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function decodeFileName(fileName: string): string | null {
    if (fileName === '' || fileName.startsWith('node:') || fileName.startsWith('internal/')) return null;

    let decoded = fileName;
    if (/^file:/i.test(decoded)) {
        try {
            const url = new URL(decoded);
            if (url.protocol !== 'file:') return null;
            const host = url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}` : '';
            decoded = `${host}${decodeURIComponent(url.pathname)}`;
            if (/^\/[a-z]:\//i.test(decoded)) decoded = decoded.slice(1);
        } catch {
            return null;
        }
    } else if (SCHEME_PATTERN.test(decoded) && !WINDOWS_DRIVE_PATTERN.test(decoded.replace(/\\/g, '/'))) {
        return null;
    }

    decoded = decoded.replace(/\\/g, '/');
    if (decoded === '' || decoded.startsWith('[') || decoded.includes('\0')) return null;
    return decoded;
}

function normalizeFrame(rawFrame: RawStackFrame): LogPositionStackFrame | null {
    const fileName = decodeFileName(rawFrame.file ?? '');
    if (!fileName) return null;
    return {
        fileName,
        lineNumber: safeInteger(rawFrame.lineNumber),
        columnNumber: safeInteger(rawFrame.column),
        methodName: rawFrame.methodName ?? undefined,
    };
}

function isInternalFrame(frame: LogPositionStackFrame): boolean {
    const fileName = frame.fileName.replace(/\\/g, '/');
    if (fileName.startsWith('node:') || fileName.startsWith('internal/')) return true;
    if (LOGGER_FRAME_PATTERN.test(fileName)) return true;
    return INFRASTRUCTURE_FRAME_PATTERNS.some((pattern) => pattern.test(fileName));
}

function selectCallerFrame(frames: RawStackFrame[]): LogPositionStackFrame | null {
    for (const rawFrame of frames) {
        const frame = normalizeFrame(rawFrame);
        if (frame && !isInternalFrame(frame)) return frame;
    }
    return null;
}

function pathFlavor(fileName: string, cwd: string): typeof path.posix | typeof path.win32 {
    return WINDOWS_DRIVE_PATTERN.test(fileName) || WINDOWS_DRIVE_PATTERN.test(cwd) ? path.win32 : path.posix;
}

function formatFramePath(fileName: string, cwd: string): string | null {
    const decodedFile = decodeFileName(fileName);
    const decodedCwd = decodeFileName(cwd);
    if (!decodedFile || !decodedCwd) return null;

    const flavor = pathFlavor(decodedFile, decodedCwd);
    const normalizedFile = flavor.normalize(decodedFile).replace(/\\/g, '/');
    const normalizedCwd = flavor.normalize(decodedCwd).replace(/\\/g, '/');

    if (!flavor.isAbsolute(decodedFile)) {
        const relativeFile = normalizedFile.replace(/^\.\//, '');
        if (relativeFile === '..' || relativeFile.startsWith('../')) return flavor.basename(normalizedFile);
        return relativeFile;
    }

    const relative = flavor.relative(normalizedCwd, normalizedFile).replace(/\\/g, '/');
    const isWithinCwd =
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith('../') &&
        !path.posix.isAbsolute(relative) &&
        !WINDOWS_DRIVE_PATTERN.test(relative);
    return isWithinCwd ? relative : flavor.basename(normalizedFile);
}

function renderPosition(frame: LogPositionStackFrame, cwd: string): string {
    const fileName = formatFramePath(frame.fileName, cwd);
    if (!fileName) return UNKNOWN_LOG_POSITION;
    return `${fileName}:${safeInteger(frame.lineNumber)}:${safeInteger(frame.columnNumber)}`;
}

function createCurrentStack(): string {
    const error = new Error();
    if (Error.captureStackTrace) Error.captureStackTrace(error, LogPosition.capture);
    return error.stack ?? '';
}

const DEFAULT_DEPENDENCIES: CaptureDependencies = {
    createStack: createCurrentStack,
    parseStack: (stack) => StackTraceParser.parse(stack),
    cwd: () => process.cwd(),
};

function capturePosition(dependencies: CaptureDependencies = DEFAULT_DEPENDENCIES): string {
    try {
        const stack = dependencies.createStack();
        if (!stack) return UNKNOWN_LOG_POSITION;
        const frame = selectCallerFrame(dependencies.parseStack(stack));
        return frame ? renderPosition(frame, dependencies.cwd()) : UNKNOWN_LOG_POSITION;
    } catch {
        return UNKNOWN_LOG_POSITION;
    }
}

export const __logPositionInternals = {
    capturePosition,
    decodeFileName,
    formatFramePath,
    isInternalFrame,
    normalizeFrame,
    renderPosition,
    safeInteger,
    selectCallerFrame,
};

export class LogPosition {
    /** 捕获第一个外部调用位置，失败时返回 unknown:0:0。 */
    static capture(): string {
        return capturePosition();
    }
}
