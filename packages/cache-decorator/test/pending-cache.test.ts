import { PendingCache } from '../src/core/pending-cache';

describe('PendingCache', () => {
    let pendingCache: PendingCache;

    beforeEach(() => {
        pendingCache = new PendingCache();
    });

    describe('get & set', () => {
        it('应返回已存储的 Promise', async () => {
            const promise = Promise.resolve('value');
            pendingCache.set('key1', promise);
            expect(await pendingCache.get('key1')).toBe('value');
        });

        it('应返回 undefined 对不存在的键', () => {
            expect(pendingCache.get('nonexistent')).toBeUndefined();
        });
    });

    describe('请求合并', () => {
        it('应在 Promise 完成时自动删除', async () => {
            let resolve: (value: string) => void;
            const promise = new Promise<string>((r) => {
                resolve = r;
            });

            pendingCache.set('key1', promise);
            expect(pendingCache.get('key1')).toBeDefined();

            resolve!('value');
            await promise;
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(pendingCache.get('key1')).toBeUndefined();
        });

        it('应在 Promise 拒绝时自动删除且保留原始异常', async () => {
            const expectedError = new Error('request failed');
            const promise = Promise.reject(expectedError);

            pendingCache.set('key1', promise);

            await expect(promise).rejects.toBe(expectedError);
            await Promise.resolve();
            expect(pendingCache.get('key1')).toBeUndefined();
        });
    });

    describe('delete', () => {
        it('应删除指定键', async () => {
            const promise = Promise.resolve('value');
            pendingCache.set('key1', promise);
            pendingCache.delete('key1');
            expect(pendingCache.get('key1')).toBeUndefined();
        });
    });

    describe('clear', () => {
        it('应清除所有 pending 请求', async () => {
            pendingCache.set('key1', Promise.resolve('v1'));
            pendingCache.set('key2', Promise.resolve('v2'));
            pendingCache.clear();
            expect(pendingCache.get('key1')).toBeUndefined();
            expect(pendingCache.get('key2')).toBeUndefined();
        });
    });
});
