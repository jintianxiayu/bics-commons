import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_LOGGER_PROFILE, DEFAULT_MASKING_CONFIG, DEFAULT_PROCESS_ERROR_CONFIG } from '../config/defaultConfig';
import type {
    EffectiveConsoleConfig,
    EffectiveFileConfig,
    EffectiveLoggerProfile,
    EffectiveMaskingConfig,
    EffectiveProcessErrorConfig,
    NormalizedLoggerConfig,
} from './model';
import type { LoggerConfig, LogFormatName, LogLevelName } from '../types';
import { LoggerConfigError } from './errors';
import { validatePlainPattern } from '../format/PlainFormat';
import { validateMaskTemplate } from './SensitiveMasker';

/** 配置映射中 K 为原始字段名，V 为尚未完成类型校验的外部输入值。 */
type UnknownRecord = Record<string, unknown>;

/** 命名日志器只覆盖根配置中的局部字段，因此解析阶段使用该补丁结构保留“未配置”的语义。 */
interface LoggerPatch {
    readonly level?: LogLevelName;
    readonly captureLogPosition?: boolean;
    readonly console?: Partial<EffectiveConsoleConfig>;
    readonly file?: Partial<EffectiveFileConfig>;
}

/** 测试或嵌入式应用可注入环境变量与工作目录，以复用生产配置解析流程而不修改进程全局状态。 */
export interface ConfigLoaderOptions {
    /** 环境变量映射中 K 为变量名，V 为变量值；undefined 表示该变量未配置。 */
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly cwd?: string;
}

const TOP_LEVEL_KEYS = new Set(['root', 'loggers', 'masking', 'processErrors']);
const LOGGER_KEYS = new Set(['level', 'captureLogPosition', 'console', 'file']);
const CONSOLE_KEYS = new Set(['enabled', 'colors', 'format', 'pattern']);
const FILE_KEYS = new Set([
    'enabled',
    'format',
    'pattern',
    'dirname',
    'filename',
    'datePattern',
    'maxSize',
    'maxFiles',
]);
const MASKING_KEYS = new Set(['enabled', 'fields']);
const PROCESS_ERROR_KEYS = new Set(['uncaughtException', 'unhandledRejection', 'exitOnError']);
const LEVELS = new Set<LogLevelName>(['debug', 'info', 'warn', 'error']);
const FORMATS = new Set<LogFormatName>(['plain', 'json']);

/**
 * 配置只接受普通映射，避免数组或带自定义原型的对象影响字段校验。
 *
 * @param value 待判断的配置值。
 * @returns 值是否为普通对象或无原型对象。
 * @throws 不主动抛出异常。
 */
function isRecord(value: unknown): value is UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * 在进入字段解析前统一收窄映射类型，使配置错误携带准确路径。
 *
 * @param value 待校验的配置值。
 * @param fieldPath 该值在配置文档中的路径。
 * @returns 通过校验的配置映射。
 * @throws {LoggerConfigError} 当配置值不是普通映射时抛出。
 */
function requireRecord(value: unknown, fieldPath: string): UnknownRecord {
    if (!isRecord(value)) {
        throw new LoggerConfigError(`${fieldPath} must be a mapping`);
    }
    return value;
}

/**
 * 拒绝未知字段，避免部署时的拼写错误被静默忽略并使用默认配置。
 *
 * @param record 待检查的配置映射。
 * @param allowed 当前配置层级允许的字段名。
 * @param fieldPath 当前配置层级的路径。
 * @returns 无返回值。
 * @throws {LoggerConfigError} 当映射包含未知字段时抛出。
 */
function assertKnownKeys(record: UnknownRecord, allowed: ReadonlySet<string>, fieldPath: string): void {
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) {
            throw new LoggerConfigError(`Unknown configuration field: ${fieldPath}.${key}`);
        }
    }
}

/**
 * 读取可选布尔配置，同时区分“未配置”和显式配置为 false。
 *
 * @param record 配置映射。
 * @param key 待读取的字段名。
 * @param fieldPath 当前配置层级的路径。
 * @returns 布尔值；字段缺失时返回 undefined。
 * @throws {LoggerConfigError} 当字段值不是布尔类型时抛出。
 */
function optionalBoolean(record: UnknownRecord, key: string, fieldPath: string): boolean | undefined {
    const value = record[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'boolean') {
        throw new LoggerConfigError(`${fieldPath}.${key} must be a boolean`);
    }
    return value;
}

