const UNSERIALIZABLE_META = Object.freeze({
    serializationError: '[Unserializable metadata]',
});

/** 元数据规范化同时返回可安全输出的值与降级原因，便于主日志链路不中断地报告诊断。 */
export interface MetadataNormalizationResult {
    readonly meta?: unknown;
    readonly issue?: string;
}

interface NormalizationState {
    issue?: string;
}

function errorType(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError';
}

/**
 * 以数据属性写入用户键名，避免 `__proto__` 等特殊键触发原型 setter。
 *
 * @param target 规范化结果映射；K 为原始属性名，V 为已规范化的属性值。
 * @param key 需要原样保留的用户键名。
 * @param value 已规范化的属性值。
 * @returns 无返回值。
 * @throws 当目标对象拒绝定义属性时透传对应异常。
 */
function assignOwn(target: Record<string, unknown>, key: string, value: unknown): void {
    // defineProperty 可避免 __proto__ 等特殊键触发原型 setter，原样保留用户元数据键名。
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
    });
}

/**
 * 递归复制业务元数据并转换 JSON 不支持的值，防止单个字段破坏整条日志。
 *
 * 详细设计：
 * 1. 原始值先按 JSON 兼容性转换，undefined、bigint、symbol、函数和非有限数字使用稳定文本表示。
 * 2. 对象按当前递归链检测循环；Error 保留诊断字段，TypedArray 转为数组，其他对象只复制可枚举自有属性。
 * 3. 所有对象在 finally 中退出当前递归链，使共享引用可以在不同分支完整出现，同时真正的循环被安全占位。
 *
 * @param value 当前待规范化的值；若为键值对象，K 为原始属性名，V 为对应的未知业务值。
 * @param ancestors 当前递归路径上的对象集合。
 * @param state 用于汇总可降级诊断的共享状态。
 * @returns 可安全交给脱敏和渲染链路的副本。
 * @throws 当对象属性读取或集合遍历自身抛出异常时透传。
 */
function normalizeValue(value: unknown, ancestors: WeakSet<object>, state: NormalizationState): unknown {
    if (value === undefined) {
        return '[undefined]';
    }
    if (typeof value === 'bigint') {
        return `${value}n`;
    }
    if (typeof value === 'symbol') {
        return `[Symbol ${value.description ?? ''}]`;
    }
    if (typeof value === 'function') {
        return `[Function ${value.name || 'anonymous'}]`;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return String(value);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }

    if (ancestors.has(value)) {
        state.issue ??= 'CircularReference';
        return '[Circular]';
    }

    // WeakSet 只跟踪当前递归路径，既能截断真正的环，也允许同一对象在不同分支重复出现。
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item) => normalizeValue(item, ancestors, state));
        }

        if (value instanceof Error) {
            /** 错误对象映射中 K 为标准或自定义错误字段名，V 为完成递归规范化后的字段值。 */
            const normalizedError: Record<string, unknown> = {
                name: value.name,
                message: value.message,
                stack: value.stack ?? '',
            };
            for (const key of Object.keys(value)) {
                if (key === 'name' || key === 'message' || key === 'stack') {
                    continue;
                }
                assignOwn(
                    normalizedError,
                    key,
                    normalizeValue((value as unknown as Record<string, unknown>)[key], ancestors, state)
                );
            }
            return normalizedError;
        }

        if (ArrayBuffer.isView(value)) {
            return Array.from(value as unknown as ArrayLike<number>);
        }

        /** 普通对象映射中 K 为原始可枚举属性名，V 为完成递归规范化后的属性值。 */
        const normalizedObject: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            assignOwn(normalizedObject, key, normalizeValue((value as Record<string, unknown>)[key], ancestors, state));
        }
        return normalizedObject;
    } finally {
        ancestors.delete(value);
    }
}

/**
 * 判断单个元数据参数是否可直接作为字段集合，避免类实例被错误展开为业务对象。
 *
 * @param value 待判断的元数据值。
 * @returns 值是否为普通对象或无原型对象。
 * @throws 不主动抛出异常。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * 将业务传入的任意元数据转换为可序列化副本，避免异常值阻断主日志写入。
 *
 * @param metaArguments 日志方法接收的元数据参数列表。
 * @returns 规范化元数据及可选的降级诊断原因。
 * @throws 不主动抛出异常；内部错误会转换为安全占位数据。
 */
export function normalizeMetadata(metaArguments: readonly unknown[]): MetadataNormalizationResult {
    if (metaArguments.length === 0) {
        return {};
    }

    try {
        const rawMetadata =
            metaArguments.length === 1 && isPlainObject(metaArguments[0])
                ? metaArguments[0]
                : { args: [...metaArguments] };
        const state: NormalizationState = {};
        const meta = normalizeValue(rawMetadata, new WeakSet<object>(), state);
        return {
            meta,
            ...(state.issue !== undefined ? { issue: state.issue } : {}),
        };
    } catch (error) {
        return { meta: UNSERIALIZABLE_META, issue: errorType(error) };
    }
}
