const INTERNAL_PATH_MARKERS = [
    '/src/core/LoggerFactory.',
    '/src/core/LogPosition.',
    '/dist/core/LoggerFactory.',
    '/dist/core/LogPosition.',
];
const FILE_URL_PREFIX = 'file://';
const NODE_MODULES_SEGMENT = 'node_modules';
const MAX_PATH_LENGTH = 120;
const LEADING_SEGMENT_COUNT = 3;
const TRAILING_SEGMENT_COUNT = 2;

function normalizePathSeparators(value: string): string {
    // 正则说明：\\ 精确匹配单个 Windows 反斜杠路径分隔符，g 标志替换全部分隔符以获得跨平台稳定路径。
    return value.replace(/\\/g, '/');
}

/**
 * 将 V8 栈中的文件标识转换为普通路径，避免文件 URL 阻断项目根目录和依赖边界匹配。
 *
 * @param value 栈帧中的原始文件标识。
 * @returns 统一分隔符并移除受支持文件 URL 协议后的路径。
 * @throws 不主动抛出异常；URL 解码失败时保留未解码路径。
 */
function normalizeFileIdentifier(value: string): string {
    const normalized = normalizePathSeparators(value);
    if (!normalized.startsWith(FILE_URL_PREFIX)) {
        return normalized;
    }

    const withoutScheme = normalized.slice(FILE_URL_PREFIX.length);
    // 正则说明：^/ 锁定文件 URL 的首个斜杠，[a-zA-Z]:/ 匹配 Windows 驱动器根，避免把 POSIX 根斜杠一并移除。
    const filePath = /^\/[a-zA-Z]:\//.test(withoutScheme)
        ? withoutScheme.slice(1)
        : withoutScheme.startsWith('/')
          ? withoutScheme
          : `//${withoutScheme}`;
    try {
        return decodeURI(filePath);
    } catch {
        return filePath;
    }
}

function isWindowsPath(value: string): boolean {
    // 正则说明：^[a-zA-Z]:/ 从开头匹配 Windows 驱动器路径；UNC 路径则由双斜杠前缀识别。
    return /^[a-zA-Z]:\//.test(value) || value.startsWith('//');
}

/**
 * 移除根目录末尾多余分隔符，同时保留 POSIX 根和 Windows 驱动器根的语义。
 *
 * @param value 已统一路径分隔符的目录。
 * @returns 可安全追加目录边界的根目录。
 * @throws 不主动抛出异常。
 */
function trimTrailingSeparators(value: string): string {
    // 正则说明：^[a-zA-Z]:/$ 完整匹配 Windows 驱动器根，防止去除其唯一的根目录分隔符。
    if (value === '/' || /^[a-zA-Z]:\/$/.test(value)) {
        return value;
    }
    // 正则说明：/+$ 匹配字符串末尾一个或多个斜杠，只清理冗余尾部分隔符而不改变中间路径。
    return value.replace(/\/+$/, '');
}

/**
 * 从最内层依赖边界提取包内路径，隐藏 pnpm 存储目录和外层依赖布局。
 *
 * @param file 已规范化的调用文件路径。
 * @returns 最后一个 node_modules 目录段后的路径；没有有效依赖边界时返回 undefined。
 * @throws 不主动抛出异常。
 */
function dependencyPath(file: string): string | undefined {
    const segments = file.split('/');
    const boundary = segments.lastIndexOf(NODE_MODULES_SEGMENT);
    if (boundary < 0 || boundary === segments.length - 1) {
        return undefined;
    }
    return segments.slice(boundary + 1).join('/');
}

/**
 * 在完整目录边界上移除项目根，避免相似前缀目录被错误转换为相对路径。
 *
 * @param file 已规范化的调用文件路径。
 * @param projectRoot Logger 初始化时固定的项目目录。
 * @returns 项目内相对路径；文件不属于项目目录时返回 undefined。
 * @throws 不主动抛出异常。
 */
function projectRelativePath(file: string, projectRoot: string): string | undefined {
    const root = trimTrailingSeparators(normalizeFileIdentifier(projectRoot));
    if (root.length === 0) {
        return undefined;
    }

    const prefix = root.endsWith('/') ? root : `${root}/`;
    const caseInsensitive = isWindowsPath(root);
    const comparableFile = caseInsensitive ? file.toLowerCase() : file;
    const comparablePrefix = caseInsensitive ? prefix.toLowerCase() : prefix;
    if (!comparableFile.startsWith(comparablePrefix)) {
        return undefined;
    }
    return file.slice(prefix.length);
}