/**
 * 读取需要参与路径或模板处理的可选字符串，提前拒绝没有业务意义的空值。
 *
 * @param record 配置映射。
 * @param key 待读取的字段名。
 * @param fieldPath 当前配置层级的路径。
 * @returns 非空字符串；字段缺失时返回 undefined。
 * @throws {LoggerConfigError} 当字段值不是非空字符串时抛出。
 */
function optionalNonEmptyString(record: UnknownRecord, key: string, fieldPath: string): string | undefined {
    const value = record[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || value.length === 0) {
        throw new LoggerConfigError(`${fieldPath}.${key} must be a non-empty string`);
    }
    return value;
}

/**
 * 将外部格式名称收窄为日志库支持的格式，避免无效值进入渲染阶段。
 *
 * @param value 待解析的格式值。
 * @param fieldPath 该值在配置文档中的路径。
 * @returns 支持的格式；字段缺失时返回 undefined。
 * @throws {LoggerConfigError} 当格式名称不受支持时抛出。
 */
function parseFormat(value: unknown, fieldPath: string): LogFormatName | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || !FORMATS.has(value as LogFormatName)) {
        throw new LoggerConfigError(`${fieldPath} must be one of: plain, json`);
    }
    return value as LogFormatName;
}

/**
 * 将外部级别名称收窄为日志库支持的级别，保证后续优先级比较完整。
 *
 * @param value 待解析的日志级别。
 * @param fieldPath 该值在配置文档中的路径。
 * @returns 支持的日志级别；字段缺失时返回 undefined。
 * @throws {LoggerConfigError} 当日志级别不受支持时抛出。
 */
function parseLevel(value: unknown, fieldPath: string): LogLevelName | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || !LEVELS.has(value as LogLevelName)) {
        throw new LoggerConfigError(`${fieldPath} must be one of: debug, info, warn, error`);
    }
    return value as LogLevelName;
}

/**
 * 校验文件轮转大小，防止无效上限导致传输层运行期失败。
 *
 * @param value 待解析的大小配置。
 * @param fieldPath 该值在配置文档中的路径。
 * @returns 正数字节数或带单位的大小；字段缺失时返回 undefined。
 * @throws {LoggerConfigError} 当大小不是受支持的正值时抛出。
 */
function parseMaxSize(value: unknown, fieldPath: string): number | string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === 'number') {
        if (Number.isFinite(value) && value > 0) {
            return value;
        }
        throw new LoggerConfigError(`${fieldPath} must be positive`);
    }
    // 正则说明：^ 和 $ 限制完整输入；\d+ 是整数部分；(?:\.\d+)? 允许可选小数；[kmg]? 允许可选且忽略大小写的容量单位，避免接受负数、空单位或尾随文本。
    if (typeof value === 'string' && /^\d+(?:\.\d+)?[kmg]?$/i.test(value)) {
        return value;
    }
    throw new LoggerConfigError(`${fieldPath} must be bytes or a positive k/m/g size`);
}

/**
 * 校验文件保留数量或天数，避免错误的清理策略长期堆积或立即删除日志。
 *
 * @param value 待解析的保留配置。
 * @param fieldPath 该值在配置文档中的路径。
 * @returns 正整数或天数表达式；字段缺失时返回 undefined。
 * @throws {LoggerConfigError} 当保留配置不是受支持的正值时抛出。
 */
function parseMaxFiles(value: unknown, fieldPath: string): number | string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === 'number') {
        if (Number.isSafeInteger(value) && value > 0) {
            return value;
        }
        throw new LoggerConfigError(`${fieldPath} must be a positive integer`);
    }
    // 正则说明：^ 和 $ 要求完整输入仅由数字及可选 d/D 组成；\d+ 表示文件数量，d? 表示按天保留，额外排除前导 0 以拒绝零值和歧义写法。
    if (typeof value === 'string' && /^\d+d?$/i.test(value) && !value.startsWith('0')) {
        return value;
    }
    throw new LoggerConfigError(`${fieldPath} must be a positive file count or day count such as 7d`);
}

/**
 * 将单个日志器的用户配置解析为补丁，保留其对根配置的继承关系。
 *
 * 详细设计：
 * 1. 先把输入限制为普通映射并拒绝未知顶层字段，确保配置拼写错误不会被默认值掩盖。
 * 2. 控制台与文件配置分别校验允许字段和数据类型，只把用户显式提供的值写入局部补丁。
 * 3. 最后解析日志级别和调用位置开关，通过条件展开保留 undefined 与 false 的差异，供后续继承合并使用。
 *
 * @param value 待解析的日志器配置。
 * @param fieldPath 该日志器在配置文档中的路径。
 * @returns 只包含显式配置字段的日志器补丁。
 * @throws {LoggerConfigError} 当字段未知、类型错误或取值无效时抛出。
 */
