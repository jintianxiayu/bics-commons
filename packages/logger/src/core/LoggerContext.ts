/**
 * LoggerContext - 异步上下文存储
 *
 * 基于 AsyncLocalStorage 实现跨异步调用链的上下文传递
 */

import { AsyncLocalStorage } from 'async_hooks';

const contextStore = new AsyncLocalStorage<Map<string, string>>();

function getOrCreateStore(): Map<string, string> {
    let store = contextStore.getStore();
    if (!store) {
        store = new Map();
        contextStore.enterWith(store);
    }
    return store;
}

export class LoggerContext {
    /**
     * 设置上下文值
     */
    static set(key: string, value: string): void {
        const store = getOrCreateStore();
        store.set(key, value);
    }

    /**
     * 获取上下文值
     */
    static get(key: string): string | undefined {
        const store = contextStore.getStore();
        return store?.get(key);
    }

    /**
     * 清空当前上下文
     */
    static clear(): void {
        const store = contextStore.getStore();
        if (store) {
            store.clear();
        }
    }

    /**
     * 获取当前存储（供内部或高级用法使用）
     */
    static getStore(): Map<string, string> | undefined {
        return contextStore.getStore();
    }

    /**
     * 在给定上下文中执行函数，自动清理
     *
     * @param values - 要合并到上下文的键值对
     * @param fn - 要执行的函数
     * @returns 函数的返回值
     */
    static withContext<T>(values: Record<string, string>, fn: () => T): T {
        const currentStore = contextStore.getStore();
        const newStore = new Map(currentStore);

        for (const [k, v] of Object.entries(values)) {
            newStore.set(k, v);
        }

        return contextStore.run(newStore, fn);
    }
}
