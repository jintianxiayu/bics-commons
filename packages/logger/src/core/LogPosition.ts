const INTERNAL_PATH_MARKERS = [
    '/src/core/LoggerFactory.',
    '/src/core/LogPosition.',
    '/dist/core/LoggerFactory.',
    '/dist/core/LogPosition.',
];

function normalizePath(value: string): string {
    // 正则说明：\\ 精确匹配单个 Windows 反斜杠路径分隔符，g 标志替换全部分隔符，统一为 / 后才能与固定内部路径标记比较。
    return value.replace(/\\/g, '/');
}

/**
 * 识别日志库和 Node.js 自身栈帧，防止调用位置指向基础设施实现。
 *
 * @param file 栈帧中的文件标识。
 * @returns 是否应从业务调用位置候选中排除。
 * @throws 不主动抛出异常。
 */
function isInternalFrame(file: string): boolean {
    const normalized = normalizePath(file);
    if (normalized.startsWith('node:internal') || normalized.includes('/node:internal/')) {
        return true;
    }
    return INTERNAL_PATH_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * 捕获首个业务调用栈帧，帮助日志使用者定位调用点，同时隐藏日志库自身实现栈。
 *
 * @returns `file:line` 格式的位置；无法解析调用栈时返回 undefined。
 * @throws 不主动抛出异常。
 */
export function captureLogPosition(): string | undefined {
    const holder: { stack?: string } = {};
    Error.captureStackTrace(holder, captureLogPosition);
    if (!holder.stack) {
        return undefined;
    }

    for (const rawLine of holder.stack.split('\n').slice(1)) {
        const line = rawLine.trim();
        // 正则说明：可选括号兼容不同 V8 栈格式；(.+) 贪婪捕获可能含冒号的文件路径；两个 (\d+) 分别捕获行号和列号；$ 锁定栈帧末尾避免部分匹配。
        const match = line.match(/\(?(.+):(\d+):(\d+)\)?$/);
        if (!match) {
            continue;
        }

        // 正则说明：^at\s+ 从栈帧开头移除 at；(?:.+\s+\()? 非捕获地兼容函数名和左括号；\)$ 只移除末尾右括号，二者共同留下纯文件路径。
        const file = match[1]?.replace(/^at\s+(?:.+\s+\()?/, '').replace(/\)$/, '');
        const lineNumber = match[2];
        // 跳过日志库内部栈帧，确保返回的位置指向实际发起日志调用的业务代码。
        if (!file || !lineNumber || isInternalFrame(file)) {
            continue;
        }
        return `${file}:${lineNumber}`;
    }
    return undefined;
}
