/**
 * LoggerContext - 异步上下文存储
 *
 * 基于 AsyncLocalStorage 实现跨异步调用链的上下文传递
 */

import { AsyncLocalStorage } from 'async_hooks';

const contextStore = new AsyncLocalStorage<Map<string, string>>();

function validateKey(key: unknown): asserts key is string {
    if (typeof key !== 'string' || key.trim().length === 0) {
        throw new TypeError('LoggerContext key must be a non-empty string');
    }
}

function validateValue(value: unknown): asserts value is string {
    if (typeof value !== 'string') {
        throw new TypeError('LoggerContext value must be a string');
    }
}

function validateValues(values: unknown): Array<[string, string]> {
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError('LoggerContext values must be a plain object');
    }

    const prototype = Object.getPrototypeOf(values);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('LoggerContext values must be a plain object');
    }

    const entries: Array<[string, string]> = [];
    for (const key of Reflect.ownKeys(values)) {
        const descriptor = Object.getOwnPropertyDescriptor(values, key);
        if (!descriptor?.enumerable) continue;
        validateKey(key);
        const value = (values as Record<string, unknown>)[key];
        validateValue(value);
        entries.push([key, value]);
    }
    return entries;
}

export class LoggerContext {
    /**
     * 设置上下文值
     */
    static set(key: string, value: string): void {
        validateKey(key);
        validateValue(value);

        const currentStore = contextStore.getStore();
        if (!currentStore) {
            throw new Error('LoggerContext.set() requires an active withContext() scope');
        }

        const nextStore = new Map(currentStore);
        nextStore.set(key, value);
        contextStore.enterWith(nextStore);
    }

    /**
     * 获取上下文值
     */
    static get(key: string): string | undefined {
        validateKey(key);
        const store = contextStore.getStore();
        return store?.get(key);
    }

    /**
     * 清空当前上下文
     */
    static clear(): void {
        if (!contextStore.getStore()) return;
        contextStore.enterWith(new Map());
    }

    /**
     * 获取当前存储（供内部或高级用法使用）
     */
    static getStore(): ReadonlyMap<string, string> | undefined {
        const store = contextStore.getStore();
        return store ? new Map(store) : undefined;
    }

    /**
     * 在给定上下文中执行函数，自动清理
     *
     * @param values - 要合并到上下文的键值对
     * @param fn - 要执行的函数
     * @returns 函数的返回值
     */
    static withContext<T>(values: Record<string, string>, fn: () => T): T {
        if (typeof fn !== 'function') {
            throw new TypeError('LoggerContext callback must be a function');
        }

        const entries = validateValues(values);
        const currentStore = contextStore.getStore();
        const newStore = new Map(currentStore);

        for (const [key, value] of entries) {
            newStore.set(key, value);
        }

        return contextStore.run(newStore, fn);
    }
}
