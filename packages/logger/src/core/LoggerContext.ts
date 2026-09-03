import { AsyncLocalStorage } from 'node:async_hooks';

/** 异步日志上下文中 K 为 traceId 等关联字段名，V 为业务调用链需要透传的任意只读值。 */
type ContextValues = Readonly<Record<string, unknown>>;

const storage = new AsyncLocalStorage<ContextValues>();

/**
 * 限制上下文为普通键值对象，避免数组或类实例在异步边界中携带隐式行为。
 *
 * @param value 待校验的上下文值。
 * @returns 值是否可以作为日志上下文存储。
 * @throws 不主动抛出异常。
 */
function isContextValues(value: unknown): value is ContextValues {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** 为一次异步调用链保存日志上下文，使业务代码无需逐层传递 traceId 等关联字段。 */
export class LoggerContext {
    /**
     * 在回调的异步调用链内合并并保存上下文，同时保持父级上下文可继承。
     *
     * @param values 本次调用链需要补充或覆盖的上下文字段。
     * @param callback 在该上下文中执行的业务回调。
     * @returns 业务回调的原始返回值。
     * @throws {TypeError} 当上下文不是普通对象或回调不是函数时抛出。
     */
    static withContext<T>(values: ContextValues, callback: () => T): T {
        if (!isContextValues(values)) {
            throw new TypeError('Logger context values must be a plain object');
        }
        if (typeof callback !== 'function') {
            throw new TypeError('Logger context callback must be a function');
        }

        const parent = storage.getStore() ?? {};
        const store = Object.freeze({ ...parent, ...values });
        return storage.run(store, callback);
    }

    /**
     * 读取当前异步调用链中的上下文字段，使日志写入可以自动关联 traceId。
     *
     * @param key 需要读取的上下文字段名。
     * @returns 当前字段值；键无效或当前没有对应上下文时返回 undefined。
     * @throws 不主动抛出异常。
     */
    static get<T = unknown>(key: string): T | undefined {
        if (typeof key !== 'string' || key.length === 0) {
            return undefined;
        }
        return storage.getStore()?.[key] as T | undefined;
    }
}
