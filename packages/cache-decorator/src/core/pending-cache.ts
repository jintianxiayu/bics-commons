/**
 * 请求合并缓存
 * 用于在并发场景下返回同一个 Promise，避免重复执行
 */
export class PendingCache {
    private pending = new Map<string, Promise<unknown>>();

    get<T>(key: string): Promise<T> | undefined {
        return this.pending.get(key) as Promise<T> | undefined;
    }

    set<T>(key: string, promise: Promise<T>): void {
        this.pending.set(key, promise);
        const deleteSettledPromise = (): void => {
            if (this.pending.get(key) === promise) {
                this.pending.delete(key);
            }
        };
        void promise.then(deleteSettledPromise, deleteSettledPromise);
    }

    delete(key: string): void {
        this.pending.delete(key);
    }

    clear(): void {
        this.pending.clear();
    }
}