/**
 * 在软长度上限之外折叠中间目录，同时保留路径身份和最终文件位置。
 *
 * @param file 已完成依赖或项目相对化的展示路径。
 * @returns 原路径或以单个省略段压缩后的路径。
 * @throws 不主动抛出异常。
 */
function compressPath(file: string): string {
    if (file.length <= MAX_PATH_LENGTH) {
        return file;
    }

    const segments = file.split('/');
    if (segments.length <= LEADING_SEGMENT_COUNT + TRAILING_SEGMENT_COUNT) {
        return file;
    }
    return [...segments.slice(0, LEADING_SEGMENT_COUNT), '...', ...segments.slice(-TRAILING_SEGMENT_COUNT)].join('/');
}

/**
 * 把调用文件格式化为稳定且紧凑的展示路径，供 Plain 与 JSON 日志共享。
 *
 * @param file 栈帧中的原始文件标识。
 * @param projectRoot Logger 初始化时固定的项目目录。
 * @returns 依赖相对路径、项目相对路径或规范化后的原始路径，必要时折叠中间目录。
 * @throws 不主动抛出异常。
 */
export function formatLogPositionPath(file: string, projectRoot: string): string {
    const normalizedFile = normalizeFileIdentifier(file);
    const displayPath =
        dependencyPath(normalizedFile) ?? projectRelativePath(normalizedFile, projectRoot) ?? normalizedFile;
    return compressPath(displayPath);
}

/**
 * 识别日志库和 Node.js 自身栈帧，防止调用位置指向基础设施实现。
 *
 * @param file 栈帧中的文件标识。
 * @returns 是否应从业务调用位置候选中排除。
 * @throws 不主动抛出异常。
 */
function isInternalFrame(file: string): boolean {
    const normalized = normalizeFileIdentifier(file);
    if (normalized.startsWith('node:internal') || normalized.includes('/node:internal/')) {
        return true;
    }
    return INTERNAL_PATH_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * 从 V8 栈文本中选择首个外部调用帧，并生成不含列号的稳定调用位置。
 *
 * @param stack V8 Error stack 文本。
 * @param projectRoot Logger 初始化时固定的项目目录。
 * @returns `path:line` 格式的位置；无法解析有效调用帧时返回 undefined。
 * @throws 不主动抛出异常。
 */
export function parseLogPositionStack(stack: string | undefined, projectRoot: string): string | undefined {
    if (!stack) {
        return undefined;
    }

    for (const rawLine of stack.split('\n').slice(1)) {
        const line = rawLine.trim();
        // 正则说明：可选括号兼容不同 V8 栈格式；(.+) 贪婪捕获可能含冒号的文件路径；两个 (\d+) 分别捕获行号和列号；$ 锁定栈帧末尾避免部分匹配。
        const match = line.match(/\(?(.+):(\d+):(\d+)\)?$/);
        if (!match) {
            continue;
        }

        // 正则说明：^at\s+ 从栈帧开头移除 at；(?:.+\s+\()? 非捕获地兼容函数名和左括号；\)$ 只移除末尾右括号，二者共同留下纯文件路径。
        const file = match[1]?.replace(/^at\s+(?:.+\s+\()?/, '').replace(/\)$/, '');
        const lineNumber = match[2];
        if (!file || !lineNumber || isInternalFrame(file)) {
            continue;
        }
        return `${formatLogPositionPath(file, projectRoot)}:${lineNumber}`;
    }
    return undefined;
}

/**
 * 捕获首个业务调用栈帧，帮助日志使用者定位调用点，同时隐藏日志库自身实现栈。
 *
 * @param projectRoot Logger 初始化时固定的项目目录。
 * @returns `path:line` 格式的位置；无法解析调用栈时返回 undefined。
 * @throws 不主动抛出异常。
 */
export function captureLogPosition(projectRoot = process.cwd()): string | undefined {
    const holder: { stack?: string } = {};
    Error.captureStackTrace(holder, captureLogPosition);
    return parseLogPositionStack(holder.stack, projectRoot);
}