function parseLoggerPatch(value: unknown, fieldPath: string): LoggerPatch {
    const record = requireRecord(value, fieldPath);
    assertKnownKeys(record, LOGGER_KEYS, fieldPath);

    const consoleValue = record.console;
    let consolePatch: Partial<EffectiveConsoleConfig> | undefined;
    if (consoleValue !== undefined) {
        const consoleRecord = requireRecord(consoleValue, `${fieldPath}.console`);
        assertKnownKeys(consoleRecord, CONSOLE_KEYS, `${fieldPath}.console`);
        const enabled = optionalBoolean(consoleRecord, 'enabled', `${fieldPath}.console`);
        const colors = optionalBoolean(consoleRecord, 'colors', `${fieldPath}.console`);
        const format = parseFormat(consoleRecord.format, `${fieldPath}.console.format`);
        const pattern = optionalNonEmptyString(consoleRecord, 'pattern', `${fieldPath}.console`);
        consolePatch = {
            ...(enabled !== undefined ? { enabled } : {}),
            ...(colors !== undefined ? { colors } : {}),
            ...(format !== undefined ? { format } : {}),
            ...(pattern !== undefined ? { pattern } : {}),
        };
    }

    const fileValue = record.file;
    let filePatch: Partial<EffectiveFileConfig> | undefined;
    if (fileValue !== undefined) {
        const fileRecord = requireRecord(fileValue, `${fieldPath}.file`);
        assertKnownKeys(fileRecord, FILE_KEYS, `${fieldPath}.file`);
        const enabled = optionalBoolean(fileRecord, 'enabled', `${fieldPath}.file`);
        const format = parseFormat(fileRecord.format, `${fieldPath}.file.format`);
        const pattern = optionalNonEmptyString(fileRecord, 'pattern', `${fieldPath}.file`);
        const dirname = optionalNonEmptyString(fileRecord, 'dirname', `${fieldPath}.file`);
        const filename = optionalNonEmptyString(fileRecord, 'filename', `${fieldPath}.file`);
        const datePattern = optionalNonEmptyString(fileRecord, 'datePattern', `${fieldPath}.file`);
        const maxSize = parseMaxSize(fileRecord.maxSize, `${fieldPath}.file.maxSize`);
        const maxFiles = parseMaxFiles(fileRecord.maxFiles, `${fieldPath}.file.maxFiles`);
        filePatch = {
            ...(enabled !== undefined ? { enabled } : {}),
            ...(format !== undefined ? { format } : {}),
            ...(pattern !== undefined ? { pattern } : {}),
            ...(dirname !== undefined ? { dirname } : {}),
            ...(filename !== undefined ? { filename } : {}),
            ...(datePattern !== undefined ? { datePattern } : {}),
            ...(maxSize !== undefined ? { maxSize } : {}),
            ...(maxFiles !== undefined ? { maxFiles } : {}),
        };
    }

    const level = parseLevel(record.level, `${fieldPath}.level`);
    const captureLogPosition = optionalBoolean(record, 'captureLogPosition', fieldPath);
    return {
        ...(level !== undefined ? { level } : {}),
        ...(captureLogPosition !== undefined ? { captureLogPosition } : {}),
        ...(consolePatch !== undefined ? { console: consolePatch } : {}),
        ...(filePatch !== undefined ? { file: filePatch } : {}),
    };
}

/**
 * 合并日志器配置并预先验证纯文本模板，使运行期读取到完整且可执行的策略。
 *
 * @param base 被继承的完整日志器策略。
 * @param patch 用户显式提供的局部覆盖。
 * @param cwd 相对文件目录的解析基准。
 * @returns 冻结后的完整日志器策略。
 * @throws {LoggerConfigError} 当纯文本模板无效时抛出。
 */
function mergeProfile(base: EffectiveLoggerProfile, patch: LoggerPatch, cwd: string): EffectiveLoggerProfile {
    const dirname = patch.file?.dirname;
    const console = Object.freeze({ ...base.console, ...patch.console });
    const file = Object.freeze({
        ...base.file,
        ...patch.file,
        dirname: dirname === undefined ? base.file.dirname : resolve(cwd, dirname),
    });
    if (console.format === 'plain') {
        validatePlainPattern(console.pattern);
    }
    if (file.format === 'plain') {
        validatePlainPattern(file.pattern);
    }

    const profile: EffectiveLoggerProfile = {
        level: patch.level ?? base.level,
        captureLogPosition: patch.captureLogPosition ?? base.captureLogPosition,
        console,
        file,
    };
    return Object.freeze(profile);
}

/**
 * 为当前工作目录创建独立的默认配置快照，避免默认对象被调用方共享修改。
 *
 * @param cwd 默认日志目录的解析基准。
 * @returns 路径已解析且冻结的默认日志器策略。
 * @throws 不主动抛出异常。
 */
function normalizeDefaultProfile(cwd: string): EffectiveLoggerProfile {
    return Object.freeze({
        ...DEFAULT_LOGGER_PROFILE,
        console: Object.freeze({ ...DEFAULT_LOGGER_PROFILE.console }),
        file: Object.freeze({
            ...DEFAULT_LOGGER_PROFILE.file,
            dirname: resolve(cwd, DEFAULT_LOGGER_PROFILE.file.dirname),
        }),
    });
}

/**
 * 编译应用的敏感字段策略，使重复或无效模板在启动阶段直接失败。
 *
 * @param value 用户提供的脱敏配置。
 * @returns 冻结后的有效脱敏配置。
 * @throws {LoggerConfigError} 当字段重复、类型错误或模板无效时抛出。
 */
function parseMasking(value: unknown): EffectiveMaskingConfig {
    if (value === undefined) {
        return DEFAULT_MASKING_CONFIG;
    }
    const record = requireRecord(value, 'masking');
    assertKnownKeys(record, MASKING_KEYS, 'masking');
    const enabled = optionalBoolean(record, 'enabled', 'masking') ?? DEFAULT_MASKING_CONFIG.enabled;
    const fieldsValue = record.fields;
    if (fieldsValue === undefined) {
        return Object.freeze({ enabled, fields: Object.freeze({}) });
    }

    const fieldsRecord = requireRecord(fieldsValue, 'masking.fields');
    /** 脱敏字段映射中 K 为保持原始大小写的业务字段名，V 为已通过语法校验的掩码模板。 */
    const fields: Record<string, string> = Object.create(null) as Record<string, string>;
    const normalizedNames = new Set<string>();
    for (const [field, template] of Object.entries(fieldsRecord)) {
        if (field.length === 0 || typeof template !== 'string') {
            throw new LoggerConfigError(`masking.fields.${field} must be a string template`);
        }
        const normalized = field.toLowerCase();
        // 运行期字段匹配不区分大小写，因此配置阶段必须拒绝实际会互相覆盖的名称。
        if (normalizedNames.has(normalized)) {
            throw new LoggerConfigError(`Duplicate case-insensitive masking field: ${field}`);
        }
        validateMaskTemplate(template);
        normalizedNames.add(normalized);
        fields[field] = template;
    }
    return Object.freeze({ enabled, fields: Object.freeze(fields) });
}

/**
 * 合并进程错误处理开关，确保未配置项保持日志库默认行为。
 *
 * @param value 用户提供的进程错误配置。
 * @returns 冻结后的有效进程错误配置。
 * @throws {LoggerConfigError} 当字段未知或值不是布尔类型时抛出。
 */
function parseProcessErrors(value: unknown): EffectiveProcessErrorConfig {
    if (value === undefined) {
        return DEFAULT_PROCESS_ERROR_CONFIG;
    }
    const record = requireRecord(value, 'processErrors');
    assertKnownKeys(record, PROCESS_ERROR_KEYS, 'processErrors');
    return Object.freeze({
        uncaughtException:
            optionalBoolean(record, 'uncaughtException', 'processErrors') ??
            DEFAULT_PROCESS_ERROR_CONFIG.uncaughtException,
        unhandledRejection:
            optionalBoolean(record, 'unhandledRejection', 'processErrors') ??
            DEFAULT_PROCESS_ERROR_CONFIG.unhandledRejection,
        exitOnError:
            optionalBoolean(record, 'exitOnError', 'processErrors') ?? DEFAULT_PROCESS_ERROR_CONFIG.exitOnError,
    });
}

/**
 * 校验并归一化整份配置文档，建立根日志器与命名日志器的最终继承关系。
 *
 * @param value YAML 或配置对象解析得到的文档。
 * @param cwd 相对路径的解析基准。
 * @returns 日志运行时使用的只读配置快照。
 * @throws {LoggerConfigError} 当文档结构、字段或输出组合无效时抛出。
 */
function parseDocument(value: unknown, cwd: string): NormalizedLoggerConfig {
    const document = requireRecord(value, 'config');
    assertKnownKeys(document, TOP_LEVEL_KEYS, 'config');

    const defaultProfile = normalizeDefaultProfile(cwd);
    const rootPatch = document.root === undefined ? {} : parseLoggerPatch(document.root, 'root');
    const root = mergeProfile(defaultProfile, rootPatch, cwd);
    /** 命名日志器映射中 K 为去除首尾空白后的日志器名称，V 为继承根策略后的完整配置。 */
    const loggers = new Map<string, EffectiveLoggerProfile>();

    // 命名日志器继承已合并的根配置，保证局部覆盖不会意外丢失应用级默认策略。
    if (document.loggers !== undefined) {
        const loggerRecords = requireRecord(document.loggers, 'loggers');
        for (const [rawName, loggerValue] of Object.entries(loggerRecords)) {
            const name = rawName.trim();
            if (name.length === 0 || name !== rawName) {
                throw new LoggerConfigError(`Logger name must be non-empty and trimmed: ${JSON.stringify(rawName)}`);
            }
            if (loggers.has(name)) {
                throw new LoggerConfigError(`Duplicate logger name: ${name}`);
            }
            loggers.set(name, mergeProfile(root, parseLoggerPatch(loggerValue, `loggers.${name}`), cwd));
        }
    }

    const masking = parseMasking(document.masking);
    const processErrors = parseProcessErrors(document.processErrors);
    if (
        (processErrors.uncaughtException || processErrors.unhandledRejection) &&
        !root.console.enabled &&
        !root.file.enabled
    ) {
        throw new LoggerConfigError('processErrors requires at least one enabled root transport');
    }

    return Object.freeze({ root, loggers, masking, processErrors });
}

/** 将用户配置校验并归一化为只读快照，避免无效配置进入日志写入和传输阶段。 */
export class ConfigLoader {
    /** 环境变量映射中 K 为变量名，V 为变量值；undefined 表示该变量未配置。 */
    private readonly env: Readonly<Record<string, string | undefined>>;
    private readonly cwd: string;

    /**
     * 创建配置加载器，并允许测试隔离环境变量与当前目录。
     *
     * @param options 可选的环境变量和工作目录来源。
     * @returns 新的配置加载器实例。
     * @throws 不主动抛出异常。
     */
    constructor(options: ConfigLoaderOptions = {}) {
        this.env = options.env ?? process.env;
        this.cwd = options.cwd ?? process.cwd();
    }

    /**
     * 按“显式对象或路径、环境变量、默认配置”的优先级加载配置，避免部署配置被静默覆盖。
     *
     * @param source 显式配置对象或配置文件路径。
     * @returns 校验、合并并冻结后的日志配置。
     * @throws {LoggerConfigError} 当路径、YAML 内容或配置字段无效时抛出。
     */
    load(source?: string | LoggerConfig): NormalizedLoggerConfig {
        // 显式配置必须优先且失败即报错，避免悄然回退到环境变量或默认值后掩盖部署错误。
        if (source !== undefined && typeof source !== 'string') {
            return parseDocument(source, this.cwd);
        }

        const configuredPath = source ?? this.env.LOGGER_CONFIG_PATH;
        if (configuredPath === undefined) {
            return parseDocument({}, this.cwd);
        }
        if (configuredPath.trim().length === 0) {
            const sourceName = source === undefined ? 'LOGGER_CONFIG_PATH' : 'Logger configuration path';
            throw new LoggerConfigError(`${sourceName} must not be empty`);
        }

        const resolvedPath = isAbsolute(configuredPath) ? configuredPath : resolve(this.cwd, configuredPath);
        let fileContent: string;
        try {
            fileContent = readFileSync(resolvedPath, 'utf8');
        } catch (error) {
            throw new LoggerConfigError(`Unable to read logger configuration: ${resolvedPath}`, {
                cause: error,
            });
        }

        let document: unknown;
        try {
            document = parseYaml(fileContent);
        } catch (error) {
            throw new LoggerConfigError(`Invalid YAML logger configuration: ${resolvedPath}`, {
                cause: error,
            });
        }
        if (document === null || document === undefined) {
            throw new LoggerConfigError(`Logger configuration must be a YAML mapping: ${resolvedPath}`);
        }
        return parseDocument(document, this.cwd);
    }
}
